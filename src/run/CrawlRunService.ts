import { FrontierRepository } from '../frontier/FrontierRepository.js';
import type { StatusCounts } from '../frontier/types.js';
import { ScopePolicy, type ScopePolicyName } from '../url/ScopePolicy.js';
import { normalize } from '../url/UrlNormalizer.js';
import { urlHash } from '../url/urlHash.js';
import { RunRepository } from './RunRepository.js';
import type { CrawlRun, CrawlRunStatus } from './types.js';
import { isFinalRunStatus, isResumableRunStatus } from './types.js';

export interface CreateRunOptions {
  scopePolicy?: ScopePolicyName;
  concurrency: number;
  maxUrls: number | null;
  maxDepth: number | null;
  maxBytes: number | null;
  maxRuntimeSeconds: number | null;
  outputDir: string;
}

export interface ResumeRunOverrides {
  concurrency?: number;
  maxUrls?: number | null;
  maxDepth?: number | null;
  maxBytes?: number | null;
  maxRuntimeSeconds?: number | null;
  outputDir?: string;
}

export interface ResumeRunExplicitFlags {
  concurrency?: boolean;
  maxUrls?: boolean;
  maxDepth?: boolean;
  maxBytes?: boolean;
  maxRuntimeSeconds?: boolean;
  outputDir?: boolean;
}

export interface ResumeRunOptions {
  overrides?: ResumeRunOverrides;
  explicit?: ResumeRunExplicitFlags;
}

export interface ResumeRunResult {
  run: CrawlRun;
  previousStatus: CrawlRunStatus;
  recoveredInProgressCount: number;
}

export interface FinalizeRunContext {
  limitReached?: boolean;
  shutdownRequested?: boolean;
  infraFailure?: boolean;
}

export interface FinalizeRunResult {
  finalStatus: CrawlRunStatus;
  statusCounts: StatusCounts;
}

function hasExplicitLimitIncrease(
  run: CrawlRun,
  overrides: ResumeRunOverrides,
  explicit: ResumeRunExplicitFlags,
): boolean {
  if (
    explicit.maxUrls &&
    overrides.maxUrls != null &&
    run.maxUrls !== null &&
    overrides.maxUrls > run.maxUrls
  ) {
    return true;
  }

  if (
    explicit.maxDepth &&
    overrides.maxDepth != null &&
    run.maxDepth !== null &&
    overrides.maxDepth > run.maxDepth
  ) {
    return true;
  }

  if (
    explicit.maxBytes &&
    overrides.maxBytes != null &&
    run.maxBytes !== null &&
    overrides.maxBytes > run.maxBytes
  ) {
    return true;
  }

  if (
    explicit.maxRuntimeSeconds &&
    overrides.maxRuntimeSeconds != null &&
    run.maxRuntimeSeconds !== null &&
    overrides.maxRuntimeSeconds >= run.maxRuntimeSeconds
  ) {
    return true;
  }

  return false;
}

export class CrawlRunService {
  constructor(
    private readonly runRepository: RunRepository = new RunRepository(),
    private readonly frontierRepository: FrontierRepository = new FrontierRepository(),
  ) {}

  async createRun(seedUrl: string, options: CreateRunOptions): Promise<CrawlRun> {
    if (options.concurrency < 1) {
      throw new Error('concurrency must be at least 1');
    }

    if (options.maxUrls !== null && options.maxUrls < 1) {
      throw new Error('maxUrls must be at least 1 when set');
    }

    const normalizedSeedUrl = normalize(seedUrl);

    if (normalizedSeedUrl === null) {
      throw new Error(`Invalid seed URL: ${seedUrl}`);
    }

    const scopePolicyName = options.scopePolicy ?? 'registrable_domain';
    const scopePolicy = new ScopePolicy(normalizedSeedUrl, scopePolicyName);
    const scopeHost = scopePolicy.getDescriptor().value;

    const run = await this.runRepository.create({
      seedUrl,
      normalizedSeedUrl,
      scopeHost,
      scopePolicy: scopePolicyName,
      maxUrls: options.maxUrls,
      maxDepth: options.maxDepth,
      maxBytes: options.maxBytes,
      maxRuntimeSeconds: options.maxRuntimeSeconds,
      concurrency: options.concurrency,
      outputDir: options.outputDir,
    });

    const seedHost = new URL(normalizedSeedUrl).hostname;

    await this.frontierRepository.enqueueUrl({
      crawlRunId: run.id,
      url: seedUrl,
      normalizedUrl: normalizedSeedUrl,
      urlHash: urlHash(normalizedSeedUrl),
      host: seedHost,
      depth: 0,
    });

    run.urlsEnqueued = 1;

    return run;
  }

  async resumeRun(runId: string, options: ResumeRunOptions = {}): Promise<ResumeRunResult> {
    const run = await this.runRepository.getById(runId);

    if (run === null) {
      throw new Error(`Run not found: ${runId}`);
    }

    const overrides = options.overrides ?? {};
    const explicit = options.explicit ?? {};
    const previousStatus = run.status;

    if (isFinalRunStatus(run.status)) {
      throw new Error(`Run is terminal: ${run.status}`);
    }

    if (run.status === 'limit_reached') {
      if (!hasExplicitLimitIncrease(run, overrides, explicit)) {
        throw new Error(
          'Run reached a limit; resume requires an explicit increased limit override',
        );
      }
    } else if (!isResumableRunStatus(run.status)) {
      throw new Error(`Run is not resumable: ${run.status}`);
    }

    if (run.concurrency < 1) {
      throw new Error(
        'Run has invalid concurrency; resume requires an explicit concurrency override',
      );
    }

    if (explicit.concurrency && overrides.concurrency !== undefined && overrides.concurrency < 1) {
      throw new Error('concurrency must be at least 1');
    }

    if (
      explicit.outputDir &&
      overrides.outputDir !== undefined &&
      overrides.outputDir !== run.outputDir
    ) {
      throw new Error(
        `Output directory mismatch: run uses ${run.outputDir}, but ${overrides.outputDir} was requested`,
      );
    }

    const configUpdates = {
      concurrency: explicit.concurrency ? overrides.concurrency : undefined,
      maxUrls: explicit.maxUrls ? overrides.maxUrls : undefined,
      maxDepth: explicit.maxDepth ? overrides.maxDepth : undefined,
      maxBytes: explicit.maxBytes ? overrides.maxBytes : undefined,
      maxRuntimeSeconds: explicit.maxRuntimeSeconds ? overrides.maxRuntimeSeconds : undefined,
    };

    const recoveredInProgressCount = await this.frontierRepository.recoverAllInProgress(runId);

    const resumedRun = await this.runRepository.markRunning(runId, configUpdates);

    return {
      run: resumedRun,
      previousStatus,
      recoveredInProgressCount,
    };
  }

  async finalizeRun(runId: string, context: FinalizeRunContext = {}): Promise<FinalizeRunResult> {
    const statusCounts = await this.frontierRepository.getStatusCounts(runId);

    let finalStatus: CrawlRunStatus;

    if (context.shutdownRequested) {
      await this.runRepository.pause(runId);
      finalStatus = 'paused';
    } else if (context.limitReached) {
      finalStatus = 'limit_reached';
      await this.runRepository.finish(runId, finalStatus);
    } else if (context.infraFailure) {
      finalStatus = 'failed';
      await this.runRepository.finish(runId, finalStatus);
    } else if (statusCounts.permanent_failed > 0 || statusCounts.blocked > 0) {
      finalStatus = 'completed_with_failures';
      await this.runRepository.finish(runId, finalStatus);
    } else {
      finalStatus = 'completed';
      await this.runRepository.finish(runId, finalStatus);
    }

    return { finalStatus, statusCounts };
  }
}

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
  staleAfterMs?: number;
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
  if (isFiniteLimitIncrease(run.maxUrls, overrides.maxUrls, explicit.maxUrls)) {
    return true;
  }

  if (isFiniteLimitIncrease(run.maxDepth, overrides.maxDepth, explicit.maxDepth)) {
    return true;
  }

  if (isFiniteLimitIncrease(run.maxBytes, overrides.maxBytes, explicit.maxBytes)) {
    return true;
  }

  if (
    isFiniteLimitIncrease(
      run.maxRuntimeSeconds,
      overrides.maxRuntimeSeconds,
      explicit.maxRuntimeSeconds,
      { allowEqual: true },
    )
  ) {
    return true;
  }

  return false;
}

function isFiniteLimitIncrease(
  current: number | null,
  next: number | null | undefined,
  isExplicit = false,
  options: { allowEqual?: boolean } = {},
): boolean {
  if (!isExplicit || next === undefined) {
    return false;
  }

  if (next === null) {
    return current !== null;
  }

  if (current === null) {
    return false;
  }

  return options.allowEqual === true ? next >= current : next > current;
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

    const isStaleRunningTakeover = run.status === 'running';

    if (run.status === 'limit_reached') {
      if (!hasExplicitLimitIncrease(run, overrides, explicit)) {
        throw new Error(
          'Run reached a limit; resume requires an explicit increased limit override',
        );
      }
    } else if (!isStaleRunningTakeover && !isResumableRunStatus(run.status)) {
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

    const configUpdates: ResumeRunOverrides = {};

    if (explicit.concurrency && overrides.concurrency !== undefined) {
      configUpdates.concurrency = overrides.concurrency;
    }

    if (explicit.maxUrls && overrides.maxUrls !== undefined) {
      configUpdates.maxUrls = overrides.maxUrls;
    }

    if (explicit.maxDepth && overrides.maxDepth !== undefined) {
      configUpdates.maxDepth = overrides.maxDepth;
    }

    if (explicit.maxBytes && overrides.maxBytes !== undefined) {
      configUpdates.maxBytes = overrides.maxBytes;
    }

    if (explicit.maxRuntimeSeconds && overrides.maxRuntimeSeconds !== undefined) {
      configUpdates.maxRuntimeSeconds = overrides.maxRuntimeSeconds;
    }

    if (
      isStaleRunningTakeover &&
      (options.staleAfterMs === undefined || options.staleAfterMs < 1)
    ) {
      throw new Error('staleAfterMs must be at least 1');
    }

    const staleBefore =
      isStaleRunningTakeover && options.staleAfterMs !== undefined
        ? new Date(Date.now() - options.staleAfterMs)
        : undefined;

    const resumedRun = await this.runRepository.markRunning(
      runId,
      configUpdates,
      isStaleRunningTakeover ? ['running'] : [previousStatus],
      staleBefore,
    );

    if (resumedRun === null) {
      throw new Error(
        isStaleRunningTakeover
          ? 'Run is already running or not stale enough to resume'
          : 'Run is already running or not resumable',
      );
    }

    const recoveredInProgressCount = await this.frontierRepository.recoverAllInProgress(runId);

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

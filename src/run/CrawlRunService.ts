import { FrontierRepository } from '../frontier/FrontierRepository.js';
import type { StatusCounts } from '../frontier/types.js';
import { ScopePolicy, type ScopePolicyName } from '../url/ScopePolicy.js';
import { normalize } from '../url/UrlNormalizer.js';
import { urlHash } from '../url/urlHash.js';
import { STALE_IN_PROGRESS_MS } from '../worker/constants.js';
import { RunRepository } from './RunRepository.js';
import type { CrawlRun, CrawlRunStatus } from './types.js';
import { isTerminalRunStatus } from './types.js';

export interface CreateRunOptions {
  scopePolicy?: ScopePolicyName;
  concurrency: number;
  maxUrls: number | null;
  maxDepth: number | null;
  maxBytes: number | null;
  maxRuntimeSeconds: number | null;
}

export interface FinalizeRunContext {
  limitReached?: boolean;
  cancelled?: boolean;
}

export interface FinalizeRunResult {
  finalStatus: CrawlRunStatus;
  statusCounts: StatusCounts;
}

export class CrawlRunService {
  constructor(
    private readonly runRepository: RunRepository = new RunRepository(),
    private readonly frontierRepository: FrontierRepository = new FrontierRepository(),
  ) {}

  async createRun(seedUrl: string, options: CreateRunOptions): Promise<CrawlRun> {
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

    return run;
  }

  async resumeRun(runId: string): Promise<CrawlRun> {
    const run = await this.runRepository.getById(runId);

    if (run === null) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (isTerminalRunStatus(run.status)) {
      throw new Error(`Run is terminal: ${run.status}`);
    }

    await this.frontierRepository.recoverStaleInProgress(runId, STALE_IN_PROGRESS_MS);

    return run;
  }

  async finalizeRun(runId: string, context: FinalizeRunContext = {}): Promise<FinalizeRunResult> {
    const statusCounts = await this.frontierRepository.getStatusCounts(runId);

    let finalStatus: CrawlRunStatus;

    if (context.cancelled) {
      finalStatus = 'cancelled';
    } else if (context.limitReached) {
      finalStatus = 'limit_reached';
    } else if (statusCounts.permanent_failed > 0 || statusCounts.blocked > 0) {
      finalStatus = 'completed_with_failures';
    } else {
      finalStatus = 'completed';
    }

    await this.runRepository.finish(runId, finalStatus);

    return { finalStatus, statusCounts };
  }
}

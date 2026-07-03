import type { Logger } from 'pino';
import type { FetchClient } from '../fetch/types.js';
import type { FrontierRepository } from '../frontier/FrontierRepository.js';
import type { CrawlRunService } from '../run/CrawlRunService.js';
import type { RunRepository } from '../run/RunRepository.js';
import type { CrawlRun } from '../run/types.js';
import { ScopePolicy } from '../url/ScopePolicy.js';
import type { ContentProcessor } from './ContentProcessor.js';
import type { RateLimiter } from './RateLimiter.js';
import type { RetryPolicy } from './RetryPolicy.js';
import { createWorkerControl, runWorkerPoolWorkers, type WorkerControl } from './worker.js';
import type { EdgeRepository } from '../content/EdgeRepository.js';
import type { WorkerPoolSummary } from './types.js';

export interface WorkerPoolOptions {
  run: CrawlRun;
  concurrency: number;
  frontier: FrontierRepository;
  runRepository: RunRepository;
  crawlRunService: CrawlRunService;
  fetchClient: FetchClient;
  rateLimiter: RateLimiter;
  retryPolicy: RetryPolicy;
  contentProcessor: ContentProcessor;
  edgeRepository: EdgeRepository;
  logger: Logger;
  pollMs?: number;
  registerSignalHandlers?: boolean;
  control?: WorkerControl;
}

export async function runWorkerPool(options: WorkerPoolOptions): Promise<WorkerPoolSummary> {
  const control = options.control ?? createWorkerControl();
  const sessionStartedAtMs = Date.now();
  const scopePolicy = new ScopePolicy(options.run.normalizedSeedUrl, options.run.scopePolicy);

  const handleShutdown = (): void => {
    options.logger.info({ event: 'shutdown_requested', runId: options.run.id });
    control.requestShutdown();
  };

  if (options.registerSignalHandlers !== false) {
    process.once('SIGINT', handleShutdown);
    process.once('SIGTERM', handleShutdown);
  }

  await runWorkerPoolWorkers({
    run: options.run,
    concurrency: options.concurrency,
    sessionStartedAtMs,
    frontier: options.frontier,
    runRepository: options.runRepository,
    fetchClient: options.fetchClient,
    rateLimiter: options.rateLimiter,
    retryPolicy: options.retryPolicy,
    contentProcessor: options.contentProcessor,
    edgeRepository: options.edgeRepository,
    scopePolicy,
    logger: options.logger,
    control,
    pollMs: options.pollMs,
  });

  const finalizeResult = await options.crawlRunService.finalizeRun(options.run.id, {
    limitReached: control.getLimitReached(),
    shutdownRequested: control.getShutdownRequested(),
  });

  options.logger.info({
    event: 'run_completed',
    runId: options.run.id,
    finalStatus: finalizeResult.finalStatus,
    statusCounts: finalizeResult.statusCounts,
    bytesDownloaded: options.run.totalBytes,
    shutdownRequested: control.getShutdownRequested(),
    limitReached: control.getLimitReached(),
  });

  return {
    runId: options.run.id,
    finalStatus: finalizeResult.finalStatus,
    statusCounts: finalizeResult.statusCounts,
    shutdownRequested: control.getShutdownRequested(),
    limitReached: control.getLimitReached(),
  };
}

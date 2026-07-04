import type { Logger } from 'pino';
import type { FetchClient } from '../fetch/types.js';
import type { FrontierRepository } from '../frontier/FrontierRepository.js';
import type { CrawlRunService, FinalizeRunResult } from '../run/CrawlRunService.js';
import type { RunRepository } from '../run/RunRepository.js';
import type { CrawlRun } from '../run/types.js';
import { ScopePolicy } from '../url/ScopePolicy.js';
import type { ContentProcessor } from './ContentProcessor.js';
import type { RateLimiter } from './RateLimiter.js';
import type { RetryPolicy } from './RetryPolicy.js';
import { RUN_HEARTBEAT_INTERVAL_MS } from './constants.js';
import { createWorkerControl, runWorkerPoolWorkers, type WorkerControl } from './worker.js';
import type { EdgeRepository } from '../content/EdgeRepository.js';
import type { StatusCounts } from '../frontier/types.js';
import type { WorkerPoolSummary } from './types.js';

function startRunHeartbeat(options: WorkerPoolOptions): () => void {
  const intervalMs = options.heartbeatIntervalMs ?? RUN_HEARTBEAT_INTERVAL_MS;

  const timer = setInterval(() => {
    void options.runRepository.touchHeartbeat(options.run.id).catch((error) => {
      options.logger.warn({
        event: 'run_heartbeat_failed',
        runId: options.run.id,
        cause: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}

function emptyStatusCounts(): StatusCounts {
  return {
    queued: 0,
    in_progress: 0,
    done: 0,
    retryable_failed: 0,
    permanent_failed: 0,
    blocked: 0,
    skipped_unsupported: 0,
    redirected: 0,
  };
}

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
  heartbeatIntervalMs?: number;
  registerSignalHandlers?: boolean;
  control?: WorkerControl;
  workerRunner?: typeof runWorkerPoolWorkers;
}

export async function runWorkerPool(options: WorkerPoolOptions): Promise<WorkerPoolSummary> {
  const control = options.control ?? createWorkerControl();
  const sessionStartedAtMs = Date.now();
  const scopePolicy = new ScopePolicy(options.run.normalizedSeedUrl, options.run.scopePolicy);
  const workerRunner = options.workerRunner ?? runWorkerPoolWorkers;

  const handleShutdown = (): void => {
    options.logger.info({ event: 'shutdown_requested', runId: options.run.id });
    control.requestShutdown();
  };

  if (options.registerSignalHandlers !== false) {
    process.once('SIGINT', handleShutdown);
    process.once('SIGTERM', handleShutdown);
  }

  let poolFailure = false;
  let finalizeResult: FinalizeRunResult | undefined;
  let finalizeFailed = false;
  let stopHeartbeat = (): void => {};

  try {
    stopHeartbeat = startRunHeartbeat(options);

    const results = await workerRunner({
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

    poolFailure = results.hadInfraFailure || results.hadWorkerCrash;
  } catch (error) {
    poolFailure = true;
    options.logger.error({
      event: 'worker_crashed',
      runId: options.run.id,
      cause: error instanceof Error ? error.message : String(error),
    });
  } finally {
    stopHeartbeat();

    try {
      finalizeResult = await options.crawlRunService.finalizeRun(options.run.id, {
        limitReached: control.getLimitReached(),
        shutdownRequested: control.getShutdownRequested(),
        infraFailure: poolFailure,
      });
    } catch (error) {
      finalizeFailed = true;
      options.logger.error({
        event: 'run_failed',
        runId: options.run.id,
        finalStatus: 'failed',
        cause: error instanceof Error ? error.message : String(error),
      });

      try {
        await options.runRepository.finish(options.run.id, 'failed');
      } catch {
        // Last-resort finalize also failed.
      }
    }
  }

  if (finalizeFailed) {
    return {
      runId: options.run.id,
      finalStatus: 'failed',
      statusCounts: emptyStatusCounts(),
      shutdownRequested: control.getShutdownRequested(),
      limitReached: control.getLimitReached(),
    };
  }

  const eventName = finalizeResult!.finalStatus === 'failed' ? 'run_failed' : 'run_completed';

  options.logger.info({
    event: eventName,
    runId: options.run.id,
    finalStatus: finalizeResult!.finalStatus,
    statusCounts: finalizeResult!.statusCounts,
    bytesDownloaded: options.run.totalBytes,
    shutdownRequested: control.getShutdownRequested(),
    limitReached: control.getLimitReached(),
  });

  return {
    runId: options.run.id,
    finalStatus: finalizeResult!.finalStatus,
    statusCounts: finalizeResult!.statusCounts,
    shutdownRequested: control.getShutdownRequested(),
    limitReached: control.getLimitReached(),
  };
}

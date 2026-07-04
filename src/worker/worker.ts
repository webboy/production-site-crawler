import type { Logger } from 'pino';
import { getHeader } from '../fetch/headers.js';
import type { FetchClient } from '../fetch/types.js';
import { FetchTransportError } from '../fetch/types.js';
import type { FrontierRepository } from '../frontier/FrontierRepository.js';
import type { CrawlUrlTask } from '../frontier/types.js';
import type { RunRepository } from '../run/RunRepository.js';
import type { CrawlRun } from '../run/types.js';
import type { ScopePolicy } from '../url/ScopePolicy.js';
import { normalizeDiscovered } from '../url/UrlNormalizer.js';
import type { EdgeRepository } from '../content/EdgeRepository.js';
import { WORKER_POLL_MS, MAX_REDIRECTS } from './constants.js';
import { parseRetryAfter } from './retryAfter.js';
import type { ContentProcessor } from './ContentProcessor.js';
import { classifyResponse } from './ResponseClassifier.js';
import type { RateLimiter } from './RateLimiter.js';
import type { RetryContext, RetryPolicy } from './RetryPolicy.js';
import { SafetyLimits } from './SafetyLimits.js';
import { classifyProcessingError } from './classifyProcessingError.js';
import { resolveEdgeTarget } from './edgeTarget.js';
import { withOutcomeMarkRetry } from './outcomeMarkRetry.js';
import type { DiscoveredLink } from './types.js';

const MAX_CONSECUTIVE_INFRA_FAILURES = 5;
const INFRA_BACKOFF_BASE_MS = 500;
const INFRA_BACKOFF_MAX_MS = 30_000;

export interface WorkerControl {
  getShutdownRequested(): boolean;
  getLimitReached(): boolean;
  setLimitReached(value: boolean): void;
  requestShutdown(): void;
}

export function createWorkerControl(): WorkerControl {
  let shutdownRequested = false;
  let limitReached = false;

  return {
    getShutdownRequested: () => shutdownRequested,
    getLimitReached: () => limitReached,
    setLimitReached: (value: boolean) => {
      limitReached = value;
    },
    requestShutdown: () => {
      shutdownRequested = true;
    },
  };
}

export interface WorkerDependencies {
  run: CrawlRun;
  sessionStartedAtMs: number;
  frontier: FrontierRepository;
  runRepository: RunRepository;
  fetchClient: FetchClient;
  rateLimiter: RateLimiter;
  retryPolicy: RetryPolicy;
  contentProcessor: ContentProcessor;
  edgeRepository: EdgeRepository;
  scopePolicy: ScopePolicy;
  logger: Logger;
  control: WorkerControl;
  pollMs?: number;
  workerIndex?: number;
}

export interface WorkerRunResult {
  hadInfraFailure: boolean;
  hadWorkerCrash: boolean;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeInfraBackoffMs(consecutiveFailures: number): number {
  const exponential = INFRA_BACKOFF_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1);
  return Math.min(exponential, INFRA_BACKOFF_MAX_MS);
}

async function runInfraOperation<T>(
  operation: string,
  deps: WorkerDependencies,
  state: { consecutiveFailures: number },
  fn: () => Promise<T>,
): Promise<T> {
  while (true) {
    try {
      const result = await fn();
      state.consecutiveFailures = 0;
      return result;
    } catch (error) {
      state.consecutiveFailures += 1;

      deps.logger.warn({
        event: 'worker_infra_failure',
        runId: deps.run.id,
        workerIndex: deps.workerIndex ?? 0,
        consecutiveFailures: state.consecutiveFailures,
        operation,
        cause: error instanceof Error ? error.message : String(error),
      });

      if (state.consecutiveFailures >= MAX_CONSECUTIVE_INFRA_FAILURES) {
        throw error;
      }

      await sleep(computeInfraBackoffMs(state.consecutiveFailures));
    }
  }
}

export async function runWorkerSafely(
  deps: WorkerDependencies,
  workerIndex: number,
): Promise<WorkerRunResult> {
  try {
    await runWorker({ ...deps, workerIndex });
    return { hadInfraFailure: false, hadWorkerCrash: false };
  } catch (error) {
    deps.logger.error({
      event: 'worker_crashed',
      runId: deps.run.id,
      workerIndex,
      cause: error instanceof Error ? error.message : String(error),
    });

    return { hadInfraFailure: true, hadWorkerCrash: true };
  }
}

export async function runWorker(deps: WorkerDependencies): Promise<void> {
  const safetyLimits = new SafetyLimits(deps.run, deps.sessionStartedAtMs);
  const pollMs = deps.pollMs ?? WORKER_POLL_MS;
  const infraState = { consecutiveFailures: 0 };

  while (!deps.control.getShutdownRequested() && !deps.control.getLimitReached()) {
    let limitDecision;

    try {
      limitDecision = await runInfraOperation('shouldStop', deps, infraState, async () =>
        safetyLimits.shouldStop(),
      );
    } catch {
      break;
    }

    if (limitDecision.stop) {
      deps.control.setLimitReached(true);
      deps.logger.info({
        event: 'limit_reached',
        runId: deps.run.id,
        limitType: limitDecision.limitType ?? 'runtime',
      });
      break;
    }

    await deps.rateLimiter.wait();

    let task: CrawlUrlTask | null;

    try {
      task = await runInfraOperation('claimNextUrl', deps, infraState, async () =>
        deps.frontier.claimNextUrl(deps.run.id),
      );
    } catch {
      break;
    }

    if (task === null) {
      let inProgress: number;
      let futureRetry: number;

      try {
        inProgress = await runInfraOperation('countInProgress', deps, infraState, async () =>
          deps.frontier.countInProgress(deps.run.id),
        );
        futureRetry = await runInfraOperation('countFutureRetryable', deps, infraState, async () =>
          deps.frontier.countFutureRetryable(deps.run.id),
        );
      } catch {
        break;
      }

      if (inProgress > 0 || futureRetry > 0) {
        await sleep(pollMs);
        continue;
      }

      break;
    }

    deps.logger.info({
      event: 'url_claimed',
      runId: deps.run.id,
      urlId: task.id,
      url: task.url,
    });

    try {
      await processTask(deps, task);
    } catch (error) {
      const classification = classifyProcessingError(error);

      deps.logger.error({
        event: 'task_processing_failed',
        runId: deps.run.id,
        urlId: task.id,
        url: task.url,
        lastErrorType: classification.lastErrorType,
        retryable: classification.retryable,
        cause: error instanceof Error ? error.message : String(error),
      });

      try {
        if (classification.retryable) {
          await handleRetryableOutcome(deps, task, {
            lastError: error instanceof Error ? error.message : String(error),
            lastErrorType: classification.lastErrorType,
            httpStatusCode: null,
          });
        } else {
          await markPermanentFailureWithRetry(deps, task, {
            httpStatusCode: 0,
            lastError: error instanceof Error ? error.message : String(error),
            lastErrorType: classification.lastErrorType,
          });
        }
      } catch (markError) {
        deps.logger.error({
          event: 'task_outcome_mark_failed',
          runId: deps.run.id,
          urlId: task.id,
          attempt: MAX_CONSECUTIVE_INFRA_FAILURES,
          cause: markError instanceof Error ? markError.message : String(markError),
        });
        infraState.consecutiveFailures = MAX_CONSECUTIVE_INFRA_FAILURES;
        break;
      }
    }
  }

  if (infraState.consecutiveFailures >= MAX_CONSECUTIVE_INFRA_FAILURES) {
    throw new Error('Worker infrastructure failure threshold exceeded');
  }
}

async function markSucceededWithRetry(
  deps: WorkerDependencies,
  taskId: string,
  input: { httpStatusCode: number; contentType: string },
): Promise<void> {
  await withOutcomeMarkRetry(
    () => deps.frontier.markSucceeded(taskId, input),
    (attempt, error) => {
      deps.logger.warn({
        event: 'task_outcome_mark_failed',
        runId: deps.run.id,
        urlId: taskId,
        attempt,
        cause: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

async function markPermanentFailureWithRetry(
  deps: WorkerDependencies,
  task: CrawlUrlTask,
  input: { httpStatusCode: number; lastError: string; lastErrorType: string },
): Promise<void> {
  await withOutcomeMarkRetry(
    () => deps.frontier.markPermanentFailure(task.id, input),
    (attempt, error) => {
      deps.logger.warn({
        event: 'task_outcome_mark_failed',
        runId: deps.run.id,
        urlId: task.id,
        attempt,
        cause: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

export function logContentLengthMismatch(
  logger: Logger,
  context: { runId: string; urlId: string; url: string },
  headers: Record<string, string>,
  body: Buffer | null,
): void {
  if (body === null) {
    return;
  }

  const contentLengthHeader = getHeader(headers, 'Content-Length');

  if (contentLengthHeader === undefined) {
    return;
  }

  const expectedBytes = Number.parseInt(contentLengthHeader, 10);

  if (!Number.isInteger(expectedBytes) || expectedBytes < 0) {
    return;
  }

  const actualBytes = body.length;

  if (expectedBytes === actualBytes) {
    return;
  }

  logger.warn({
    event: 'content_length_mismatch',
    runId: context.runId,
    urlId: context.urlId,
    url: context.url,
    expectedBytes,
    actualBytes,
  });
}

async function processTask(deps: WorkerDependencies, task: CrawlUrlTask): Promise<void> {
  let response;

  try {
    response = await deps.fetchClient.fetchUrl(task.url);
  } catch (error) {
    const lastError =
      error instanceof FetchTransportError ? error.message : 'Unknown fetch transport error';
    const lastErrorType = error instanceof FetchTransportError ? error.kind : 'network';

    await handleRetryableOutcome(deps, task, {
      lastError,
      lastErrorType,
      httpStatusCode: error instanceof FetchTransportError ? (error.status ?? null) : null,
    });

    return;
  }

  logContentLengthMismatch(
    deps.logger,
    { runId: deps.run.id, urlId: task.id, url: task.url },
    response.headers,
    response.body,
  );

  const action = classifyResponse(response);

  switch (action) {
    case 'success_with_body': {
      const result = await deps.contentProcessor.process(task, response);
      const contentType =
        result.contentType ??
        getHeader(response.headers, 'Content-Type') ??
        'application/octet-stream';

      if (result.outcome === 'skipped_unsupported') {
        await withOutcomeMarkRetry(
          () =>
            deps.frontier.markSkippedUnsupported(task.id, {
              contentType,
              reason: 'Unsupported content type',
            }),
          (attempt, error) => {
            deps.logger.warn({
              event: 'task_outcome_mark_failed',
              runId: deps.run.id,
              urlId: task.id,
              attempt,
              cause: error instanceof Error ? error.message : String(error),
            });
          },
        );

        deps.logger.info({
          event: 'url_skipped_unsupported',
          runId: deps.run.id,
          urlId: task.id,
          contentType,
        });

        return;
      }

      await enqueueDiscoveredLinks(deps, task, result.discovered ?? []);

      await markSucceededWithRetry(deps, task.id, {
        httpStatusCode: response.statusCode,
        contentType,
      });

      if (result.bytes > 0) {
        await deps.runRepository.addBytes(deps.run.id, result.bytes);
        deps.run.totalBytes += result.bytes;
      }

      deps.logger.info({
        event: 'fetch_succeeded',
        runId: deps.run.id,
        urlId: task.id,
        statusCode: response.statusCode,
        bytes: result.bytes,
        discoveredCount: result.discovered?.length ?? 0,
      });

      if ((result.discovered?.length ?? 0) > 0) {
        deps.logger.info({
          event: 'links_discovered',
          runId: deps.run.id,
          urlId: task.id,
          count: result.discovered?.length ?? 0,
        });
      }

      return;
    }

    case 'not_found':
      await markPermanentFailureWithRetry(deps, task, {
        httpStatusCode: response.statusCode,
        lastError: 'Resource not found',
        lastErrorType: 'http_status',
      });
      deps.logger.info({
        event: 'url_permanent_failed',
        runId: deps.run.id,
        urlId: task.id,
        statusCode: response.statusCode,
        reason: 'not_found',
      });
      return;

    case 'blocked':
      await withOutcomeMarkRetry(
        () =>
          deps.frontier.markBlocked(task.id, {
            httpStatusCode: response.statusCode,
            reason: 'Access forbidden',
          }),
        (attempt, error) => {
          deps.logger.warn({
            event: 'task_outcome_mark_failed',
            runId: deps.run.id,
            urlId: task.id,
            attempt,
            cause: error instanceof Error ? error.message : String(error),
          });
        },
      );
      deps.logger.info({
        event: 'url_blocked',
        runId: deps.run.id,
        urlId: task.id,
        statusCode: response.statusCode,
      });
      return;

    case 'empty_body':
      await handleRetryableOutcome(deps, task, {
        lastError: 'Empty response body',
        lastErrorType: 'empty_body',
        httpStatusCode: response.statusCode,
      });
      return;

    case 'rate_limited': {
      const retryAfterHeader = getHeader(response.headers, 'Retry-After');
      const retryAfterMs = parseRetryAfter(retryAfterHeader);

      deps.rateLimiter.onRateLimited(response.headers);
      await handleRetryableOutcome(
        deps,
        task,
        {
          lastError: 'Rate limited',
          lastErrorType: 'rate_limited',
          httpStatusCode: response.statusCode,
        },
        retryAfterMs === null ? undefined : { retryAfterMs },
      );
      deps.logger.info({
        event: 'rate_limited',
        runId: deps.run.id,
        urlId: task.id,
        statusCode: response.statusCode,
        retryAfterHeader: retryAfterHeader ?? null,
      });
      return;
    }

    case 'server_error':
      await handleRetryableOutcome(deps, task, {
        lastError: 'Server error',
        lastErrorType: 'server_error',
        httpStatusCode: response.statusCode,
      });
      return;

    case 'redirect':
      await handleRedirect(deps, task, response);
      return;

    case 'unexpected':
      await handleRetryableOutcome(deps, task, {
        lastError: `Unexpected HTTP status ${response.statusCode}`,
        lastErrorType: 'unexpected_status',
        httpStatusCode: response.statusCode,
      });
      return;
  }
}

async function handleRetryableOutcome(
  deps: WorkerDependencies,
  task: CrawlUrlTask,
  input: {
    lastError: string;
    lastErrorType: string;
    httpStatusCode: number | null;
  },
  retryContext?: RetryContext,
): Promise<void> {
  const decision = deps.retryPolicy.decide(task, input.lastErrorType, retryContext);

  if (!decision.retry) {
    await markPermanentFailureWithRetry(deps, task, {
      httpStatusCode: input.httpStatusCode ?? 0,
      lastError: input.lastError,
      lastErrorType: input.lastErrorType,
    });
    deps.logger.info({
      event: 'url_permanent_failed',
      runId: deps.run.id,
      urlId: task.id,
      reason: 'max_attempts_exhausted',
    });
    return;
  }

  await withOutcomeMarkRetry(
    () =>
      deps.frontier.markRetryableFailure(task.id, {
        nextAttemptAt: decision.nextAttemptAt,
        lastError: input.lastError,
        lastErrorType: input.lastErrorType,
        httpStatusCode: input.httpStatusCode,
        consumesAttempt: decision.consumesAttempt,
      }),
    (attempt, error) => {
      deps.logger.warn({
        event: 'task_outcome_mark_failed',
        runId: deps.run.id,
        urlId: task.id,
        attempt,
        cause: error instanceof Error ? error.message : String(error),
      });
    },
  );

  if (input.lastErrorType === 'rate_limited') {
    deps.logger.info({
      event: 'rate_limit_retry_scheduled',
      runId: deps.run.id,
      urlId: task.id,
      nextAttemptAt: decision.nextAttemptAt.toISOString(),
      retryAfterHeader: retryContext?.retryAfterMs ?? null,
      attemptCount: task.attemptCount,
    });
  } else {
    deps.logger.info({
      event: 'retry_scheduled',
      runId: deps.run.id,
      urlId: task.id,
      nextAttemptAt: decision.nextAttemptAt.toISOString(),
      lastErrorType: input.lastErrorType,
      consumesAttempt: decision.consumesAttempt,
      attemptCount: task.attemptCount,
    });
  }

  deps.logger.warn({
    event: 'fetch_failed',
    runId: deps.run.id,
    urlId: task.id,
    lastError: input.lastError,
    lastErrorType: input.lastErrorType,
  });
}

function applyEdgeDecision(
  deps: WorkerDependencies,
  edgeDecision: Awaited<ReturnType<typeof resolveEdgeTarget>>,
): void {
  if (edgeDecision.admittedNew) {
    deps.run.urlsEnqueued += 1;
  }

  if (edgeDecision.limitReached) {
    deps.control.setLimitReached(true);
    deps.logger.info({
      event: 'url_limit_reached',
      runId: deps.run.id,
      maxUrls: deps.run.maxUrls,
      urlsEnqueued: deps.run.urlsEnqueued,
    });
  }
}

async function handleRedirect(
  deps: WorkerDependencies,
  task: CrawlUrlTask,
  response: { statusCode: number; headers: Record<string, string> },
): Promise<void> {
  const location = getHeader(response.headers, 'Location');

  if (location === undefined || location.trim() === '') {
    await markPermanentFailureWithRetry(deps, task, {
      httpStatusCode: response.statusCode,
      lastError: 'Redirect response missing Location header',
      lastErrorType: 'redirect_missing_location',
    });

    deps.logger.info({
      event: 'redirect_rejected',
      runId: deps.run.id,
      urlId: task.id,
      statusCode: response.statusCode,
      reason: 'missing_location',
    });

    return;
  }

  if (task.redirectCount >= MAX_REDIRECTS) {
    await markPermanentFailureWithRetry(deps, task, {
      httpStatusCode: response.statusCode,
      lastError: 'Redirect chain limit exceeded',
      lastErrorType: 'redirect_limit_exceeded',
    });

    deps.logger.info({
      event: 'redirect_rejected',
      runId: deps.run.id,
      urlId: task.id,
      statusCode: response.statusCode,
      reason: 'limit_exceeded',
      redirectCount: task.redirectCount,
    });

    return;
  }

  const normalized = normalizeDiscovered(location, task.url);

  if ('rejected' in normalized) {
    await withOutcomeMarkRetry(
      () => deps.frontier.markRedirected(task.id, { httpStatusCode: response.statusCode }),
      (attempt, error) => {
        deps.logger.warn({
          event: 'task_outcome_mark_failed',
          runId: deps.run.id,
          urlId: task.id,
          attempt,
          cause: error instanceof Error ? error.message : String(error),
        });
      },
    );

    deps.logger.info({
      event: 'redirect_rejected',
      runId: deps.run.id,
      urlId: task.id,
      statusCode: response.statusCode,
      reason: normalized.rejected,
      location,
    });

    return;
  }

  const edgeDecision = await resolveEdgeTarget(
    {
      run: deps.run,
      frontier: deps.frontier,
      scopePolicy: deps.scopePolicy,
    },
    task,
    {
      url: normalized.url,
      normalizedUrl: normalized.normalizedUrl,
      host: new URL(normalized.normalizedUrl).hostname,
      depth: task.depth,
      source: 'redirect',
      redirectCount: task.redirectCount + 1,
    },
  );

  applyEdgeDecision(deps, edgeDecision);

  if (edgeDecision.limitReached) {
    deps.logger.info({
      event: 'enqueue_skipped_limit',
      runId: deps.run.id,
      url: normalized.url,
      normalizedUrl: normalized.normalizedUrl,
      urlsEnqueued: deps.run.urlsEnqueued,
      maxUrls: deps.run.maxUrls,
    });
  }

  await deps.edgeRepository.recordEdge({
    crawlRunId: deps.run.id,
    fromUrlId: task.id,
    toUrlId: edgeDecision.toUrlId,
    discoveredUrl: normalized.url,
    normalizedDiscoveredUrl: normalized.normalizedUrl,
    inScope: edgeDecision.inScope,
    skipReason: edgeDecision.skipReason,
    source: 'redirect',
  });

  await withOutcomeMarkRetry(
    () => deps.frontier.markRedirected(task.id, { httpStatusCode: response.statusCode }),
    (attempt, error) => {
      deps.logger.warn({
        event: 'task_outcome_mark_failed',
        runId: deps.run.id,
        urlId: task.id,
        attempt,
        cause: error instanceof Error ? error.message : String(error),
      });
    },
  );

  deps.logger.info({
    event: 'redirect_followed',
    runId: deps.run.id,
    urlId: task.id,
    statusCode: response.statusCode,
    location: normalized.url,
    targetUrlId: edgeDecision.toUrlId,
    inScope: edgeDecision.inScope,
    skipReason: edgeDecision.skipReason,
  });
}

async function enqueueDiscoveredLinks(
  deps: WorkerDependencies,
  task: CrawlUrlTask,
  links: DiscoveredLink[],
): Promise<void> {
  for (const link of links) {
    const edgeDecision = await resolveEdgeTarget(
      {
        run: deps.run,
        frontier: deps.frontier,
        scopePolicy: deps.scopePolicy,
      },
      task,
      {
        url: link.url,
        normalizedUrl: link.normalizedUrl,
        host: link.host,
        depth: link.depth,
        source: link.source,
      },
    );

    applyEdgeDecision(deps, edgeDecision);

    if (edgeDecision.limitReached) {
      deps.logger.info({
        event: 'enqueue_skipped_limit',
        runId: deps.run.id,
        url: link.url,
        normalizedUrl: link.normalizedUrl,
        urlsEnqueued: deps.run.urlsEnqueued,
        maxUrls: deps.run.maxUrls,
      });
    }

    await deps.edgeRepository.recordEdge({
      crawlRunId: deps.run.id,
      fromUrlId: task.id,
      toUrlId: edgeDecision.toUrlId,
      discoveredUrl: link.url,
      normalizedDiscoveredUrl: link.normalizedUrl,
      inScope: edgeDecision.inScope,
      skipReason: edgeDecision.skipReason,
      source: link.source,
    });
  }
}

export interface WorkerPoolRunOptions {
  run: CrawlRun;
  concurrency: number;
  sessionStartedAtMs: number;
  frontier: FrontierRepository;
  runRepository: RunRepository;
  fetchClient: FetchClient;
  rateLimiter: RateLimiter;
  retryPolicy: RetryPolicy;
  contentProcessor: ContentProcessor;
  edgeRepository: EdgeRepository;
  scopePolicy: ScopePolicy;
  logger: Logger;
  control: WorkerControl;
  pollMs?: number;
}

export async function runWorkerPoolWorkers(
  options: WorkerPoolRunOptions,
): Promise<WorkerRunResult> {
  const workerDeps: WorkerDependencies = {
    run: options.run,
    sessionStartedAtMs: options.sessionStartedAtMs,
    frontier: options.frontier,
    runRepository: options.runRepository,
    fetchClient: options.fetchClient,
    rateLimiter: options.rateLimiter,
    retryPolicy: options.retryPolicy,
    contentProcessor: options.contentProcessor,
    edgeRepository: options.edgeRepository,
    scopePolicy: options.scopePolicy,
    logger: options.logger,
    control: options.control,
    pollMs: options.pollMs,
  };

  const results = await Promise.allSettled(
    Array.from({ length: options.concurrency }, (_, workerIndex) =>
      runWorkerSafely(workerDeps, workerIndex),
    ),
  );

  let hadInfraFailure = false;
  let hadWorkerCrash = false;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      hadInfraFailure ||= result.value.hadInfraFailure;
      hadWorkerCrash ||= result.value.hadWorkerCrash;
    } else {
      hadWorkerCrash = true;
    }
  }

  return { hadInfraFailure, hadWorkerCrash };
}

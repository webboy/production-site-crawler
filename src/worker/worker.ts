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
import { urlHash } from '../url/urlHash.js';
import type { EdgeRepository } from '../content/EdgeRepository.js';
import { WORKER_POLL_MS, MAX_REDIRECTS } from './constants.js';
import { parseRetryAfter } from './retryAfter.js';
import type { ContentProcessor } from './ContentProcessor.js';
import { classifyResponse } from './ResponseClassifier.js';
import type { RateLimiter } from './RateLimiter.js';
import type { RetryContext, RetryPolicy } from './RetryPolicy.js';
import { SafetyLimits } from './SafetyLimits.js';
import type { DiscoveredLink } from './types.js';

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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runWorker(deps: WorkerDependencies): Promise<void> {
  const safetyLimits = new SafetyLimits(deps.run, deps.run.startedAt.getTime());
  const pollMs = deps.pollMs ?? WORKER_POLL_MS;

  while (!deps.control.getShutdownRequested() && !deps.control.getLimitReached()) {
    const limitDecision = await safetyLimits.shouldStop(deps.frontier);

    if (limitDecision.stop) {
      deps.control.setLimitReached(true);
      break;
    }

    await deps.rateLimiter.wait();

    const task = await deps.frontier.claimNextUrl(deps.run.id);

    if (task === null) {
      const inProgress = await deps.frontier.countInProgress(deps.run.id);
      const futureRetry = await deps.frontier.countFutureRetryable(deps.run.id);

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

    await processTask(deps, task);
  }
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

  const action = classifyResponse(response);

  switch (action) {
    case 'success_with_body': {
      const result = await deps.contentProcessor.process(task, response);
      const contentType =
        result.contentType ??
        getHeader(response.headers, 'Content-Type') ??
        'application/octet-stream';

      if (result.outcome === 'skipped_unsupported') {
        await deps.frontier.markSkippedUnsupported(task.id, {
          contentType,
          reason: 'Unsupported content type',
        });

        deps.logger.info({
          event: 'url_skipped_unsupported',
          runId: deps.run.id,
          urlId: task.id,
          contentType,
        });

        return;
      }

      await enqueueDiscoveredLinks(deps, task, result.discovered ?? []);

      await deps.frontier.markSucceeded(task.id, {
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
      await deps.frontier.markPermanentFailure(task.id, {
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
      await deps.frontier.markBlocked(task.id, {
        httpStatusCode: response.statusCode,
        reason: 'Access forbidden',
      });
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
    await deps.frontier.markPermanentFailure(task.id, {
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

  await deps.frontier.markRetryableFailure(task.id, {
    nextAttemptAt: decision.nextAttemptAt,
    lastError: input.lastError,
    lastErrorType: input.lastErrorType,
    httpStatusCode: input.httpStatusCode,
  });

  deps.logger.info({
    event: 'retry_scheduled',
    runId: deps.run.id,
    urlId: task.id,
    nextAttemptAt: decision.nextAttemptAt.toISOString(),
    lastErrorType: input.lastErrorType,
  });

  deps.logger.warn({
    event: 'fetch_failed',
    runId: deps.run.id,
    urlId: task.id,
    lastError: input.lastError,
    lastErrorType: input.lastErrorType,
  });
}

async function handleRedirect(
  deps: WorkerDependencies,
  task: CrawlUrlTask,
  response: { statusCode: number; headers: Record<string, string> },
): Promise<void> {
  const location = getHeader(response.headers, 'Location');

  if (location === undefined || location.trim() === '') {
    await deps.frontier.markPermanentFailure(task.id, {
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
    await deps.frontier.markPermanentFailure(task.id, {
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
    await deps.frontier.markRedirected(task.id, { httpStatusCode: response.statusCode });

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

  const inScopeByPolicy = deps.scopePolicy.isInScope(normalized.normalizedUrl);
  const withinDepth = deps.run.maxDepth === null || task.depth <= deps.run.maxDepth;
  const shouldEnqueue = inScopeByPolicy && withinDepth;

  let toUrlId: string | null = null;

  if (shouldEnqueue) {
    const enqueueResult = await deps.frontier.enqueueUrl({
      crawlRunId: deps.run.id,
      url: normalized.url,
      normalizedUrl: normalized.normalizedUrl,
      urlHash: urlHash(normalized.normalizedUrl),
      host: new URL(normalized.normalizedUrl).hostname,
      depth: task.depth,
      redirectCount: task.redirectCount + 1,
      discoveredFromUrlId: task.id,
    });

    toUrlId = enqueueResult.id;
  }

  await deps.edgeRepository.recordEdge({
    crawlRunId: deps.run.id,
    fromUrlId: task.id,
    toUrlId,
    discoveredUrl: normalized.url,
    normalizedDiscoveredUrl: normalized.normalizedUrl,
    inScope: shouldEnqueue,
    source: 'redirect',
  });

  await deps.frontier.markRedirected(task.id, { httpStatusCode: response.statusCode });

  deps.logger.info({
    event: 'redirect_followed',
    runId: deps.run.id,
    urlId: task.id,
    statusCode: response.statusCode,
    location: normalized.url,
    targetUrlId: toUrlId,
    inScope: shouldEnqueue,
  });
}

async function enqueueDiscoveredLinks(
  deps: WorkerDependencies,
  task: CrawlUrlTask,
  links: DiscoveredLink[],
): Promise<void> {
  for (const link of links) {
    const inScopeByPolicy = deps.scopePolicy.isInScope(link.normalizedUrl);
    const withinDepth = deps.run.maxDepth === null || link.depth <= deps.run.maxDepth;
    const shouldEnqueue = inScopeByPolicy && withinDepth;

    let toUrlId: string | null = null;

    if (shouldEnqueue) {
      const enqueueResult = await deps.frontier.enqueueUrl({
        crawlRunId: deps.run.id,
        url: link.url,
        normalizedUrl: link.normalizedUrl,
        urlHash: urlHash(link.normalizedUrl),
        host: link.host,
        depth: link.depth,
        discoveredFromUrlId: task.id,
      });

      toUrlId = enqueueResult.id;
    }

    await deps.edgeRepository.recordEdge({
      crawlRunId: deps.run.id,
      fromUrlId: task.id,
      toUrlId,
      discoveredUrl: link.url,
      normalizedDiscoveredUrl: link.normalizedUrl,
      inScope: shouldEnqueue,
      source: link.source,
    });
  }
}

export interface WorkerPoolRunOptions {
  run: CrawlRun;
  concurrency: number;
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

export async function runWorkerPoolWorkers(options: WorkerPoolRunOptions): Promise<void> {
  const workerDeps: WorkerDependencies = {
    run: options.run,
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

  await Promise.all(Array.from({ length: options.concurrency }, () => runWorker(workerDeps)));
}

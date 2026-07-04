import type { Logger } from 'pino';
import { MockFetchClient } from '../../src/fetch/MockFetchClient.js';
import type { FetchClient, FetchResponse } from '../../src/fetch/types.js';
import { closePool, query } from '../../src/db/pool.js';
import { FrontierRepository } from '../../src/frontier/FrontierRepository.js';
import type { CrawlUrlTask } from '../../src/frontier/types.js';
import { createLogger } from '../../src/log/logger.js';
import { loadConfig } from '../../src/config/env.js';
import { CrawlRunService } from '../../src/run/CrawlRunService.js';
import { RunRepository } from '../../src/run/RunRepository.js';
import type { CrawlRun } from '../../src/run/types.js';
import { mapCrawlRunRow, type CrawlRunRow } from '../../src/run/types.js';
import type { ContentProcessor } from '../../src/worker/ContentProcessor.js';
import { EdgeRepository } from '../../src/content/EdgeRepository.js';
import { NoopContentProcessor } from '../../src/worker/ContentProcessor.js';
import type { RateLimiter } from '../../src/worker/RateLimiter.js';
import type { RetryPolicy } from '../../src/worker/RetryPolicy.js';
import { SimpleRateLimiter } from '../../src/worker/RateLimiter.js';
import { SimpleRetryPolicy } from '../../src/worker/RetryPolicy.js';
import type { DiscoveredLink, WorkerPoolSummary } from '../../src/worker/types.js';
import { runWorkerPool } from '../../src/worker/WorkerPool.js';
import { createWorkerControl, type WorkerControl } from '../../src/worker/worker.js';
import { canReachDatabase, cleanupCrawlRun } from './frontierTestUtils.js';

export { canReachDatabase, cleanupCrawlRun };

export interface RunCrawlWithMocksOptions {
  seedUrl: string;
  mockResponses?: Record<string, FetchResponse | FetchResponse[]>;
  contentProcessor?: ContentProcessor;
  retryPolicy?: RetryPolicy;
  rateLimiter?: RateLimiter | TrackingRateLimiter;
  concurrency?: number;
  outputDir?: string;
  resumeRunId?: string;
  resumeOverrides?: {
    concurrency?: number;
    maxUrls?: number | null;
    maxDepth?: number | null;
    maxBytes?: number | null;
    maxRuntimeSeconds?: number | null;
    outputDir?: string;
  };
  resumeExplicit?: {
    concurrency?: boolean;
    maxUrls?: boolean;
    maxDepth?: boolean;
    maxBytes?: boolean;
    maxRuntimeSeconds?: boolean;
    outputDir?: boolean;
  };
  control?: WorkerControl;
  pollMs?: number;
  maxUrls?: number;
}

export class TrackingRateLimiter extends SimpleRateLimiter {
  readonly rateLimitedCalls: Array<Record<string, string>> = [];

  onRateLimited(headers: Record<string, string>): void {
    this.rateLimitedCalls.push(headers);
  }
}

export class DiscoveryStubContentProcessor implements ContentProcessor {
  private didDiscover = false;

  constructor(
    private readonly followUpUrl: string,
    private readonly followUpNormalizedUrl: string,
    private readonly followUpHost: string,
  ) {}

  async process(task: CrawlUrlTask, response: FetchResponse) {
    const noop = new NoopContentProcessor();
    const result = await noop.process(task, response);

    if (this.didDiscover) {
      return result;
    }

    this.didDiscover = true;

    return {
      ...result,
      discovered: [
        {
          url: this.followUpUrl,
          normalizedUrl: this.followUpNormalizedUrl,
          host: this.followUpHost,
          depth: task.depth + 1,
          source: 'test.stub',
        } satisfies DiscoveredLink,
      ],
    };
  }
}

export async function runCrawlWithMocks(
  options: RunCrawlWithMocksOptions,
): Promise<{ summary: WorkerPoolSummary; runId: string; rateLimiter?: TrackingRateLimiter }> {
  const config = loadConfig();
  const logger: Logger = createLogger(config);
  const runRepository = new RunRepository();
  const frontierRepository = new FrontierRepository();
  const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

  const mockClient = new MockFetchClient();

  for (const [url, responseOrSequence] of Object.entries(options.mockResponses ?? {})) {
    mockClient.register(url, responseOrSequence);
  }

  const run =
    options.resumeRunId !== undefined
      ? (
          await crawlRunService.resumeRun(options.resumeRunId, {
            overrides: options.resumeOverrides,
            explicit: options.resumeExplicit,
          })
        ).run
      : await crawlRunService.createRun(options.seedUrl, {
          concurrency: options.concurrency ?? 1,
          maxUrls: options.maxUrls ?? config.crawl.maxUrls,
          maxDepth: config.crawl.maxDepth,
          maxBytes: config.crawl.maxBytes,
          maxRuntimeSeconds: config.crawl.maxRuntimeSeconds,
          outputDir: options.outputDir ?? config.crawl.outputDir,
        });

  const rateLimiter = options.rateLimiter ?? new SimpleRateLimiter();
  const edgeRepository = new EdgeRepository();

  const summary = await runWorkerPool({
    run,
    concurrency: run.concurrency,
    frontier: frontierRepository,
    runRepository,
    crawlRunService,
    fetchClient: mockClient satisfies FetchClient,
    rateLimiter,
    retryPolicy: options.retryPolicy ?? new SimpleRetryPolicy(50),
    contentProcessor: options.contentProcessor ?? new NoopContentProcessor(),
    edgeRepository,
    logger,
    pollMs: options.pollMs ?? 50,
    registerSignalHandlers: false,
    control: options.control,
  });

  return { summary, runId: run.id, rateLimiter: rateLimiter as TrackingRateLimiter };
}

export async function readCrawlRun(runId: string): Promise<CrawlRun | null> {
  const result = await query<CrawlRunRow>(
    `
      SELECT
        id,
        seed_url,
        normalized_seed_url,
        scope_host,
        scope_policy,
        status,
        max_urls,
        max_depth,
        max_bytes,
        max_runtime_seconds,
        concurrency,
        output_dir,
        total_bytes,
        urls_enqueued,
        started_at,
        finished_at,
        updated_at
      FROM crawl_runs
      WHERE id = $1
    `,
    [runId],
  );

  const row = result.rows[0];
  return row === undefined ? null : mapCrawlRunRow(row);
}

export async function readCrawlUrl(id: string) {
  const result = await query<{
    status: string;
    http_status_code: number | null;
    attempt_count: number;
    redirect_count: number;
    finished_at: Date | null;
    last_error_type: string | null;
  }>(
    `
      SELECT status, http_status_code, attempt_count, redirect_count, finished_at, last_error_type
      FROM crawl_urls
      WHERE id = $1
    `,
    [id],
  );

  return result.rows[0];
}

export async function countCrawlUrls(runId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM crawl_urls
      WHERE crawl_run_id = $1
    `,
    [runId],
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function getUrlIdByNormalizedUrl(
  runId: string,
  normalizedUrl: string,
): Promise<string | null> {
  const result = await query<{ id: string }>(
    `
      SELECT id
      FROM crawl_urls
      WHERE crawl_run_id = $1
        AND normalized_url = $2
    `,
    [runId, normalizedUrl],
  );

  return result.rows[0]?.id ?? null;
}

export { createWorkerControl };

export async function updateCrawlRun(
  runId: string,
  updates: {
    status?: string;
    startedAtOffsetMs?: number;
    maxRuntimeSeconds?: number | null;
    maxUrls?: number | null;
    maxDepth?: number | null;
    maxBytes?: number | null;
    concurrency?: number;
    outputDir?: string;
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [runId];
  let paramIndex = 2;

  if (updates.status !== undefined) {
    sets.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }

  if (updates.startedAtOffsetMs !== undefined) {
    sets.push(`started_at = now() - ($${paramIndex++} * interval '1 millisecond')`);
    values.push(updates.startedAtOffsetMs);
  }

  if (updates.maxRuntimeSeconds !== undefined) {
    sets.push(`max_runtime_seconds = $${paramIndex++}`);
    values.push(updates.maxRuntimeSeconds);
  }

  if (updates.maxUrls !== undefined) {
    sets.push(`max_urls = $${paramIndex++}`);
    values.push(updates.maxUrls);
  }

  if (updates.maxDepth !== undefined) {
    sets.push(`max_depth = $${paramIndex++}`);
    values.push(updates.maxDepth);
  }

  if (updates.maxBytes !== undefined) {
    sets.push(`max_bytes = $${paramIndex++}`);
    values.push(updates.maxBytes);
  }

  if (updates.concurrency !== undefined) {
    sets.push(`concurrency = $${paramIndex++}`);
    values.push(updates.concurrency);
  }

  if (updates.outputDir !== undefined) {
    sets.push(`output_dir = $${paramIndex++}`);
    values.push(updates.outputDir);
  }

  if (sets.length === 0) {
    return;
  }

  await query(
    `
      UPDATE crawl_runs
      SET ${sets.join(', ')},
          updated_at = now()
      WHERE id = $1
    `,
    values,
  );
}

export async function closeDatabasePool(): Promise<void> {
  await closePool();
}

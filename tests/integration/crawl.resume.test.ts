import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { CrawlRunService } from '../../src/run/CrawlRunService.js';
import { RunRepository } from '../../src/run/RunRepository.js';
import { FrontierRepository } from '../../src/frontier/FrontierRepository.js';
import { normalize } from '../../src/url/UrlNormalizer.js';
import { urlHash } from '../../src/url/urlHash.js';
import type { ContentProcessor } from '../../src/worker/ContentProcessor.js';
import { NoopContentProcessor } from '../../src/worker/ContentProcessor.js';
import type { CrawlUrlTask } from '../../src/frontier/types.js';
import type { FetchResponse } from '../../src/fetch/types.js';
import {
  canReachDatabase,
  cleanupCrawlRun,
  closeDatabasePool,
  createWorkerControl,
  readCrawlRun,
  readCrawlUrl,
  runCrawlWithMocks,
  updateCrawlRun,
} from './crawlTestUtils.js';
import { insertCrawlRun } from './frontierTestUtils.js';

const databaseReachable = await canReachDatabase();

class ShutdownAfterUrlsProcessor implements ContentProcessor {
  private processed = 0;

  constructor(
    private readonly shutdownAfter: number,
    private readonly requestShutdown: () => void,
    private readonly inner: ContentProcessor = new NoopContentProcessor(),
  ) {}

  async process(task: CrawlUrlTask, response: FetchResponse) {
    const result = await this.inner.process(task, response);
    this.processed += 1;

    if (this.processed >= this.shutdownAfter) {
      this.requestShutdown();
    }

    return result;
  }
}

class TrackingFrontierRepository extends FrontierRepository {
  recoveredAllInProgressCount = 0;

  override async recoverAllInProgress(crawlRunId: string): Promise<number> {
    this.recoveredAllInProgressCount += 1;
    return super.recoverAllInProgress(crawlRunId);
  }
}

describe.skipIf(!databaseReachable)('crawl resume', () => {
  afterAll(async () => {
    await closeDatabasePool();
  });

  it('recovers stale in_progress work, processes queued URLs, and leaves done rows untouched', async () => {
    const runId = await insertCrawlRun();
    const doneUrl = 'https://example.com/resume-done';
    const queuedUrl = 'https://example.com/resume-queued';
    const staleUrl = 'https://example.com/resume-stale';

    const doneNormalized = normalize(doneUrl);
    const queuedNormalized = normalize(queuedUrl);
    const staleNormalized = normalize(staleUrl);

    if (doneNormalized === null || queuedNormalized === null || staleNormalized === null) {
      throw new Error('Expected normalized resume fixture URLs');
    }

    const doneInsert = await query<{ id: string; finished_at: Date }>(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status, finished_at
        )
        VALUES ($1, $2, $3, $4, 'example.com', 0, 'done', now() - interval '1 hour')
        RETURNING id, finished_at
      `,
      [runId, doneUrl, doneNormalized, urlHash(doneNormalized)],
    );

    const queuedInsert = await query<{ id: string }>(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status
        )
        VALUES ($1, $2, $3, $4, 'example.com', 0, 'queued')
        RETURNING id
      `,
      [runId, queuedUrl, queuedNormalized, urlHash(queuedNormalized)],
    );

    const staleInsert = await query<{ id: string }>(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status, claimed_at, attempt_count
        )
        VALUES ($1, $2, $3, $4, 'example.com', 0, 'in_progress', now() - interval '20 minutes', 2)
        RETURNING id
      `,
      [runId, staleUrl, staleNormalized, urlHash(staleNormalized)],
    );

    const doneRow = doneInsert.rows[0];
    const queuedRow = queuedInsert.rows[0];
    const staleRow = staleInsert.rows[0];

    if (doneRow === undefined || queuedRow === undefined || staleRow === undefined) {
      throw new Error('Failed to seed resume fixture rows');
    }

    await updateCrawlRun(runId, { status: 'paused' });

    const { summary } = await runCrawlWithMocks({
      seedUrl: queuedUrl,
      resumeRunId: runId,
      mockResponses: {
        [queuedUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
        [staleUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
      },
      pollMs: 50,
    });

    try {
      expect(summary.statusCounts.done).toBe(3);
      expect(summary.statusCounts.queued).toBe(0);
      expect(summary.statusCounts.in_progress).toBe(0);

      const untouchedDone = await readCrawlUrl(doneRow.id);
      expect(untouchedDone?.finished_at?.toISOString()).toBe(doneRow.finished_at.toISOString());

      await expect(readCrawlUrl(queuedRow.id)).resolves.toMatchObject({ status: 'done' });
      await expect(readCrawlUrl(staleRow.id)).resolves.toMatchObject({
        status: 'done',
        attempt_count: 2,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('immediately reclaims fresh in_progress rows on resume', async () => {
    const runId = await insertCrawlRun();
    const freshUrl = 'https://example.com/resume-fresh-in-progress';
    const freshNormalized = normalize(freshUrl);

    if (freshNormalized === null) {
      throw new Error('Expected normalized fresh in-progress URL');
    }

    const freshInsert = await query<{ id: string }>(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status, claimed_at
        )
        VALUES ($1, $2, $3, $4, 'example.com', 0, 'in_progress', now())
        RETURNING id
      `,
      [runId, freshUrl, freshNormalized, urlHash(freshNormalized)],
    );

    const freshRow = freshInsert.rows[0];

    if (freshRow === undefined) {
      throw new Error('Failed to seed fresh in-progress row');
    }

    await updateCrawlRun(runId, { status: 'paused' });

    const { summary } = await runCrawlWithMocks({
      seedUrl: freshUrl,
      resumeRunId: runId,
      mockResponses: {
        [freshUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
      },
      pollMs: 50,
    });

    try {
      expect(summary.statusCounts.done).toBe(1);
      await expect(readCrawlUrl(freshRow.id)).resolves.toMatchObject({ status: 'done' });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('resumes failed runs by recovering in_progress work', async () => {
    const runId = await insertCrawlRun();
    const url = 'https://example.com/failed-resume-in-progress';
    const normalized = normalize(url);

    if (normalized === null) {
      throw new Error('Expected normalized failed resume URL');
    }

    const row = await query<{ id: string }>(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status, claimed_at
        )
        VALUES ($1, $2, $3, $4, 'example.com', 0, 'in_progress', now())
        RETURNING id
      `,
      [runId, url, normalized, urlHash(normalized)],
    );

    const urlId = row.rows[0]?.id;

    if (urlId === undefined) {
      throw new Error('Failed to seed failed resume URL row');
    }

    await updateCrawlRun(runId, { status: 'failed' });

    const { summary } = await runCrawlWithMocks({
      seedUrl: url,
      resumeRunId: runId,
      mockResponses: {
        [url]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
      },
      pollMs: 50,
    });

    try {
      expect(summary.finalStatus).toBe('completed');
      expect(summary.statusCounts.done).toBe(1);
      await expect(readCrawlUrl(urlId)).resolves.toMatchObject({ status: 'done' });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('marks graceful shutdown as paused and resumes remaining work', async () => {
    const runId = await insertCrawlRun();
    const firstUrl = 'https://example.com/pause-first';
    const secondUrl = 'https://example.com/pause-second';
    const firstNormalized = normalize(firstUrl);
    const secondNormalized = normalize(secondUrl);

    if (firstNormalized === null || secondNormalized === null) {
      throw new Error('Expected normalized pause fixture URLs');
    }

    await query(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status
        )
        VALUES
          ($1, $2, $3, $4, 'example.com', 0, 'queued'),
          ($1, $5, $6, $7, 'example.com', 0, 'queued')
      `,
      [
        runId,
        firstUrl,
        firstNormalized,
        urlHash(firstNormalized),
        secondUrl,
        secondNormalized,
        urlHash(secondNormalized),
      ],
    );

    await updateCrawlRun(runId, { concurrency: 1, status: 'paused' });

    const control = createWorkerControl();

    const firstPass = await runCrawlWithMocks({
      seedUrl: firstUrl,
      resumeRunId: runId,
      control,
      contentProcessor: new ShutdownAfterUrlsProcessor(1, () => control.requestShutdown()),
      mockResponses: {
        [firstUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
        [secondUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
      },
      pollMs: 50,
    });

    try {
      expect(firstPass.summary.finalStatus).toBe('paused');
      expect(firstPass.summary.shutdownRequested).toBe(true);

      const pausedRun = await readCrawlRun(runId);
      expect(pausedRun?.status).toBe('paused');
      expect(pausedRun?.finishedAt).not.toBeNull();

      const secondPass = await runCrawlWithMocks({
        seedUrl: secondUrl,
        resumeRunId: runId,
        mockResponses: {
          [secondUrl]: {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html' },
            body: Buffer.from('<html></html>'),
          },
        },
        pollMs: 50,
      });

      expect(secondPass.summary.finalStatus).toBe('completed');
      expect(secondPass.summary.statusCounts.done).toBe(2);
      expect(secondPass.summary.statusCounts.queued).toBe(0);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('uses persisted run configuration on resume unless explicitly overridden', async () => {
    const runRepository = new RunRepository();
    const frontierRepository = new FrontierRepository();
    const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

    const created = await crawlRunService.createRun('https://example.com/config-persist', {
      concurrency: 4,
      maxUrls: 25,
      maxDepth: 3,
      maxBytes: 4096,
      maxRuntimeSeconds: 120,
      outputDir: '/tmp/persisted-output',
    });

    try {
      await updateCrawlRun(created.id, { status: 'paused' });
      const resumed = await crawlRunService.resumeRun(created.id);
      expect(resumed.run.concurrency).toBe(4);
      expect(resumed.run.maxUrls).toBe(25);
      expect(resumed.run.maxDepth).toBe(3);
      expect(resumed.run.maxBytes).toBe(4096);
      expect(resumed.run.maxRuntimeSeconds).toBe(120);
      expect(resumed.run.outputDir).toBe('/tmp/persisted-output');

      await updateCrawlRun(created.id, { status: 'paused' });
      const overridden = await crawlRunService.resumeRun(created.id, {
        overrides: { concurrency: 2, maxUrls: 50 },
        explicit: { concurrency: true, maxUrls: true },
      });
      expect(overridden.run.concurrency).toBe(2);
      expect(overridden.run.maxUrls).toBe(50);

      await updateCrawlRun(created.id, { status: 'paused' });
      const unlimited = await crawlRunService.resumeRun(created.id, {
        overrides: { maxUrls: null, maxDepth: null, maxBytes: null, maxRuntimeSeconds: null },
        explicit: {
          maxUrls: true,
          maxDepth: true,
          maxBytes: true,
          maxRuntimeSeconds: true,
        },
      });
      expect(unlimited.run.maxUrls).toBeNull();
      expect(unlimited.run.maxDepth).toBeNull();
      expect(unlimited.run.maxBytes).toBeNull();
      expect(unlimited.run.maxRuntimeSeconds).toBeNull();
    } finally {
      await cleanupCrawlRun(created.id);
    }
  });

  it('rejects conflicting output directory overrides on resume', async () => {
    const runRepository = new RunRepository();
    const frontierRepository = new FrontierRepository();
    const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

    const created = await crawlRunService.createRun('https://example.com/output-dir', {
      concurrency: 1,
      maxUrls: 10,
      maxDepth: 1,
      maxBytes: 1024,
      maxRuntimeSeconds: 60,
      outputDir: '/tmp/original-output',
    });

    try {
      await updateCrawlRun(created.id, { status: 'paused' });
      await expect(
        crawlRunService.resumeRun(created.id, {
          overrides: { outputDir: '/tmp/other-output' },
          explicit: { outputDir: true },
        }),
      ).rejects.toThrow(/Output directory mismatch/);
    } finally {
      await cleanupCrawlRun(created.id);
    }
  });

  it('rejects parallel resume after one caller atomically claims the run', async () => {
    const runId = await insertCrawlRun();
    const url = 'https://example.com/concurrent-resume';
    const normalized = normalize(url);

    if (normalized === null) {
      throw new Error('Expected normalized concurrent resume URL');
    }

    await query(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status, claimed_at
        )
        VALUES ($1, $2, $3, $4, 'example.com', 0, 'in_progress', now())
      `,
      [runId, url, normalized, urlHash(normalized)],
    );

    await updateCrawlRun(runId, { status: 'paused' });

    const runRepository = new RunRepository();
    const frontierRepository = new TrackingFrontierRepository();
    const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

    try {
      const results = await Promise.allSettled([
        crawlRunService.resumeRun(runId),
        crawlRunService.resumeRun(runId),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: expect.objectContaining({
          message: 'Run is already running or not resumable',
        }),
      });
      expect(frontierRepository.recoveredAllInProgressCount).toBe(1);

      await expect(readCrawlRun(runId)).resolves.toMatchObject({ status: 'running' });
      const queued = await query<{ status: string }>(
        `
          SELECT status
          FROM crawl_urls
          WHERE crawl_run_id = $1
            AND normalized_url = $2
        `,
        [runId, normalized],
      );
      expect(queued.rows[0]?.status).toBe('queued');
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('requires explicit increased limits to resume limit_reached runs', async () => {
    const runId = await insertCrawlRun();
    const url = 'https://example.com/limit-resume';
    const normalized = normalize(url);

    if (normalized === null) {
      throw new Error('Expected normalized limit resume URL');
    }

    await query(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status
        )
        VALUES ($1, $2, $3, $4, 'example.com', 0, 'queued')
      `,
      [runId, url, normalized, urlHash(normalized)],
    );

    await updateCrawlRun(runId, {
      status: 'limit_reached',
      maxUrls: 1,
    });

    const runRepository = new RunRepository();
    const frontierRepository = new FrontierRepository();
    const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

    try {
      await expect(crawlRunService.resumeRun(runId)).rejects.toThrow(/explicit increased limit/);
      await expect(
        crawlRunService.resumeRun(runId, {
          overrides: { maxUrls: 1 },
          explicit: { maxUrls: true },
        }),
      ).rejects.toThrow(/explicit increased limit/);
      await expect(
        crawlRunService.resumeRun(runId, {
          overrides: { maxUrls: 0 },
          explicit: { maxUrls: true },
        }),
      ).rejects.toThrow(/explicit increased limit/);

      const resumed = await crawlRunService.resumeRun(runId, {
        overrides: { maxUrls: 5 },
        explicit: { maxUrls: true },
      });

      expect(resumed.run.status).toBe('running');
      expect(resumed.run.maxUrls).toBe(5);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('treats explicit unlimited as an increased limit for limit_reached runs', async () => {
    const runId = await insertCrawlRun();
    const runRepository = new RunRepository();
    const frontierRepository = new FrontierRepository();
    const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

    await updateCrawlRun(runId, {
      status: 'limit_reached',
      maxUrls: 1,
      maxDepth: 1,
      maxBytes: 1024,
      maxRuntimeSeconds: 60,
    });

    try {
      const resumed = await crawlRunService.resumeRun(runId, {
        overrides: { maxUrls: null },
        explicit: { maxUrls: true },
      });

      expect(resumed.run.status).toBe('running');
      expect(resumed.run.maxUrls).toBeNull();
      expect(resumed.run.maxDepth).toBe(1);
      expect(resumed.run.maxBytes).toBe(1024);
      expect(resumed.run.maxRuntimeSeconds).toBe(60);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('accepts the same runtime limit for limit_reached runs because runtime is per-session', async () => {
    const runId = await insertCrawlRun();
    const runRepository = new RunRepository();
    const frontierRepository = new FrontierRepository();
    const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

    await updateCrawlRun(runId, {
      status: 'limit_reached',
      maxRuntimeSeconds: 60,
    });

    try {
      const resumed = await crawlRunService.resumeRun(runId, {
        overrides: { maxRuntimeSeconds: 60 },
        explicit: { maxRuntimeSeconds: true },
      });

      expect(resumed.run.status).toBe('running');
      expect(resumed.run.maxRuntimeSeconds).toBe(60);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('uses a fresh per-session runtime budget after resume', async () => {
    const runId = await insertCrawlRun();
    const url = 'https://example.com/runtime-resume';
    const normalized = normalize(url);

    if (normalized === null) {
      throw new Error('Expected normalized runtime resume URL');
    }

    await query(
      `
        INSERT INTO crawl_urls (
          crawl_run_id, url, normalized_url, url_hash, host, depth, status
        )
        VALUES ($1, $2, $3, $4, 'example.com', 0, 'queued')
      `,
      [runId, url, normalized, urlHash(normalized)],
    );

    await updateCrawlRun(runId, {
      startedAtOffsetMs: 3_600_000,
      maxRuntimeSeconds: 60,
      status: 'paused',
    });

    const { summary } = await runCrawlWithMocks({
      seedUrl: url,
      resumeRunId: runId,
      mockResponses: {
        [url]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
      },
      pollMs: 50,
    });

    try {
      expect(summary.finalStatus).toBe('completed');
      expect(summary.limitReached).toBe(false);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('rejects terminal run statuses on resume', async () => {
    const runId = await insertCrawlRun();
    const runRepository = new RunRepository();
    const frontierRepository = new FrontierRepository();
    const crawlRunService = new CrawlRunService(runRepository, frontierRepository);

    try {
      for (const status of ['completed', 'completed_with_failures', 'cancelled'] as const) {
        await updateCrawlRun(runId, { status });
        await expect(crawlRunService.resumeRun(runId)).rejects.toThrow(/terminal/);
      }
    } finally {
      await cleanupCrawlRun(runId);
    }
  });
});

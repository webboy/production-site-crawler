import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { normalize } from '../../src/url/UrlNormalizer.js';
import { BackoffRetryPolicy, SimpleRetryPolicy } from '../../src/worker/RetryPolicy.js';
import {
  canReachDatabase,
  cleanupCrawlRun,
  closeDatabasePool,
  getUrlIdByNormalizedUrl,
  readCrawlUrl,
  runCrawlWithMocks,
  TrackingRateLimiter,
} from './crawlTestUtils.js';

const databaseReachable = await canReachDatabase();

describe.skipIf(!databaseReachable)('crawl fetch outcomes', () => {
  afterAll(async () => {
    await closeDatabasePool();
  });

  it('maps 404 to permanent_failed', async () => {
    const seedUrl = 'https://example.com/outcome-404';
    const normalizedSeedUrl = normalize(seedUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: { statusCode: 404, headers: {}, body: null },
      },
    });

    try {
      expect(summary.statusCounts.permanent_failed).toBe(1);

      if (normalizedSeedUrl === null) {
        throw new Error('Expected normalized seed URL');
      }

      const urlId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (urlId === null) {
        throw new Error('Expected seed URL row');
      }

      await expect(readCrawlUrl(urlId)).resolves.toMatchObject({
        status: 'permanent_failed',
        http_status_code: 404,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('maps 403 to blocked', async () => {
    const seedUrl = 'https://example.com/outcome-403';

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: { statusCode: 403, headers: {}, body: null },
      },
    });

    try {
      expect(summary.statusCounts.blocked).toBe(1);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('retries 500 responses and eventually marks the URL done', async () => {
    const seedUrl = 'https://example.com/outcome-500-retry';
    const normalizedSeedUrl = normalize(seedUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      retryPolicy: new SimpleRetryPolicy(10),
      mockResponses: {
        [seedUrl]: [
          { statusCode: 500, headers: {}, body: null },
          { statusCode: 500, headers: {}, body: null },
          {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html' },
            body: Buffer.from('<html></html>'),
          },
        ],
      },
      pollMs: 20,
    });

    try {
      expect(summary.statusCounts.done).toBe(1);

      if (normalizedSeedUrl === null) {
        throw new Error('Expected normalized seed URL');
      }

      const urlId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (urlId === null) {
        throw new Error('Expected seed URL row');
      }

      await expect(readCrawlUrl(urlId)).resolves.toMatchObject({
        status: 'done',
        attempt_count: 2,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('records 429 as retryable and invokes onRateLimited', async () => {
    const seedUrl = 'https://example.com/outcome-429';
    const normalizedSeedUrl = normalize(seedUrl);
    const rateLimiter = new TrackingRateLimiter();
    const startedAt = Date.now();

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      rateLimiter,
      retryPolicy: new BackoffRetryPolicy({
        baseDelayMs: 50,
        maxDelayMs: 10_000,
        jitterRatio: 0,
        random: () => 0.5,
      }),
      mockResponses: {
        [seedUrl]: [
          { statusCode: 429, headers: { 'Retry-After': '1' }, body: null },
          {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html' },
            body: Buffer.from('<html></html>'),
          },
        ],
      },
      pollMs: 20,
    });

    try {
      expect(rateLimiter.rateLimitedCalls).toHaveLength(1);
      expect(summary.statusCounts.done).toBe(1);

      if (normalizedSeedUrl === null) {
        throw new Error('Expected normalized seed URL');
      }

      const urlId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (urlId === null) {
        throw new Error('Expected seed URL row');
      }

      const row = await query<{
        attempt_count: number;
        next_attempt_at: Date;
      }>(
        `
          SELECT attempt_count, next_attempt_at
          FROM crawl_urls
          WHERE id = $1
        `,
        [urlId],
      );

      expect(row.rows[0]?.attempt_count).toBe(0);
      expect(row.rows[0]?.next_attempt_at.getTime()).toBeGreaterThanOrEqual(startedAt + 1_000);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });
});

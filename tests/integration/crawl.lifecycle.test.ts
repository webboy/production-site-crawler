import { afterAll, describe, expect, it } from 'vitest';
import {
  canReachDatabase,
  cleanupCrawlRun,
  closeDatabasePool,
  countCrawlUrls,
  readCrawlRun,
  runCrawlWithMocks,
} from './crawlTestUtils.js';

const databaseReachable = await canReachDatabase();

describe.skipIf(!databaseReachable)('crawl lifecycle', () => {
  afterAll(async () => {
    await closeDatabasePool();
  });

  it('seeds a run, processes the seed URL, and finalizes completed', async () => {
    const seedUrl = 'https://example.com/lifecycle-seed';

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html><body>ok</body></html>'),
        },
      },
      concurrency: 1,
    });

    try {
      expect(summary.finalStatus).toBe('completed');
      expect(summary.statusCounts.done).toBe(1);
      expect(summary.statusCounts.queued).toBe(0);
      expect(summary.statusCounts.in_progress).toBe(0);

      const run = await readCrawlRun(runId);
      expect(run?.status).toBe('completed');
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('marks a 404 seed as permanent_failed without enqueueing a homepage fallback', async () => {
    const seedUrl = 'https://example.com/missing-seed';

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: {
          statusCode: 404,
          headers: {},
          body: null,
        },
      },
      concurrency: 1,
    });

    try {
      expect(summary.finalStatus).toBe('completed_with_failures');
      expect(summary.statusCounts.permanent_failed).toBe(1);
      expect(await countCrawlUrls(runId)).toBe(1);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('persists unlimited max URLs as NULL', async () => {
    const seedUrl = 'https://example.com/unlimited-max-urls';

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      maxUrls: null,
      mockResponses: {
        [seedUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html><body>ok</body></html>'),
        },
      },
      concurrency: 1,
    });

    try {
      expect(summary.finalStatus).toBe('completed');

      const run = await readCrawlRun(runId);
      expect(run?.maxUrls).toBeNull();
    } finally {
      await cleanupCrawlRun(runId);
    }
  });
});

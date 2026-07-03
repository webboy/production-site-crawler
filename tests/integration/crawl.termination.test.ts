import { afterAll, describe, expect, it } from 'vitest';
import {
  canReachDatabase,
  cleanupCrawlRun,
  closeDatabasePool,
  DiscoveryStubContentProcessor,
  runCrawlWithMocks,
} from './crawlTestUtils.js';

const databaseReachable = await canReachDatabase();

describe.skipIf(!databaseReachable)('crawl D6 termination', () => {
  afterAll(async () => {
    await closeDatabasePool();
  });

  it('keeps workers running until discovered follow-up work is done', async () => {
    const seedUrl = 'https://example.com/termination-seed';
    const followUpUrl = 'https://example.com/termination-follow-up';
    const followUpNormalizedUrl = 'https://example.com/termination-follow-up';

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      contentProcessor: new DiscoveryStubContentProcessor(
        followUpUrl,
        followUpNormalizedUrl,
        'example.com',
      ),
      mockResponses: {
        [seedUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html><body>seed</body></html>'),
        },
        [followUpUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html><body>follow-up</body></html>'),
        },
      },
      concurrency: 2,
      pollMs: 50,
    });

    try {
      expect(summary.finalStatus).toBe('completed');
      expect(summary.statusCounts.done).toBe(2);
      expect(summary.statusCounts.queued).toBe(0);
      expect(summary.statusCounts.in_progress).toBe(0);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });
});

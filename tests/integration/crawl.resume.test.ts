import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { normalize } from '../../src/url/UrlNormalizer.js';
import { urlHash } from '../../src/url/urlHash.js';
import {
  canReachDatabase,
  cleanupCrawlRun,
  closeDatabasePool,
  readCrawlUrl,
  runCrawlWithMocks,
} from './crawlTestUtils.js';
import { insertCrawlRun } from './frontierTestUtils.js';

const databaseReachable = await canReachDatabase();

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
      concurrency: 2,
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
});

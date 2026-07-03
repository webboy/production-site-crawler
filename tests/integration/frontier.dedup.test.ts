import { afterAll, describe, expect, it } from 'vitest';
import { query, closePool } from '../../src/db/pool.js';
import {
  buildUrlInput,
  canReachDatabase,
  cleanupCrawlRun,
  createFrontierRepository,
  insertCrawlRun,
} from './frontierTestUtils.js';

const databaseReachable = await canReachDatabase();

describe.skipIf(!databaseReachable)('FrontierRepository enqueue deduplication', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns the existing id when the normalized URL already exists', async () => {
    const repository = createFrontierRepository();
    const crawlRunId = await insertCrawlRun();

    try {
      const input = buildUrlInput(crawlRunId, 1);
      const first = await repository.enqueueUrl(input);
      const second = await repository.enqueueUrl({
        ...input,
        url: 'https://example.com/page-1?from=duplicate',
      });

      expect(first.inserted).toBe(true);
      expect(second).toEqual({ id: first.id, inserted: false });

      const count = await query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM crawl_urls
          WHERE crawl_run_id = $1
            AND normalized_url = $2
        `,
        [crawlRunId, input.normalizedUrl],
      );

      expect(Number(count.rows[0]?.count)).toBe(1);
    } finally {
      await cleanupCrawlRun(crawlRunId);
    }
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../../src/db/pool.js';
import {
  buildUrlInput,
  canReachDatabase,
  cleanupCrawlRun,
  createFrontierRepository,
  insertCrawlRun,
} from './frontierTestUtils.js';

const databaseReachable = await canReachDatabase();

describe.skipIf(!databaseReachable)('FrontierRepository stale in-progress recovery', () => {
  afterAll(async () => {
    await closePool();
  });

  it('resets stale in-progress URLs without incrementing attempts and leaves fresh claims alone', async () => {
    const repository = createFrontierRepository();
    const crawlRunId = await insertCrawlRun();

    try {
      const stale = await repository.enqueueUrl(buildUrlInput(crawlRunId, 1));
      const fresh = await repository.enqueueUrl(buildUrlInput(crawlRunId, 2));

      await query(
        `
          UPDATE crawl_urls
          SET status = 'in_progress', claimed_at = now() - interval '20 minutes', attempt_count = 2
          WHERE id = $1
        `,
        [stale.id],
      );
      await query(
        `
          UPDATE crawl_urls
          SET status = 'in_progress', claimed_at = now(), attempt_count = 3
          WHERE id = $1
        `,
        [fresh.id],
      );

      await expect(repository.recoverStaleInProgress(crawlRunId, 10 * 60 * 1000)).resolves.toBe(1);

      const result = await query<{
        id: string;
        status: string;
        attempt_count: number;
        claimed_at: Date | null;
      }>(
        `
          SELECT id, status, attempt_count, claimed_at
          FROM crawl_urls
          WHERE id = ANY($1::uuid[])
          ORDER BY id
        `,
        [[stale.id, fresh.id]],
      );

      const byId = new Map(result.rows.map((row) => [row.id, row]));
      expect(byId.get(stale.id)).toMatchObject({
        status: 'queued',
        attempt_count: 2,
        claimed_at: null,
      });
      expect(byId.get(fresh.id)).toMatchObject({ status: 'in_progress', attempt_count: 3 });
    } finally {
      await cleanupCrawlRun(crawlRunId);
    }
  });
});

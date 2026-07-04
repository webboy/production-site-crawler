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

describe.skipIf(!databaseReachable)('FrontierRepository concurrent claiming', () => {
  afterAll(async () => {
    await closePool();
  });

  it('inserts a new URL exactly once under concurrent enqueue attempts', async () => {
    const crawlRunId = await insertCrawlRun();
    const input = buildUrlInput(crawlRunId, 99);
    const workerCount = 8;

    try {
      const results = await Promise.all(
        Array.from({ length: workerCount }, () => createFrontierRepository().enqueueUrl(input)),
      );

      const insertedResults = results.filter((result) => result.inserted);
      const resultIds = new Set(results.map((result) => result.id).filter((id) => id !== null));

      expect(insertedResults).toHaveLength(1);
      expect(resultIds.size).toBe(1);

      const urlCount = await query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM crawl_urls
          WHERE crawl_run_id = $1
            AND normalized_url = $2
        `,
        [crawlRunId, input.normalizedUrl],
      );

      const runCount = await query<{ urls_enqueued: number }>(
        `
          SELECT urls_enqueued
          FROM crawl_runs
          WHERE id = $1
        `,
        [crawlRunId],
      );

      expect(Number(urlCount.rows[0]?.count)).toBe(1);
      expect(runCount.rows[0]?.urls_enqueued).toBe(1);
    } finally {
      await cleanupCrawlRun(crawlRunId);
    }
  });

  it('claims every queued URL exactly once across concurrent workers', async () => {
    const repository = createFrontierRepository();
    const crawlRunId = await insertCrawlRun();
    const totalUrls = 50;
    const workerCount = 8;

    try {
      for (let index = 0; index < totalUrls; index += 1) {
        await repository.enqueueUrl(buildUrlInput(crawlRunId, index));
      }

      const claimedIds = await Promise.all(
        Array.from({ length: workerCount }, async () => {
          const localRepository = createFrontierRepository();
          const localClaims: string[] = [];

          while (true) {
            const claimed = await localRepository.claimNextUrl(crawlRunId);

            if (claimed === null) {
              break;
            }

            localClaims.push(claimed.id);
          }

          return localClaims;
        }),
      );

      const flattenedClaims = claimedIds.flat();
      const uniqueClaims = new Set(flattenedClaims);

      expect(flattenedClaims).toHaveLength(totalUrls);
      expect(uniqueClaims.size).toBe(totalUrls);
      expect(await repository.countInProgress(crawlRunId)).toBe(totalUrls);
    } finally {
      await cleanupCrawlRun(crawlRunId);
    }
  });
});

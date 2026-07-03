import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../../src/db/pool.js';
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

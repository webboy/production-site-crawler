import { afterAll, describe, expect, it } from 'vitest';
import { closePool, query, withTransaction } from '../../src/db/pool.js';
import { canReachDatabase } from './frontierTestUtils.js';

const databaseReachable = await canReachDatabase();

describe.skipIf(!databaseReachable)('crawl schema', () => {
  afterAll(async () => {
    await closePool();
  });

  it('creates the core tables and enforces URL deduplication per run', async () => {
    const tableResult = await query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('crawl_runs', 'crawl_urls', 'contents', 'url_edges')
      ORDER BY table_name
    `);

    expect(tableResult.rows.map((row) => row.table_name)).toEqual([
      'contents',
      'crawl_runs',
      'crawl_urls',
      'url_edges',
    ]);

    await withTransaction(async (client) => {
      const runResult = await client.query<{ id: string }>(`
        INSERT INTO crawl_runs (seed_url, normalized_seed_url, scope_host)
        VALUES ('https://example.com', 'https://example.com', 'example.com')
        RETURNING id
      `);

      const crawlRunId = runResult.rows[0]?.id;
      expect(crawlRunId).toBeDefined();

      await client.query(
        `
          INSERT INTO crawl_urls (crawl_run_id, url, normalized_url, url_hash, host)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          crawlRunId,
          'https://example.com',
          'https://example.com',
          'example-url-hash',
          'example.com',
        ],
      );

      await expect(
        client.query(
          `
            INSERT INTO crawl_urls (crawl_run_id, url, normalized_url, url_hash, host)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            crawlRunId,
            'https://example.com/',
            'https://example.com',
            'example-url-hash-duplicate',
            'example.com',
          ],
        ),
      ).rejects.toThrow();
    });
  });
});

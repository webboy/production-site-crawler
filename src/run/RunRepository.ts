import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import type { CrawlRun, CrawlRunRow, CrawlRunStatus, CreateRunInput } from './types.js';
import { mapCrawlRunRow } from './types.js';

const CRAWL_RUN_COLUMNS = `
  id,
  seed_url,
  normalized_seed_url,
  scope_host,
  scope_policy,
  status,
  max_urls,
  max_depth,
  max_bytes,
  max_runtime_seconds,
  concurrency,
  total_bytes,
  started_at,
  finished_at,
  updated_at
`;

export class RunRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(input: CreateRunInput): Promise<CrawlRun> {
    const result = await this.pool.query<CrawlRunRow>(
      `
        INSERT INTO crawl_runs (
          seed_url,
          normalized_seed_url,
          scope_host,
          scope_policy,
          max_urls,
          max_depth,
          max_bytes,
          max_runtime_seconds,
          concurrency
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING ${CRAWL_RUN_COLUMNS}
      `,
      [
        input.seedUrl,
        input.normalizedSeedUrl,
        input.scopeHost,
        input.scopePolicy,
        input.maxUrls,
        input.maxDepth,
        input.maxBytes,
        input.maxRuntimeSeconds,
        input.concurrency,
      ],
    );

    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('Failed to create crawl run');
    }

    return mapCrawlRunRow(row);
  }

  async getById(id: string): Promise<CrawlRun | null> {
    const result = await this.pool.query<CrawlRunRow>(
      `
        SELECT ${CRAWL_RUN_COLUMNS}
        FROM crawl_runs
        WHERE id = $1
      `,
      [id],
    );

    const row = result.rows[0];

    return row === undefined ? null : mapCrawlRunRow(row);
  }

  async updateStatus(id: string, status: CrawlRunStatus): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_runs
        SET status = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [id, status],
    );
  }

  async finish(id: string, status: CrawlRunStatus): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_runs
        SET status = $2,
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [id, status],
    );
  }

  async addBytes(id: string, bytes: number): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_runs
        SET total_bytes = total_bytes + $2,
            updated_at = now()
        WHERE id = $1
      `,
      [id, bytes],
    );
  }
}

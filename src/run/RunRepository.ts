import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import type {
  CrawlRun,
  CrawlRunRow,
  CrawlRunStatus,
  CreateRunInput,
  UpdateRunConfigInput,
} from './types.js';
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
  output_dir,
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
          concurrency,
          output_dir
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        input.outputDir,
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

  async pause(id: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_runs
        SET status = 'paused',
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [id],
    );
  }

  async markRunning(id: string, updates: UpdateRunConfigInput = {}): Promise<CrawlRun> {
    const result = await this.pool.query<CrawlRunRow>(
      `
        UPDATE crawl_runs
        SET status = 'running',
            finished_at = NULL,
            concurrency = COALESCE($2, concurrency),
            max_urls = COALESCE($3, max_urls),
            max_depth = COALESCE($4, max_depth),
            max_bytes = COALESCE($5, max_bytes),
            max_runtime_seconds = COALESCE($6, max_runtime_seconds),
            updated_at = now()
        WHERE id = $1
        RETURNING ${CRAWL_RUN_COLUMNS}
      `,
      [
        id,
        updates.concurrency ?? null,
        updates.maxUrls ?? null,
        updates.maxDepth ?? null,
        updates.maxBytes ?? null,
        updates.maxRuntimeSeconds ?? null,
      ],
    );

    const row = result.rows[0];

    if (row === undefined) {
      throw new Error(`Failed to mark crawl run ${id} as running`);
    }

    return mapCrawlRunRow(row);
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

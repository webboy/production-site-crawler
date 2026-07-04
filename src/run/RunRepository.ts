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
  urls_enqueued,
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

  async markRunning(
    id: string,
    updates: UpdateRunConfigInput = {},
    allowedStatuses?: CrawlRunStatus[],
    staleBefore?: Date,
  ): Promise<CrawlRun | null> {
    const setClauses = ["status = 'running'", 'finished_at = NULL'];
    const values: unknown[] = [id];

    const appendUpdate = (column: string, value: unknown): void => {
      values.push(value);
      setClauses.push(`${column} = $${values.length}`);
    };

    if (updates.concurrency !== undefined) {
      appendUpdate('concurrency', updates.concurrency);
    }

    if (Object.hasOwn(updates, 'maxUrls') && updates.maxUrls !== undefined) {
      appendUpdate('max_urls', updates.maxUrls);
    }

    if (Object.hasOwn(updates, 'maxDepth') && updates.maxDepth !== undefined) {
      appendUpdate('max_depth', updates.maxDepth);
    }

    if (Object.hasOwn(updates, 'maxBytes') && updates.maxBytes !== undefined) {
      appendUpdate('max_bytes', updates.maxBytes);
    }

    if (Object.hasOwn(updates, 'maxRuntimeSeconds') && updates.maxRuntimeSeconds !== undefined) {
      appendUpdate('max_runtime_seconds', updates.maxRuntimeSeconds);
    }

    setClauses.push('updated_at = now()');

    const whereClauses = ['id = $1'];

    if (allowedStatuses !== undefined) {
      values.push(allowedStatuses);
      whereClauses.push(`status = ANY($${values.length})`);
    }

    if (staleBefore !== undefined) {
      values.push(staleBefore);
      whereClauses.push(`updated_at < $${values.length}`);
    }

    const result = await this.pool.query<CrawlRunRow>(
      `
        UPDATE crawl_runs
        SET ${setClauses.join(',\n            ')}
        WHERE ${whereClauses.join('\n          AND ')}
        RETURNING ${CRAWL_RUN_COLUMNS}
      `,
      values,
    );

    const row = result.rows[0];

    if (row === undefined) {
      return null;
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

  async touchHeartbeat(id: string): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_runs
        SET updated_at = now()
        WHERE id = $1
          AND status = 'running'
      `,
      [id],
    );
  }
}

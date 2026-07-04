import type { Pool, QueryResultRow } from 'pg';
import { getPool, withTransaction } from '../db/pool.js';
import type {
  CrawlUrlRow,
  CrawlUrlStatus,
  CrawlUrlTask,
  EnqueueUrlInput,
  EnqueueUrlResult,
  MarkBlockedInput,
  MarkPermanentFailureInput,
  MarkRetryableFailureInput,
  MarkRedirectedInput,
  MarkSkippedUnsupportedInput,
  MarkSucceededInput,
  RequeueRedirectInput,
  StatusCounts,
} from './types.js';
import { mapCrawlUrlRow } from './types.js';

const CRAWL_URL_COLUMNS = `
  id,
  crawl_run_id,
  url,
  normalized_url,
  url_hash,
  host,
  depth,
  redirect_count,
  status,
  http_status_code,
  content_type,
  attempt_count,
  max_attempts,
  next_attempt_at,
  last_error,
  last_error_type,
  discovered_from_url_id,
  claimed_at,
  finished_at,
  created_at,
  updated_at
`;

const ALL_STATUSES: CrawlUrlStatus[] = [
  'queued',
  'in_progress',
  'done',
  'retryable_failed',
  'permanent_failed',
  'blocked',
  'skipped_unsupported',
  'redirected',
];

interface CountRow extends QueryResultRow {
  count: string;
}

interface StatusCountRow extends QueryResultRow {
  status: CrawlUrlStatus;
  count: string;
}

interface RunLimitRow extends QueryResultRow {
  max_urls: number | null;
  urls_enqueued: number;
}

export class FrontierRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async enqueueUrl(input: EnqueueUrlInput): Promise<EnqueueUrlResult> {
    return withTransaction(async (client) => {
      const existingResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM crawl_urls
          WHERE crawl_run_id = $1
            AND normalized_url = $2
        `,
        [input.crawlRunId, input.normalizedUrl],
      );

      const existingId = existingResult.rows[0]?.id;

      if (existingId !== undefined) {
        return { id: existingId, inserted: false };
      }

      const runResult = await client.query<RunLimitRow>(
        `
          SELECT max_urls, urls_enqueued
          FROM crawl_runs
          WHERE id = $1
          FOR UPDATE
        `,
        [input.crawlRunId],
      );

      const runRow = runResult.rows[0];

      if (runRow === undefined) {
        throw new Error(`Crawl run not found: ${input.crawlRunId}`);
      }

      if (runRow.max_urls !== null && runRow.urls_enqueued >= runRow.max_urls) {
        return { id: null, inserted: false, skippedLimit: true };
      }

      const insertResult = await client.query<{ id: string }>(
        `
          INSERT INTO crawl_urls (
            crawl_run_id,
            url,
            normalized_url,
            url_hash,
            host,
            depth,
            redirect_count,
            status,
            discovered_from_url_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)
          RETURNING id
        `,
        [
          input.crawlRunId,
          input.url,
          input.normalizedUrl,
          input.urlHash,
          input.host,
          input.depth,
          input.redirectCount ?? 0,
          input.discoveredFromUrlId ?? null,
        ],
      );

      const insertedId = insertResult.rows[0]?.id;

      if (insertedId === undefined) {
        throw new Error('Failed to insert crawl URL');
      }

      await client.query(
        `
          UPDATE crawl_runs
          SET urls_enqueued = urls_enqueued + 1,
              updated_at = now()
          WHERE id = $1
        `,
        [input.crawlRunId],
      );

      return { id: insertedId, inserted: true };
    });
  }

  async findByNormalizedUrl(crawlRunId: string, normalizedUrl: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `
        SELECT id
        FROM crawl_urls
        WHERE crawl_run_id = $1
          AND normalized_url = $2
      `,
      [crawlRunId, normalizedUrl],
    );

    return result.rows[0]?.id ?? null;
  }

  async claimNextUrl(crawlRunId: string): Promise<CrawlUrlTask | null> {
    return withTransaction(async (client) => {
      const claimResult = await client.query<CrawlUrlRow>(
        `
          SELECT ${CRAWL_URL_COLUMNS}
          FROM crawl_urls
          WHERE crawl_run_id = $1
            AND status IN ('queued', 'retryable_failed')
            AND next_attempt_at <= now()
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
        [crawlRunId],
      );

      const claimed = claimResult.rows[0];

      if (claimed === undefined) {
        return null;
      }

      const updateResult = await client.query<CrawlUrlRow>(
        `
          UPDATE crawl_urls
          SET status = 'in_progress',
              claimed_at = now(),
              updated_at = now()
          WHERE id = $1
          RETURNING ${CRAWL_URL_COLUMNS}
        `,
        [claimed.id],
      );

      const updated = updateResult.rows[0];

      if (updated === undefined) {
        throw new Error(`Failed to claim crawl URL ${claimed.id}`);
      }

      return mapCrawlUrlRow(updated);
    });
  }

  async markSucceeded(taskId: string, input: MarkSucceededInput): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'done',
            http_status_code = $2,
            content_type = $3,
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [taskId, input.httpStatusCode, input.contentType],
    );
  }

  async markRetryableFailure(taskId: string, input: MarkRetryableFailureInput): Promise<void> {
    const consumesAttempt = input.consumesAttempt !== false;

    await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'retryable_failed',
            http_status_code = $2,
            attempt_count = CASE WHEN $6 = false THEN attempt_count ELSE attempt_count + 1 END,
            next_attempt_at = $3,
            last_error = $4,
            last_error_type = $5,
            claimed_at = NULL,
            updated_at = now()
        WHERE id = $1
      `,
      [
        taskId,
        input.httpStatusCode ?? null,
        input.nextAttemptAt,
        input.lastError,
        input.lastErrorType,
        consumesAttempt,
      ],
    );
  }

  async markPermanentFailure(taskId: string, input: MarkPermanentFailureInput): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'permanent_failed',
            http_status_code = $2,
            last_error = $3,
            last_error_type = $4,
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [taskId, input.httpStatusCode, input.lastError, input.lastErrorType],
    );
  }

  async markBlocked(taskId: string, input: MarkBlockedInput): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'blocked',
            http_status_code = $2,
            last_error = $3,
            last_error_type = 'blocked',
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [taskId, input.httpStatusCode, input.reason],
    );
  }

  async markSkippedUnsupported(taskId: string, input: MarkSkippedUnsupportedInput): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'skipped_unsupported',
            content_type = $2,
            last_error = $3,
            last_error_type = 'unsupported_content_type',
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [taskId, input.contentType, input.reason],
    );
  }

  async markRedirected(taskId: string, input: MarkRedirectedInput): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'redirected',
            http_status_code = $2,
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [taskId, input.httpStatusCode],
    );
  }

  async requeueForRedirect(taskId: string, input: RequeueRedirectInput): Promise<void> {
    await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'queued',
            url = $2,
            http_status_code = $3,
            redirect_count = redirect_count + 1,
            next_attempt_at = now(),
            claimed_at = NULL,
            finished_at = NULL,
            updated_at = now()
        WHERE id = $1
      `,
      [taskId, input.url, input.httpStatusCode],
    );
  }

  async recoverStaleInProgress(crawlRunId: string, olderThanMs: number): Promise<number> {
    const result = await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'queued',
            claimed_at = NULL,
            updated_at = now()
        WHERE crawl_run_id = $1
          AND status = 'in_progress'
          AND claimed_at < now() - ($2 * interval '1 millisecond')
      `,
      [crawlRunId, olderThanMs],
    );

    return result.rowCount ?? 0;
  }

  async recoverAllInProgress(crawlRunId: string): Promise<number> {
    const result = await this.pool.query(
      `
        UPDATE crawl_urls
        SET status = 'queued',
            claimed_at = NULL,
            updated_at = now()
        WHERE crawl_run_id = $1
          AND status = 'in_progress'
      `,
      [crawlRunId],
    );

    return result.rowCount ?? 0;
  }

  async countInProgress(crawlRunId: string): Promise<number> {
    const result = await this.pool.query<CountRow>(
      `
        SELECT count(*)::text AS count
        FROM crawl_urls
        WHERE crawl_run_id = $1
          AND status = 'in_progress'
      `,
      [crawlRunId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async countFutureRetryable(crawlRunId: string): Promise<number> {
    const result = await this.pool.query<CountRow>(
      `
        SELECT count(*)::text AS count
        FROM crawl_urls
        WHERE crawl_run_id = $1
          AND status = 'retryable_failed'
          AND next_attempt_at > now()
      `,
      [crawlRunId],
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async getStatusCounts(crawlRunId: string): Promise<StatusCounts> {
    const counts = Object.fromEntries(ALL_STATUSES.map((status) => [status, 0])) as StatusCounts;

    const result = await this.pool.query<StatusCountRow>(
      `
        SELECT status, count(*)::text AS count
        FROM crawl_urls
        WHERE crawl_run_id = $1
        GROUP BY status
      `,
      [crawlRunId],
    );

    for (const row of result.rows) {
      counts[row.status] = Number(row.count);
    }

    return counts;
  }
}

import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import type { CrawlUrlStatus } from '../../src/frontier/types.js';
import {
  buildUrlInput,
  canReachDatabase,
  closeDatabasePool,
  cleanupCrawlRun,
  createFrontierRepository,
  insertCrawlRun,
} from './frontierTestUtils.js';

const databaseReachable = await canReachDatabase();

async function readUrl(id: string) {
  const result = await query<{
    status: CrawlUrlStatus;
    http_status_code: number | null;
    content_type: string | null;
    attempt_count: number;
    last_error: string | null;
    last_error_type: string | null;
    finished_at: Date | null;
  }>(
    `
      SELECT status, http_status_code, content_type, attempt_count, last_error, last_error_type, finished_at
      FROM crawl_urls
      WHERE id = $1
    `,
    [id],
  );

  return result.rows[0];
}

describe.skipIf(!databaseReachable)('FrontierRepository claiming and transitions', () => {
  afterAll(async () => {
    await closeDatabasePool();
  });

  it('claims a queued URL and marks it succeeded', async () => {
    const repository = createFrontierRepository();
    const crawlRunId = await insertCrawlRun();

    try {
      const enqueued = await repository.enqueueUrl(buildUrlInput(crawlRunId, 1));
      const claimed = await repository.claimNextUrl(crawlRunId);

      expect(claimed?.id).toBe(enqueued.id);
      expect(claimed?.status).toBe('in_progress');
      expect(await repository.countInProgress(crawlRunId)).toBe(1);

      await repository.markSucceeded(enqueued.id, {
        httpStatusCode: 200,
        contentType: 'text/html',
      });

      const row = await readUrl(enqueued.id);
      expect(row).toMatchObject({
        status: 'done',
        http_status_code: 200,
        content_type: 'text/html',
      });
      expect(row?.finished_at).toBeInstanceOf(Date);
    } finally {
      await cleanupCrawlRun(crawlRunId);
    }
  });

  it('only claims retryable failures after next_attempt_at is due', async () => {
    const repository = createFrontierRepository();
    const crawlRunId = await insertCrawlRun();

    try {
      const enqueued = await repository.enqueueUrl(buildUrlInput(crawlRunId, 2));
      await repository.markRetryableFailure(enqueued.id, {
        nextAttemptAt: new Date(Date.now() + 60_000),
        lastError: 'temporary failure',
        lastErrorType: 'network',
        httpStatusCode: 500,
      });

      expect(await repository.countFutureRetryable(crawlRunId)).toBe(1);
      expect(await repository.claimNextUrl(crawlRunId)).toBeNull();

      await query(
        `
          UPDATE crawl_urls
          SET next_attempt_at = now() - interval '1 second'
          WHERE id = $1
        `,
        [enqueued.id],
      );

      const claimed = await repository.claimNextUrl(crawlRunId);
      expect(claimed?.id).toBe(enqueued.id);
      expect(claimed?.attemptCount).toBe(1);
    } finally {
      await cleanupCrawlRun(crawlRunId);
    }
  });

  it('records permanent, blocked, and unsupported outcomes mechanically', async () => {
    const repository = createFrontierRepository();
    const crawlRunId = await insertCrawlRun();

    try {
      const permanent = await repository.enqueueUrl(buildUrlInput(crawlRunId, 3));
      const blocked = await repository.enqueueUrl(buildUrlInput(crawlRunId, 4));
      const unsupported = await repository.enqueueUrl(buildUrlInput(crawlRunId, 5));

      await repository.markPermanentFailure(permanent.id, {
        httpStatusCode: 404,
        lastError: 'not found',
        lastErrorType: 'http_status',
      });
      await repository.markBlocked(blocked.id, {
        httpStatusCode: 403,
        reason: 'forbidden',
      });
      await repository.markSkippedUnsupported(unsupported.id, {
        contentType: 'application/zip',
        reason: 'unsupported content type',
      });

      await expect(readUrl(permanent.id)).resolves.toMatchObject({
        status: 'permanent_failed',
        http_status_code: 404,
        last_error_type: 'http_status',
      });
      await expect(readUrl(blocked.id)).resolves.toMatchObject({
        status: 'blocked',
        http_status_code: 403,
        last_error_type: 'blocked',
      });
      await expect(readUrl(unsupported.id)).resolves.toMatchObject({
        status: 'skipped_unsupported',
        content_type: 'application/zip',
        last_error_type: 'unsupported_content_type',
      });

      const counts = await repository.getStatusCounts(crawlRunId);
      expect(counts.permanent_failed).toBe(1);
      expect(counts.blocked).toBe(1);
      expect(counts.skipped_unsupported).toBe(1);

      const redirected = await repository.enqueueUrl(buildUrlInput(crawlRunId, 6));
      await repository.markRedirected(redirected.id, { httpStatusCode: 302 });

      await expect(readUrl(redirected.id)).resolves.toMatchObject({
        status: 'redirected',
        http_status_code: 302,
      });

      const countsAfterRedirect = await repository.getStatusCounts(crawlRunId);
      expect(countsAfterRedirect.redirected).toBe(1);
    } finally {
      await cleanupCrawlRun(crawlRunId);
    }
  });
});

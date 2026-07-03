import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { normalize } from '../../src/url/UrlNormalizer.js';
import {
  canReachDatabase,
  cleanupCrawlRun,
  closeDatabasePool,
  getUrlIdByNormalizedUrl,
  readCrawlUrl,
  runCrawlWithMocks,
} from './crawlTestUtils.js';

const databaseReachable = await canReachDatabase();

describe.skipIf(!databaseReachable)('crawl redirect handling', () => {
  afterAll(async () => {
    await closeDatabasePool();
  });

  it('follows an in-scope redirect, enqueues the target at the same depth, and marks the source redirected', async () => {
    const seedUrl = 'https://example.com/redirect-source';
    const targetUrl = 'https://example.com/redirect-target';
    const normalizedSeedUrl = normalize(seedUrl);
    const normalizedTargetUrl = normalize(targetUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: {
          statusCode: 302,
          headers: { Location: '/redirect-target' },
          body: null,
        },
        [targetUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
      },
    });

    try {
      expect(summary.statusCounts.redirected).toBe(1);
      expect(summary.statusCounts.done).toBe(1);

      if (normalizedSeedUrl === null || normalizedTargetUrl === null) {
        throw new Error('Expected normalized URLs');
      }

      const sourceId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);
      const targetId = await getUrlIdByNormalizedUrl(runId, normalizedTargetUrl);

      if (sourceId === null || targetId === null) {
        throw new Error('Expected source and target URL rows');
      }

      await expect(readCrawlUrl(sourceId)).resolves.toMatchObject({
        status: 'redirected',
        http_status_code: 302,
        attempt_count: 0,
      });

      await expect(readCrawlUrl(targetId)).resolves.toMatchObject({
        status: 'done',
        redirect_count: 1,
      });

      const edgeResult = await query<{ source: string; to_url_id: string | null }>(
        `
          SELECT source, to_url_id
          FROM url_edges
          WHERE crawl_run_id = $1
            AND from_url_id = $2
        `,
        [runId, sourceId],
      );

      expect(edgeResult.rows[0]).toMatchObject({
        source: 'redirect',
        to_url_id: targetId,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('marks missing Location as permanent_failed without retry', async () => {
    const seedUrl = 'https://example.com/redirect-missing-location';
    const normalizedSeedUrl = normalize(seedUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: { statusCode: 302, headers: {}, body: null },
      },
    });

    try {
      expect(summary.statusCounts.permanent_failed).toBe(1);
      expect(summary.statusCounts.retryable_failed).toBe(0);

      if (normalizedSeedUrl === null) {
        throw new Error('Expected normalized seed URL');
      }

      const sourceId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (sourceId === null) {
        throw new Error('Expected seed URL row');
      }

      await expect(readCrawlUrl(sourceId)).resolves.toMatchObject({
        status: 'permanent_failed',
        last_error_type: 'redirect_missing_location',
        attempt_count: 0,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('records an out-of-scope redirect as redirected without enqueueing the target', async () => {
    const seedUrl = 'https://example.com/redirect-out-of-scope';
    const targetUrl = 'https://outside.example.org/page';
    const normalizedSeedUrl = normalize(seedUrl);
    const normalizedTargetUrl = normalize(targetUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: {
          statusCode: 301,
          headers: { Location: targetUrl },
          body: null,
        },
      },
    });

    try {
      expect(summary.statusCounts.redirected).toBe(1);
      expect(summary.statusCounts.done).toBe(0);

      if (normalizedSeedUrl === null || normalizedTargetUrl === null) {
        throw new Error('Expected normalized URLs');
      }

      expect(await getUrlIdByNormalizedUrl(runId, normalizedTargetUrl)).toBeNull();

      const sourceId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (sourceId === null) {
        throw new Error('Expected seed URL row');
      }

      const edgeResult = await query<{ to_url_id: string | null; in_scope: boolean }>(
        `
          SELECT to_url_id, in_scope
          FROM url_edges
          WHERE crawl_run_id = $1
            AND from_url_id = $2
        `,
        [runId, sourceId],
      );

      expect(edgeResult.rows[0]).toMatchObject({
        to_url_id: null,
        in_scope: false,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('follows a redirect chain and increments redirect_count on each hop', async () => {
    const urlA = 'https://example.com/chain-a';
    const urlB = 'https://example.com/chain-b';
    const urlC = 'https://example.com/chain-c';
    const normalizedC = normalize(urlC);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl: urlA,
      mockResponses: {
        [urlA]: {
          statusCode: 302,
          headers: { Location: urlB },
          body: null,
        },
        [urlB]: {
          statusCode: 307,
          headers: { Location: urlC },
          body: null,
        },
        [urlC]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html></html>'),
        },
      },
    });

    try {
      expect(summary.statusCounts.redirected).toBe(2);
      expect(summary.statusCounts.done).toBe(1);

      if (normalizedC === null) {
        throw new Error('Expected normalized target URL');
      }

      const targetId = await getUrlIdByNormalizedUrl(runId, normalizedC);

      if (targetId === null) {
        throw new Error('Expected final target URL row');
      }

      await expect(readCrawlUrl(targetId)).resolves.toMatchObject({
        status: 'done',
        redirect_count: 2,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });
});

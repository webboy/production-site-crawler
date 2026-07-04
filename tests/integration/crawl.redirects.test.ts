import { afterAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/pool.js';
import { normalize } from '../../src/url/UrlNormalizer.js';
import { MAX_REDIRECTS } from '../../src/worker/constants.js';
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

  it('re-fetches a trailing-slash self-redirect on the same row', async () => {
    const seedUrl = 'https://example.com/en';
    const targetUrl = 'https://example.com/en/';
    const normalizedSeedUrl = normalize(seedUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: {
          statusCode: 301,
          headers: { Location: '/en/' },
          body: null,
        },
        [targetUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html><title>ok</title></html>'),
        },
      },
    });

    try {
      expect(summary.statusCounts.redirected).toBe(0);
      expect(summary.statusCounts.done).toBe(1);

      if (normalizedSeedUrl === null) {
        throw new Error('Expected normalized seed URL');
      }

      const sourceId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (sourceId === null) {
        throw new Error('Expected seed URL row');
      }

      await expect(readCrawlUrl(sourceId)).resolves.toMatchObject({
        status: 'done',
        http_status_code: 200,
        redirect_count: 1,
      });

      const rowResult = await query<{ url: string }>(
        `
          SELECT url
          FROM crawl_urls
          WHERE id = $1
        `,
        [sourceId],
      );

      expect(rowResult.rows[0]?.url).toBe(targetUrl);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('re-fetches an http to https self-redirect on the same row', async () => {
    const seedUrl = 'http://example.com/scheme';
    const targetUrl = 'https://example.com/scheme';
    const normalizedSeedUrl = normalize(seedUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: {
          statusCode: 301,
          headers: { Location: targetUrl },
          body: null,
        },
        [targetUrl]: {
          statusCode: 200,
          headers: { 'Content-Type': 'text/html' },
          body: Buffer.from('<html><title>ok</title></html>'),
        },
      },
    });

    try {
      expect(summary.statusCounts.redirected).toBe(0);
      expect(summary.statusCounts.done).toBe(1);

      if (normalizedSeedUrl === null) {
        throw new Error('Expected normalized seed URL');
      }

      const sourceId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (sourceId === null) {
        throw new Error('Expected seed URL row');
      }

      await expect(readCrawlUrl(sourceId)).resolves.toMatchObject({
        status: 'done',
        http_status_code: 200,
        redirect_count: 1,
      });

      const rowResult = await query<{ url: string }>(
        `
          SELECT url
          FROM crawl_urls
          WHERE id = $1
        `,
        [sourceId],
      );

      expect(rowResult.rows[0]?.url).toBe(targetUrl);
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('bounds an endless self-redirect loop with MAX_REDIRECTS', async () => {
    const seedUrl = 'https://example.com/self-loop';
    const targetUrl = 'https://example.com/self-loop/';
    const normalizedSeedUrl = normalize(seedUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: {
          statusCode: 301,
          headers: { Location: '/self-loop/' },
          body: null,
        },
        [targetUrl]: {
          statusCode: 301,
          headers: { Location: '/self-loop/' },
          body: null,
        },
      },
    });

    try {
      expect(summary.statusCounts.done).toBe(0);
      expect(summary.statusCounts.redirected).toBe(0);
      expect(summary.statusCounts.permanent_failed).toBe(1);

      if (normalizedSeedUrl === null) {
        throw new Error('Expected normalized seed URL');
      }

      const sourceId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (sourceId === null) {
        throw new Error('Expected seed URL row');
      }

      await expect(readCrawlUrl(sourceId)).resolves.toMatchObject({
        status: 'permanent_failed',
        last_error_type: 'redirect_limit_exceeded',
        redirect_count: MAX_REDIRECTS,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('marks invalid Location as permanent_failed without recording a redirect edge', async () => {
    const seedUrl = 'https://example.com/redirect-invalid-location';
    const normalizedSeedUrl = normalize(seedUrl);

    const { summary, runId } = await runCrawlWithMocks({
      seedUrl,
      mockResponses: {
        [seedUrl]: {
          statusCode: 302,
          headers: { Location: 'javascript:void(0)' },
          body: null,
        },
      },
    });

    try {
      expect(summary.statusCounts.permanent_failed).toBe(1);
      expect(summary.statusCounts.redirected).toBe(0);

      if (normalizedSeedUrl === null) {
        throw new Error('Expected normalized seed URL');
      }

      const sourceId = await getUrlIdByNormalizedUrl(runId, normalizedSeedUrl);

      if (sourceId === null) {
        throw new Error('Expected seed URL row');
      }

      await expect(readCrawlUrl(sourceId)).resolves.toMatchObject({
        status: 'permanent_failed',
        last_error_type: 'redirect_invalid_location',
        attempt_count: 0,
      });

      const edgeResult = await query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM url_edges
          WHERE crawl_run_id = $1
        `,
        [runId],
      );

      expect(Number(edgeResult.rows[0]?.count ?? 0)).toBe(0);
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

      const edgeResult = await query<{
        to_url_id: string | null;
        in_scope: boolean;
        skip_reason: string | null;
      }>(
        `
          SELECT to_url_id, in_scope, skip_reason
          FROM url_edges
          WHERE crawl_run_id = $1
            AND from_url_id = $2
        `,
        [runId, sourceId],
      );

      expect(edgeResult.rows[0]).toMatchObject({
        to_url_id: null,
        in_scope: false,
        skip_reason: 'scope',
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

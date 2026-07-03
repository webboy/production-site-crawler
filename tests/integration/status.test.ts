import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { query, closePool } from '../../src/db/pool.js';
import { StatusService } from '../../src/status/StatusService.js';
import { canReachDatabase, cleanupCrawlRun } from './frontierTestUtils.js';

const databaseReachable = await canReachDatabase();

describe.skipIf(!databaseReachable)('status integration', () => {
  afterAll(async () => {
    await closePool();
  });

  it('aggregates run, URL status counts, content kinds, and bytes', async () => {
    const runId = randomUUID();
    const crawlUrlIds = {
      done: randomUUID(),
      queued: randomUUID(),
      blocked: randomUUID(),
    };

    await query(
      `
        INSERT INTO crawl_runs (
          id,
          seed_url,
          normalized_seed_url,
          scope_host,
          scope_policy,
          status,
          total_bytes,
          finished_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        runId,
        'https://example.com/status-seed',
        'https://example.com/status-seed',
        'example.com',
        'registrable_domain',
        'completed_with_failures',
        12345,
        new Date('2026-07-03T12:00:00.000Z'),
      ],
    );

    await query(
      `
        INSERT INTO crawl_urls (
          id,
          crawl_run_id,
          url,
          normalized_url,
          url_hash,
          host,
          depth,
          status
        )
        VALUES
          ($1, $2, $3, $4, $5, $6, 0, 'done'),
          ($7, $2, $8, $9, $10, $6, 0, 'queued'),
          ($11, $2, $12, $13, $14, $6, 0, 'blocked')
      `,
      [
        crawlUrlIds.done,
        runId,
        'https://example.com/page-done',
        'https://example.com/page-done',
        'hash-done',
        'example.com',
        crawlUrlIds.queued,
        'https://example.com/page-queued',
        'https://example.com/page-queued',
        'hash-queued',
        crawlUrlIds.blocked,
        'https://example.com/page-blocked',
        'https://example.com/page-blocked',
        'hash-blocked',
      ],
    );

    await query(
      `
        INSERT INTO contents (
          crawl_url_id,
          crawl_run_id,
          kind,
          content_type,
          file_path,
          byte_size,
          content_hash
        )
        VALUES
          ($1, $2, 'html', 'text/html', '/tmp/a.html', 100, 'hash-a'),
          ($3, $2, 'image', 'image/png', '/tmp/a.png', 200, 'hash-b'),
          ($4, $2, 'pdf', 'application/pdf', '/tmp/a.pdf', 300, 'hash-c')
      `,
      [crawlUrlIds.done, runId, crawlUrlIds.queued, crawlUrlIds.blocked],
    );

    try {
      const report = await new StatusService().getReport(runId);

      expect(report).not.toBeNull();
      expect(report?.runId).toBe(runId);
      expect(report?.seedUrl).toBe('https://example.com/status-seed');
      expect(report?.scopeHost).toBe('example.com');
      expect(report?.scopePolicy).toBe('registrable_domain');
      expect(report?.status).toBe('completed_with_failures');
      expect(report?.bytesDownloaded).toBe(12345);
      expect(report?.urlStatusCounts).toMatchObject({
        done: 1,
        queued: 1,
        blocked: 1,
        in_progress: 0,
        retryable_failed: 0,
        permanent_failed: 0,
        skipped_unsupported: 0,
      });
      expect(report?.contentKindCounts).toEqual({
        html: 1,
        image: 1,
        video: 0,
        pdf: 1,
      });
    } finally {
      await cleanupCrawlRun(runId);
    }
  });

  it('returns null when the run does not exist', async () => {
    const report = await new StatusService().getReport(randomUUID());
    expect(report).toBeNull();
  });
});

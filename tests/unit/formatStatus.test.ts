import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatStatusText,
  serializeStatusReport,
} from '../../src/status/formatStatus.js';
import type { StatusReport } from '../../src/status/StatusService.js';

describe('formatStatus', () => {
  const report: StatusReport = {
    runId: '11111111-1111-4111-8111-111111111111',
    seedUrl: 'https://example.com/en',
    normalizedSeedUrl: 'https://example.com/en',
    scopeHost: 'example.com',
    scopePolicy: 'registrable_domain',
    status: 'completed',
    startedAt: new Date('2026-07-03T10:00:00.000Z'),
    finishedAt: new Date('2026-07-03T10:05:00.000Z'),
    urlStatusCounts: {
      queued: 0,
      in_progress: 0,
      done: 12,
      retryable_failed: 1,
      permanent_failed: 2,
      blocked: 0,
      skipped_unsupported: 1,
      redirected: 0,
    },
    contentKindCounts: {
      html: 10,
      image: 3,
      video: 0,
      pdf: 2,
    },
    bytesDownloaded: 88_289_075,
  };

  it('formats human-readable status text with expected blocks', () => {
    const text = formatStatusText(report);

    expect(text).toContain('Crawl Run 11111111-1111-4111-8111-111111111111');
    expect(text).toContain('Seed: https://example.com/en');
    expect(text).toContain('Scope: example.com (registrable_domain)');
    expect(text).toContain('Status: completed');
    expect(text).toContain('URL counts:');
    expect(text).toContain('  done: 12');
    expect(text).toContain('  skipped_unsupported: 1');
    expect(text).toContain('Content counts:');
    expect(text).toContain('  html: 10');
    expect(text).toContain('  pdf: 2');
    expect(text).toContain('Bytes downloaded: 84.2 MB (88289075 bytes)');
  });

  it('formats byte sizes deterministically', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('serializes a stable JSON shape with raw bytes', () => {
    const json = serializeStatusReport(report);

    expect(json).toEqual({
      runId: report.runId,
      seedUrl: report.seedUrl,
      normalizedSeedUrl: report.normalizedSeedUrl,
      scope: { host: 'example.com', policy: 'registrable_domain' },
      status: 'completed',
      startedAt: '2026-07-03T10:00:00.000Z',
      finishedAt: '2026-07-03T10:05:00.000Z',
      urlStatusCounts: report.urlStatusCounts,
      contentKindCounts: report.contentKindCounts,
      bytesDownloaded: 88_289_075,
    });
  });
});

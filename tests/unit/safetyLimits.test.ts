import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrawlRun } from '../../src/run/types.js';
import { SafetyLimits } from '../../src/worker/SafetyLimits.js';

function createRun(overrides: Partial<CrawlRun> = {}): CrawlRun {
  return {
    id: 'run-id',
    seedUrl: 'https://example.com',
    normalizedSeedUrl: 'https://example.com/',
    scopeHost: 'example.com',
    scopePolicy: 'registrable_domain',
    status: 'running',
    maxUrls: null,
    maxDepth: null,
    maxBytes: null,
    maxRuntimeSeconds: null,
    concurrency: 1,
    outputDir: 'output',
    totalBytes: 0,
    urlsEnqueued: 0,
    startedAt: new Date('2026-07-03T10:00:00.000Z'),
    finishedAt: null,
    updatedAt: new Date('2026-07-03T10:00:00.000Z'),
    ...overrides,
  };
}

describe('SafetyLimits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops when maxRuntimeSeconds is exceeded', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-03T10:00:05.000Z').getTime());

    const limits = new SafetyLimits(
      createRun({ maxRuntimeSeconds: 4 }),
      new Date('2026-07-03T10:00:00.000Z').getTime(),
    );

    await expect(limits.shouldStop()).resolves.toEqual({
      stop: true,
      reason: 'limit_reached',
      limitType: 'runtime',
    });
  });

  it('stops when maxBytes is reached', async () => {
    const limits = new SafetyLimits(
      createRun({ maxBytes: 100, totalBytes: 100 }),
      new Date('2026-07-03T10:00:00.000Z').getTime(),
    );

    await expect(limits.shouldStop()).resolves.toEqual({
      stop: true,
      reason: 'limit_reached',
      limitType: 'bytes',
    });
  });

  it('does not stop when no limits are configured', async () => {
    const limits = new SafetyLimits(createRun(), new Date('2026-07-03T10:00:00.000Z').getTime());

    await expect(limits.shouldStop()).resolves.toEqual({
      stop: false,
    });
  });
});

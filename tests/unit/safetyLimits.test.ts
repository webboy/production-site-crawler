import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FrontierRepository } from '../../src/frontier/FrontierRepository.js';
import type { StatusCounts } from '../../src/frontier/types.js';
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
    startedAt: new Date('2026-07-03T10:00:00.000Z'),
    finishedAt: null,
    updatedAt: new Date('2026-07-03T10:00:00.000Z'),
    ...overrides,
  };
}

function createFrontier(statusCounts: StatusCounts): Pick<FrontierRepository, 'getStatusCounts'> {
  return {
    getStatusCounts: vi.fn(async () => statusCounts),
  };
}

describe('SafetyLimits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops when maxUrls is exceeded', async () => {
    const limits = new SafetyLimits(
      createRun({ maxUrls: 2 }),
      new Date('2026-07-03T10:00:00.000Z').getTime(),
    );
    const frontier = createFrontier({
      queued: 1,
      in_progress: 1,
      done: 1,
      retryable_failed: 0,
      permanent_failed: 0,
      blocked: 0,
      skipped_unsupported: 0,
      redirected: 0,
    });

    await expect(limits.shouldStop(frontier as FrontierRepository)).resolves.toEqual({
      stop: true,
      reason: 'limit_reached',
    });
  });

  it('stops when maxRuntimeSeconds is exceeded', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-03T10:00:05.000Z').getTime());

    const limits = new SafetyLimits(
      createRun({ maxRuntimeSeconds: 4 }),
      new Date('2026-07-03T10:00:00.000Z').getTime(),
    );
    const frontier = createFrontier({
      queued: 0,
      in_progress: 0,
      done: 0,
      retryable_failed: 0,
      permanent_failed: 0,
      blocked: 0,
      skipped_unsupported: 0,
      redirected: 0,
    });

    await expect(limits.shouldStop(frontier as FrontierRepository)).resolves.toEqual({
      stop: true,
      reason: 'limit_reached',
    });
  });

  it('stops when maxBytes is reached', async () => {
    const limits = new SafetyLimits(
      createRun({ maxBytes: 100, totalBytes: 100 }),
      new Date('2026-07-03T10:00:00.000Z').getTime(),
    );
    const frontier = createFrontier({
      queued: 0,
      in_progress: 0,
      done: 0,
      retryable_failed: 0,
      permanent_failed: 0,
      blocked: 0,
      skipped_unsupported: 0,
      redirected: 0,
    });

    await expect(limits.shouldStop(frontier as FrontierRepository)).resolves.toEqual({
      stop: true,
      reason: 'limit_reached',
    });
  });

  it('does not stop when no limits are configured', async () => {
    const limits = new SafetyLimits(createRun(), new Date('2026-07-03T10:00:00.000Z').getTime());
    const frontier = createFrontier({
      queued: 10,
      in_progress: 0,
      done: 0,
      retryable_failed: 0,
      permanent_failed: 0,
      blocked: 0,
      skipped_unsupported: 0,
      redirected: 0,
    });

    await expect(limits.shouldStop(frontier as FrontierRepository)).resolves.toEqual({
      stop: false,
    });
    expect(frontier.getStatusCounts).not.toHaveBeenCalled();
  });
});

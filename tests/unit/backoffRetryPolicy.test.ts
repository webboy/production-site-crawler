import { describe, expect, it } from 'vitest';
import type { CrawlUrlTask } from '../../src/frontier/types.js';
import { BackoffRetryPolicy, consumesAttemptForReason } from '../../src/worker/RetryPolicy.js';

function createTask(attemptCount: number, maxAttempts = 5): CrawlUrlTask {
  return {
    id: 'task-id',
    crawlRunId: 'run-id',
    url: 'https://example.com/page',
    normalizedUrl: 'https://example.com/page',
    urlHash: 'hash',
    host: 'example.com',
    depth: 0,
    redirectCount: 0,
    status: 'retryable_failed',
    httpStatusCode: 500,
    contentType: null,
    attemptCount,
    maxAttempts,
    nextAttemptAt: new Date('2026-07-03T12:00:00.000Z'),
    lastError: 'Server error',
    lastErrorType: 'server_error',
    discoveredFromUrlId: null,
    claimedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-07-03T12:00:00.000Z'),
    updatedAt: new Date('2026-07-03T12:00:00.000Z'),
  };
}

describe('BackoffRetryPolicy', () => {
  const now = new Date('2026-07-03T12:00:00.000Z');

  it('returns retry false when the next attempt would exhaust max attempts', () => {
    const policy = new BackoffRetryPolicy({
      now: () => now,
      random: () => 0.5,
    });

    expect(policy.decide(createTask(4), 'server_error')).toMatchObject({
      retry: false,
      consumesAttempt: true,
    });
  });

  it('grows delay exponentially and caps at maxDelayMs', () => {
    const policy = new BackoffRetryPolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 4_000,
      jitterRatio: 0,
      now: () => now,
      random: () => 0.5,
    });

    expect(policy.computeBackoffMs(0)).toBe(1_000);
    expect(policy.computeBackoffMs(1)).toBe(2_000);
    expect(policy.computeBackoffMs(2)).toBe(4_000);
    expect(policy.computeBackoffMs(3)).toBe(4_000);
  });

  it('applies symmetric jitter within bounds', () => {
    const policy = new BackoffRetryPolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitterRatio: 0.25,
      now: () => now,
      random: () => 0,
    });

    expect(policy.computeBackoffMs(0)).toBe(750);

    const upperPolicy = new BackoffRetryPolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitterRatio: 0.25,
      now: () => now,
      random: () => 1,
    });

    expect(upperPolicy.computeBackoffMs(0)).toBe(1_250);
  });

  it('uses retryAfterMs directly for rate_limited without consuming attempt budget', () => {
    const policy = new BackoffRetryPolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitterRatio: 0,
      rateLimitFallbackMs: 5_000,
      now: () => now,
      random: () => 0.5,
    });

    const shortRetryAfter = policy.decide(createTask(0), 'rate_limited', { retryAfterMs: 500 });
    expect(shortRetryAfter).toMatchObject({
      retry: true,
      consumesAttempt: false,
    });
    expect(shortRetryAfter.nextAttemptAt.toISOString()).toBe('2026-07-03T12:00:00.500Z');

    const fallback = policy.decide(createTask(0), 'rate_limited');
    expect(fallback.nextAttemptAt.toISOString()).toBe('2026-07-03T12:00:05.000Z');
  });

  it('still retries rate_limited when attempt budget is exhausted', () => {
    const policy = new BackoffRetryPolicy({
      now: () => now,
      random: () => 0.5,
    });

    expect(policy.decide(createTask(5), 'rate_limited')).toMatchObject({
      retry: true,
      consumesAttempt: false,
    });
  });
});

describe('consumesAttemptForReason', () => {
  it('exempts rate_limited only', () => {
    expect(consumesAttemptForReason('rate_limited')).toBe(false);
    expect(consumesAttemptForReason('server_error')).toBe(true);
  });
});

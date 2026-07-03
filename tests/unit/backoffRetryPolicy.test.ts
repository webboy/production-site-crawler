import { describe, expect, it } from 'vitest';
import type { CrawlUrlTask } from '../../src/frontier/types.js';
import { BackoffRetryPolicy } from '../../src/worker/RetryPolicy.js';

function createTask(attemptCount: number, maxAttempts = 5): CrawlUrlTask {
  return {
    id: 'task-id',
    crawlRunId: 'run-id',
    url: 'https://example.com/page',
    normalizedUrl: 'https://example.com/page',
    urlHash: 'hash',
    host: 'example.com',
    depth: 0,
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

  it('returns retry false when attempt count reaches max attempts', () => {
    const policy = new BackoffRetryPolicy({
      now: () => now,
      random: () => 0.5,
    });

    expect(policy.decide(createTask(5), 'server_error').retry).toBe(false);
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

  it('uses max(retryAfterMs, backoff) when Retry-After context is provided', () => {
    const policy = new BackoffRetryPolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitterRatio: 0,
      now: () => now,
      random: () => 0.5,
    });

    const shortRetryAfter = policy.decide(createTask(0), 'rate_limited', { retryAfterMs: 500 });
    expect(shortRetryAfter.retry).toBe(true);
    expect(shortRetryAfter.nextAttemptAt.toISOString()).toBe('2026-07-03T12:00:01.000Z');

    const longRetryAfter = policy.decide(createTask(0), 'rate_limited', { retryAfterMs: 5_000 });
    expect(longRetryAfter.nextAttemptAt.toISOString()).toBe('2026-07-03T12:00:05.000Z');
  });
});

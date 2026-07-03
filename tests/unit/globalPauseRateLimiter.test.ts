import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalPauseRateLimiter } from '../../src/worker/RateLimiter.js';

describe('GlobalPauseRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies base pacing on wait', async () => {
    let currentMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      currentMs += ms;
      await Promise.resolve();
    });

    const limiter = new GlobalPauseRateLimiter({
      baseDelayMs: 150,
      defaultPauseMs: 5_000,
      now: () => new Date(currentMs),
      sleep,
    });

    const waitPromise = limiter.wait();
    await waitPromise;

    expect(sleep).toHaveBeenCalledWith(150);
  });

  it('pauses a wait caller until Retry-After elapses', async () => {
    let currentMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      currentMs += ms;
      await Promise.resolve();
    });

    const limiter = new GlobalPauseRateLimiter({
      baseDelayMs: 100,
      defaultPauseMs: 5_000,
      now: () => new Date(currentMs),
      sleep,
    });

    limiter.onRateLimited({ 'Retry-After': '10' });

    await limiter.wait();

    expect(sleep).toHaveBeenCalledWith(100);
    expect(sleep).toHaveBeenCalledWith(9_900);
    expect(limiter.getPausedUntilMs()).toBe(10_000);
  });

  it('extends an active pause when a longer Retry-After arrives', async () => {
    let currentMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      currentMs += ms;
      await Promise.resolve();
    });

    const limiter = new GlobalPauseRateLimiter({
      baseDelayMs: 0,
      defaultPauseMs: 1_000,
      now: () => new Date(currentMs),
      sleep,
    });

    limiter.onRateLimited({ 'Retry-After': '5' });
    limiter.onRateLimited({ 'Retry-After': '10' });

    expect(limiter.getPausedUntilMs()).toBe(10_000);
  });

  it('uses the default pause when Retry-After is missing', async () => {
    let currentMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      currentMs += ms;
      await Promise.resolve();
    });

    const limiter = new GlobalPauseRateLimiter({
      baseDelayMs: 0,
      defaultPauseMs: 2_000,
      now: () => new Date(currentMs),
      sleep,
    });

    limiter.onRateLimited({});

    await limiter.wait();

    expect(sleep).toHaveBeenCalledWith(2_000);
  });
});

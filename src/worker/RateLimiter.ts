import type { Logger } from 'pino';
import { getHeader } from '../fetch/headers.js';
import { SIMPLE_RATE_LIMIT_DELAY_MS } from './constants.js';
import { parseRetryAfter } from './retryAfter.js';

export interface RateLimiter {
  wait(): Promise<void>;
  onRateLimited(headers: Record<string, string>): void;
}

export class SimpleRateLimiter implements RateLimiter {
  async wait(): Promise<void> {
    await sleep(SIMPLE_RATE_LIMIT_DELAY_MS);
  }

  onRateLimited(_headers: Record<string, string>): void {
    // Kept for tests and lightweight harnesses.
  }
}

export interface GlobalPauseRateLimiterOptions {
  baseDelayMs?: number;
  defaultPauseMs?: number;
  logger?: Logger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export class GlobalPauseRateLimiter implements RateLimiter {
  private pausedUntilMs = 0;
  private readonly baseDelayMs: number;
  private readonly defaultPauseMs: number;
  private readonly logger?: Logger;
  private readonly now: () => Date;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: GlobalPauseRateLimiterOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? SIMPLE_RATE_LIMIT_DELAY_MS;
    this.defaultPauseMs = options.defaultPauseMs ?? 5_000;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.sleepFn = options.sleep ?? sleep;
  }

  async wait(): Promise<void> {
    await this.sleepFn(this.baseDelayMs);

    while (this.pausedUntilMs > this.now().getTime()) {
      const remainingMs = this.pausedUntilMs - this.now().getTime();
      await this.sleepFn(remainingMs);
    }
  }

  onRateLimited(headers: Record<string, string>): void {
    const retryAfterHeader = getHeader(headers, 'Retry-After');
    const retryAfterMs = parseRetryAfter(retryAfterHeader, this.now());
    const pauseMs = retryAfterMs ?? this.defaultPauseMs;
    const nextPausedUntilMs = this.now().getTime() + pauseMs;

    this.pausedUntilMs = Math.max(this.pausedUntilMs, nextPausedUntilMs);

    this.logger?.info({
      event: 'rate_limited_pause',
      pauseMs,
      pausedUntil: new Date(this.pausedUntilMs).toISOString(),
      retryAfterHeader: retryAfterHeader ?? null,
    });
  }

  getPausedUntilMs(): number {
    return this.pausedUntilMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

import type { CrawlUrlTask } from '../frontier/types.js';
import { SIMPLE_RETRY_DELAY_MS } from './constants.js';

export interface RetryDecision {
  retry: boolean;
  nextAttemptAt: Date;
}

export interface RetryContext {
  retryAfterMs?: number;
}

export interface RetryPolicy {
  decide(task: CrawlUrlTask, reason: string, context?: RetryContext): RetryDecision;
}

export interface BackoffRetryPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  now?: () => Date;
  random?: () => number;
}

export class SimpleRetryPolicy implements RetryPolicy {
  constructor(private readonly delayMs: number = SIMPLE_RETRY_DELAY_MS) {}

  decide(task: CrawlUrlTask, _reason: string, _context?: RetryContext): RetryDecision {
    if (task.attemptCount >= task.maxAttempts) {
      return { retry: false, nextAttemptAt: new Date() };
    }

    return {
      retry: true,
      nextAttemptAt: new Date(Date.now() + this.delayMs),
    };
  }
}

export class BackoffRetryPolicy implements RetryPolicy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterRatio: number;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(options: BackoffRetryPolicyOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 5_000;
    this.maxDelayMs = options.maxDelayMs ?? 300_000;
    this.jitterRatio = options.jitterRatio ?? 0.25;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  decide(task: CrawlUrlTask, _reason: string, context?: RetryContext): RetryDecision {
    if (task.attemptCount >= task.maxAttempts) {
      return { retry: false, nextAttemptAt: this.now() };
    }

    const backoffMs = this.computeBackoffMs(task.attemptCount);
    const delayMs =
      context?.retryAfterMs !== undefined ? Math.max(context.retryAfterMs, backoffMs) : backoffMs;

    return {
      retry: true,
      nextAttemptAt: new Date(this.now().getTime() + delayMs),
    };
  }

  computeBackoffMs(attemptCount: number): number {
    const exponentialDelay = this.baseDelayMs * 2 ** attemptCount;
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
    const jitterMultiplier = 1 + this.random() * 2 * this.jitterRatio - this.jitterRatio;

    return Math.max(0, Math.round(cappedDelay * jitterMultiplier));
  }
}

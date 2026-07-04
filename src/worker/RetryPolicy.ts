import type { CrawlUrlTask } from '../frontier/types.js';
import { SIMPLE_RETRY_DELAY_MS } from './constants.js';

export interface RetryDecision {
  retry: boolean;
  nextAttemptAt: Date;
  consumesAttempt: boolean;
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
  rateLimitFallbackMs?: number;
  now?: () => Date;
  random?: () => number;
}

export function consumesAttemptForReason(reason: string): boolean {
  return reason !== 'rate_limited';
}

export class SimpleRetryPolicy implements RetryPolicy {
  constructor(private readonly delayMs: number = SIMPLE_RETRY_DELAY_MS) {}

  decide(task: CrawlUrlTask, reason: string, _context?: RetryContext): RetryDecision {
    const consumesAttempt = consumesAttemptForReason(reason);

    if (consumesAttempt) {
      const wouldBeAttempt = task.attemptCount + 1;

      if (wouldBeAttempt >= task.maxAttempts) {
        return { retry: false, nextAttemptAt: new Date(), consumesAttempt: true };
      }
    }

    return {
      retry: true,
      nextAttemptAt: new Date(Date.now() + this.delayMs),
      consumesAttempt,
    };
  }
}

export class BackoffRetryPolicy implements RetryPolicy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterRatio: number;
  private readonly rateLimitFallbackMs: number;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(options: BackoffRetryPolicyOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 5_000;
    this.maxDelayMs = options.maxDelayMs ?? 300_000;
    this.jitterRatio = options.jitterRatio ?? 0.25;
    this.rateLimitFallbackMs = options.rateLimitFallbackMs ?? 5_000;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  decide(task: CrawlUrlTask, reason: string, context?: RetryContext): RetryDecision {
    const consumesAttempt = consumesAttemptForReason(reason);

    if (consumesAttempt) {
      const wouldBeAttempt = task.attemptCount + 1;

      if (wouldBeAttempt >= task.maxAttempts) {
        return { retry: false, nextAttemptAt: this.now(), consumesAttempt: true };
      }
    }

    const delayMs =
      reason === 'rate_limited'
        ? (context?.retryAfterMs ?? this.rateLimitFallbackMs)
        : this.computeBackoffMs(task.attemptCount);

    return {
      retry: true,
      nextAttemptAt: new Date(this.now().getTime() + delayMs),
      consumesAttempt,
    };
  }

  computeBackoffMs(attemptCount: number): number {
    const exponentialDelay = this.baseDelayMs * 2 ** attemptCount;
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
    const jitterMultiplier = 1 + this.random() * 2 * this.jitterRatio - this.jitterRatio;

    return Math.max(0, Math.round(cappedDelay * jitterMultiplier));
  }
}

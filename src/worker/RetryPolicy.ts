import type { CrawlUrlTask } from '../frontier/types.js';
import { SIMPLE_RETRY_DELAY_MS } from './constants.js';

export interface RetryDecision {
  retry: boolean;
  nextAttemptAt: Date;
}

export interface RetryPolicy {
  decide(task: CrawlUrlTask, reason: string): RetryDecision;
}

export class SimpleRetryPolicy implements RetryPolicy {
  constructor(private readonly delayMs: number = SIMPLE_RETRY_DELAY_MS) {}

  decide(task: CrawlUrlTask, _reason: string): RetryDecision {
    if (task.attemptCount >= task.maxAttempts) {
      return { retry: false, nextAttemptAt: new Date() };
    }

    return {
      retry: true,
      nextAttemptAt: new Date(Date.now() + this.delayMs),
    };
  }
}

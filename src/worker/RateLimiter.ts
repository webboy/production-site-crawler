import { SIMPLE_RATE_LIMIT_DELAY_MS } from './constants.js';

export interface RateLimiter {
  wait(): Promise<void>;
  onRateLimited(headers: Record<string, string>): void;
}

export class SimpleRateLimiter implements RateLimiter {
  async wait(): Promise<void> {
    await sleep(SIMPLE_RATE_LIMIT_DELAY_MS);
  }

  onRateLimited(_headers: Record<string, string>): void {
    // Phase 7 replaces this with global pause/backoff-aware behavior.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

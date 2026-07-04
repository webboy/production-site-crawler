import type { CrawlRun } from '../run/types.js';

export type SafetyLimitType = 'runtime' | 'bytes';

export interface SafetyLimitDecision {
  stop: boolean;
  reason?: 'limit_reached';
  limitType?: SafetyLimitType;
}

export class SafetyLimits {
  constructor(
    private readonly run: CrawlRun,
    private readonly startedAtMs: number,
  ) {}

  async shouldStop(): Promise<SafetyLimitDecision> {
    if (this.run.maxRuntimeSeconds !== null && this.run.maxRuntimeSeconds > 0) {
      const elapsedMs = Date.now() - this.startedAtMs;

      if (elapsedMs >= this.run.maxRuntimeSeconds * 1000) {
        return { stop: true, reason: 'limit_reached', limitType: 'runtime' };
      }
    }

    if (this.run.maxBytes !== null && this.run.maxBytes > 0) {
      if (this.run.totalBytes >= this.run.maxBytes) {
        return { stop: true, reason: 'limit_reached', limitType: 'bytes' };
      }
    }

    return { stop: false };
  }
}

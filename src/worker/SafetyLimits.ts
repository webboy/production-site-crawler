import type { FrontierRepository } from '../frontier/FrontierRepository.js';
import type { CrawlRun } from '../run/types.js';

export interface SafetyLimitDecision {
  stop: boolean;
  reason?: 'limit_reached';
}

export class SafetyLimits {
  constructor(
    private readonly run: CrawlRun,
    private readonly startedAtMs: number,
  ) {}

  async shouldStop(frontier: FrontierRepository): Promise<SafetyLimitDecision> {
    if (this.run.maxRuntimeSeconds !== null && this.run.maxRuntimeSeconds > 0) {
      const elapsedMs = Date.now() - this.startedAtMs;

      if (elapsedMs >= this.run.maxRuntimeSeconds * 1000) {
        return { stop: true, reason: 'limit_reached' };
      }
    }

    if (this.run.maxBytes !== null && this.run.maxBytes > 0) {
      if (this.run.totalBytes >= this.run.maxBytes) {
        return { stop: true, reason: 'limit_reached' };
      }
    }

    if (this.run.maxUrls !== null && this.run.maxUrls > 0) {
      const statusCounts = await frontier.getStatusCounts(this.run.id);
      const totalUrls = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);

      if (totalUrls > this.run.maxUrls) {
        return { stop: true, reason: 'limit_reached' };
      }
    }

    return { stop: false };
  }
}

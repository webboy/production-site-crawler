import { ContentRepository, type ContentKindCounts } from '../content/ContentRepository.js';
import { FrontierRepository } from '../frontier/FrontierRepository.js';
import type { StatusCounts } from '../frontier/types.js';
import { RunRepository } from '../run/RunRepository.js';
import type { CrawlRunStatus } from '../run/types.js';
import type { ScopePolicyName } from '../url/ScopePolicy.js';

export interface StatusReport {
  runId: string;
  seedUrl: string;
  normalizedSeedUrl: string;
  scopeHost: string;
  scopePolicy: ScopePolicyName;
  status: CrawlRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  urlStatusCounts: StatusCounts;
  contentKindCounts: ContentKindCounts;
  bytesDownloaded: number;
}

export class StatusService {
  constructor(
    private readonly runRepository: RunRepository = new RunRepository(),
    private readonly frontierRepository: FrontierRepository = new FrontierRepository(),
    private readonly contentRepository: ContentRepository = new ContentRepository(),
  ) {}

  async getReport(runId: string): Promise<StatusReport | null> {
    const run = await this.runRepository.getById(runId);

    if (run === null) {
      return null;
    }

    const [urlStatusCounts, contentKindCounts] = await Promise.all([
      this.frontierRepository.getStatusCounts(runId),
      this.contentRepository.countByKind(runId),
    ]);

    return {
      runId: run.id,
      seedUrl: run.seedUrl,
      normalizedSeedUrl: run.normalizedSeedUrl,
      scopeHost: run.scopeHost,
      scopePolicy: run.scopePolicy,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      urlStatusCounts,
      contentKindCounts,
      bytesDownloaded: run.totalBytes,
    };
  }
}

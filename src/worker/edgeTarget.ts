import type { FrontierRepository } from '../frontier/FrontierRepository.js';
import type { CrawlUrlTask } from '../frontier/types.js';
import type { CrawlRun } from '../run/types.js';
import type { ScopePolicy } from '../url/ScopePolicy.js';
import { urlHash } from '../url/urlHash.js';

export type EdgeSkipReason = 'scope' | 'depth' | 'limit';

export interface EdgeCandidate {
  url: string;
  normalizedUrl: string;
  host: string;
  depth: number;
  source: string;
  redirectCount?: number;
}

export interface EdgeTargetDecision {
  toUrlId: string | null;
  inScope: boolean;
  skipReason: EdgeSkipReason | null;
  limitReached?: boolean;
  admittedNew?: boolean;
}

export interface ResolveEdgeTargetDeps {
  run: CrawlRun;
  frontier: FrontierRepository;
  scopePolicy: ScopePolicy;
}

export async function resolveEdgeTarget(
  deps: ResolveEdgeTargetDeps,
  task: CrawlUrlTask,
  candidate: EdgeCandidate,
): Promise<EdgeTargetDecision> {
  const inScope = deps.scopePolicy.isInScope(candidate.normalizedUrl);

  if (!inScope) {
    return { toUrlId: null, inScope: false, skipReason: 'scope' };
  }

  if (deps.run.maxDepth !== null && candidate.depth > deps.run.maxDepth) {
    return { toUrlId: null, inScope: true, skipReason: 'depth' };
  }

  const enqueueResult = await deps.frontier.enqueueUrl({
    crawlRunId: deps.run.id,
    url: candidate.url,
    normalizedUrl: candidate.normalizedUrl,
    urlHash: urlHash(candidate.normalizedUrl),
    host: candidate.host,
    depth: candidate.depth,
    redirectCount: candidate.redirectCount,
    discoveredFromUrlId: task.id,
  });

  if (enqueueResult.skippedLimit) {
    return {
      toUrlId: null,
      inScope: true,
      skipReason: 'limit',
      limitReached: true,
    };
  }

  return {
    toUrlId: enqueueResult.id,
    inScope: true,
    skipReason: null,
    admittedNew: enqueueResult.inserted,
  };
}

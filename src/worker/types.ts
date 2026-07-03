import type { StatusCounts } from '../frontier/types.js';
import type { CrawlRunStatus } from '../run/types.js';

export type ResponseAction =
  | 'success_with_body'
  | 'empty_body'
  | 'not_found'
  | 'blocked'
  | 'rate_limited'
  | 'server_error'
  | 'redirect'
  | 'unexpected';

export interface DiscoveredLink {
  url: string;
  normalizedUrl: string;
  host: string;
  depth: number;
  source: string;
  anchorText?: string;
}

export interface ContentProcessResult {
  outcome?: 'processed' | 'skipped_unsupported';
  bytes: number;
  discovered?: DiscoveredLink[];
  contentType?: string;
}

export interface WorkerPoolSummary {
  runId: string;
  finalStatus: CrawlRunStatus;
  statusCounts: StatusCounts;
  shutdownRequested: boolean;
  limitReached: boolean;
}

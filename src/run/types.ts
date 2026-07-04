import type { QueryResultRow } from 'pg';
import type { ScopePolicyName } from '../url/ScopePolicy.js';

export type CrawlRunStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'completed_with_failures'
  | 'limit_reached'
  | 'failed'
  | 'cancelled';

export interface CrawlRun {
  id: string;
  seedUrl: string;
  normalizedSeedUrl: string;
  scopeHost: string;
  scopePolicy: ScopePolicyName;
  status: CrawlRunStatus;
  maxUrls: number | null;
  maxDepth: number | null;
  maxBytes: number | null;
  maxRuntimeSeconds: number | null;
  concurrency: number;
  outputDir: string;
  totalBytes: number;
  urlsEnqueued: number;
  startedAt: Date;
  finishedAt: Date | null;
  updatedAt: Date;
}

export interface CrawlRunRow extends QueryResultRow {
  id: string;
  seed_url: string;
  normalized_seed_url: string;
  scope_host: string;
  scope_policy: ScopePolicyName;
  status: CrawlRunStatus;
  max_urls: number | null;
  max_depth: number | null;
  max_bytes: number | null;
  max_runtime_seconds: number | null;
  concurrency: number;
  output_dir: string;
  total_bytes: number;
  urls_enqueued: number;
  started_at: Date;
  finished_at: Date | null;
  updated_at: Date;
}

export interface CreateRunInput {
  seedUrl: string;
  normalizedSeedUrl: string;
  scopeHost: string;
  scopePolicy: ScopePolicyName;
  maxUrls: number | null;
  maxDepth: number | null;
  maxBytes: number | null;
  maxRuntimeSeconds: number | null;
  concurrency: number;
  outputDir: string;
}

export interface UpdateRunConfigInput {
  concurrency?: number;
  maxUrls?: number | null;
  maxDepth?: number | null;
  maxBytes?: number | null;
  maxRuntimeSeconds?: number | null;
}

const RESUMABLE_STATUSES = new Set<CrawlRunStatus>(['running', 'paused', 'failed']);

const FINAL_STATUSES = new Set<CrawlRunStatus>([
  'completed',
  'completed_with_failures',
  'cancelled',
]);

export function mapCrawlRunRow(row: CrawlRunRow): CrawlRun {
  return {
    id: row.id,
    seedUrl: row.seed_url,
    normalizedSeedUrl: row.normalized_seed_url,
    scopeHost: row.scope_host,
    scopePolicy: row.scope_policy,
    status: row.status,
    maxUrls: row.max_urls,
    maxDepth: row.max_depth,
    maxBytes: row.max_bytes === null ? null : Number(row.max_bytes),
    maxRuntimeSeconds: row.max_runtime_seconds,
    concurrency: row.concurrency,
    outputDir: row.output_dir,
    totalBytes: Number(row.total_bytes),
    urlsEnqueued: Number(row.urls_enqueued),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export function isResumableRunStatus(status: CrawlRunStatus): boolean {
  return RESUMABLE_STATUSES.has(status);
}

export function isFinalRunStatus(status: CrawlRunStatus): boolean {
  return FINAL_STATUSES.has(status);
}

/** @deprecated Use isFinalRunStatus or isResumableRunStatus instead */
export function isTerminalRunStatus(status: CrawlRunStatus): boolean {
  return (
    status !== 'running' && status !== 'paused' && status !== 'failed' && status !== 'limit_reached'
  );
}

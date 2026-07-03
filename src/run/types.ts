import type { QueryResultRow } from 'pg';
import type { ScopePolicyName } from '../url/ScopePolicy.js';

export type CrawlRunStatus =
  'running' | 'completed' | 'completed_with_failures' | 'limit_reached' | 'failed' | 'cancelled';

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
  totalBytes: number;
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
  total_bytes: number;
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
}

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
    maxBytes: row.max_bytes,
    maxRuntimeSeconds: row.max_runtime_seconds,
    concurrency: row.concurrency,
    totalBytes: Number(row.total_bytes),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export function isTerminalRunStatus(status: CrawlRunStatus): boolean {
  return status !== 'running';
}

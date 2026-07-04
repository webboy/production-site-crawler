import type { QueryResultRow } from 'pg';

export type CrawlUrlStatus =
  | 'queued'
  | 'in_progress'
  | 'done'
  | 'retryable_failed'
  | 'permanent_failed'
  | 'blocked'
  | 'skipped_unsupported'
  | 'redirected';

export interface CrawlUrlTask {
  id: string;
  crawlRunId: string;
  url: string;
  normalizedUrl: string;
  urlHash: string;
  host: string;
  depth: number;
  redirectCount: number;
  status: CrawlUrlStatus;
  httpStatusCode: number | null;
  contentType: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  lastErrorType: string | null;
  discoveredFromUrlId: string | null;
  claimedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrawlUrlRow extends QueryResultRow {
  id: string;
  crawl_run_id: string;
  url: string;
  normalized_url: string;
  url_hash: string;
  host: string;
  depth: number;
  redirect_count: number;
  status: CrawlUrlStatus;
  http_status_code: number | null;
  content_type: string | null;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  last_error_type: string | null;
  discovered_from_url_id: string | null;
  claimed_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface EnqueueUrlInput {
  crawlRunId: string;
  url: string;
  normalizedUrl: string;
  urlHash: string;
  host: string;
  depth: number;
  redirectCount?: number;
  discoveredFromUrlId?: string | null;
}

export interface EnqueueUrlResult {
  id: string | null;
  inserted: boolean;
  skippedLimit?: boolean;
}

export interface MarkSucceededInput {
  httpStatusCode: number;
  contentType: string;
}

export interface MarkRetryableFailureInput {
  nextAttemptAt: Date;
  lastError: string;
  lastErrorType: string;
  httpStatusCode?: number | null;
  consumesAttempt?: boolean;
}

export interface MarkPermanentFailureInput {
  httpStatusCode: number;
  lastError: string;
  lastErrorType: string;
}

export interface MarkBlockedInput {
  httpStatusCode: number;
  reason: string;
}

export interface MarkSkippedUnsupportedInput {
  contentType: string;
  reason: string;
}

export interface MarkRedirectedInput {
  httpStatusCode: number;
}

export interface RequeueRedirectInput {
  url: string;
  httpStatusCode: number;
}

export type StatusCounts = Record<CrawlUrlStatus, number>;

export function mapCrawlUrlRow(row: CrawlUrlRow): CrawlUrlTask {
  return {
    id: row.id,
    crawlRunId: row.crawl_run_id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    urlHash: row.url_hash,
    host: row.host,
    depth: row.depth,
    redirectCount: row.redirect_count,
    status: row.status,
    httpStatusCode: row.http_status_code,
    contentType: row.content_type,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    lastErrorType: row.last_error_type,
    discoveredFromUrlId: row.discovered_from_url_id,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

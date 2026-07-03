'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE crawl_runs (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      seed_url            TEXT NOT NULL,
      normalized_seed_url TEXT NOT NULL,
      scope_host          TEXT NOT NULL,
      scope_policy        TEXT NOT NULL DEFAULT 'registrable_domain',
      status              TEXT NOT NULL DEFAULT 'running',
      max_urls            INTEGER,
      max_depth           INTEGER,
      max_bytes           BIGINT,
      max_runtime_seconds INTEGER,
      concurrency         INTEGER NOT NULL DEFAULT 5,
      total_bytes         BIGINT NOT NULL DEFAULT 0,
      started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at         TIMESTAMPTZ,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT crawl_runs_status_check CHECK (
        status IN (
          'running',
          'completed',
          'completed_with_failures',
          'limit_reached',
          'failed',
          'cancelled'
        )
      )
    );

    CREATE TABLE crawl_urls (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      crawl_run_id           UUID NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      url                    TEXT NOT NULL,
      normalized_url         TEXT NOT NULL,
      url_hash               TEXT NOT NULL,
      host                   TEXT NOT NULL,
      depth                  INTEGER NOT NULL DEFAULT 0,
      status                 TEXT NOT NULL DEFAULT 'queued',
      http_status_code       INTEGER,
      content_type           TEXT,
      attempt_count          INTEGER NOT NULL DEFAULT 0,
      max_attempts           INTEGER NOT NULL DEFAULT 5,
      next_attempt_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error             TEXT,
      last_error_type        TEXT,
      discovered_from_url_id UUID REFERENCES crawl_urls(id),
      claimed_at             TIMESTAMPTZ,
      finished_at            TIMESTAMPTZ,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT crawl_urls_status_check CHECK (
        status IN (
          'queued',
          'in_progress',
          'done',
          'retryable_failed',
          'permanent_failed',
          'blocked',
          'skipped_unsupported'
        )
      )
    );

    CREATE UNIQUE INDEX crawl_urls_dedup
      ON crawl_urls (crawl_run_id, normalized_url);

    CREATE INDEX crawl_urls_claim
      ON crawl_urls (crawl_run_id, status, next_attempt_at, created_at);

    CREATE TABLE contents (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      crawl_url_id    UUID NOT NULL UNIQUE REFERENCES crawl_urls(id) ON DELETE CASCADE,
      crawl_run_id    UUID NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL,
      content_type    TEXT NOT NULL,
      file_path       TEXT NOT NULL,
      byte_size       BIGINT NOT NULL,
      content_hash    TEXT NOT NULL,
      etag            TEXT,
      metadata        JSONB NOT NULL DEFAULT '{}',
      metadata_status TEXT NOT NULL DEFAULT 'ok',
      metadata_error  TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT contents_kind_check CHECK (kind IN ('html', 'image', 'video', 'pdf')),
      CONSTRAINT contents_metadata_status_check CHECK (
        metadata_status IN ('ok', 'partial', 'failed')
      )
    );

    CREATE INDEX contents_hash ON contents (content_hash);

    CREATE TABLE url_edges (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      crawl_run_id              UUID NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      from_url_id               UUID NOT NULL REFERENCES crawl_urls(id) ON DELETE CASCADE,
      to_url_id                 UUID REFERENCES crawl_urls(id) ON DELETE CASCADE,
      discovered_url            TEXT NOT NULL,
      normalized_discovered_url TEXT,
      in_scope                  BOOLEAN NOT NULL,
      source                    TEXT,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX url_edges_from ON url_edges (from_url_id);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS url_edges;
    DROP TABLE IF EXISTS contents;
    DROP TABLE IF EXISTS crawl_urls;
    DROP TABLE IF EXISTS crawl_runs;
  `);
};

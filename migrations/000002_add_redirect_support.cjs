'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE crawl_urls
      ADD COLUMN redirect_count INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE crawl_urls
      DROP CONSTRAINT crawl_urls_status_check;

    ALTER TABLE crawl_urls
      ADD CONSTRAINT crawl_urls_status_check CHECK (
        status IN (
          'queued',
          'in_progress',
          'done',
          'retryable_failed',
          'permanent_failed',
          'blocked',
          'skipped_unsupported',
          'redirected'
        )
      );
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE crawl_urls
      DROP CONSTRAINT crawl_urls_status_check;

    ALTER TABLE crawl_urls
      ADD CONSTRAINT crawl_urls_status_check CHECK (
        status IN (
          'queued',
          'in_progress',
          'done',
          'retryable_failed',
          'permanent_failed',
          'blocked',
          'skipped_unsupported'
        )
      );

    ALTER TABLE crawl_urls
      DROP COLUMN redirect_count;
  `);
};

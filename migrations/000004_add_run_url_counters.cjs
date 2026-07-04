'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE crawl_runs
      ADD COLUMN urls_enqueued INTEGER NOT NULL DEFAULT 0;

    UPDATE crawl_runs r
    SET urls_enqueued = (
      SELECT COUNT(*)::int FROM crawl_urls u WHERE u.crawl_run_id = r.id
    );

    ALTER TABLE crawl_runs
      ADD CONSTRAINT crawl_runs_urls_enqueued_nonneg CHECK (urls_enqueued >= 0);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE crawl_runs
      DROP CONSTRAINT crawl_runs_urls_enqueued_nonneg;

    ALTER TABLE crawl_runs
      DROP COLUMN urls_enqueued;
  `);
};

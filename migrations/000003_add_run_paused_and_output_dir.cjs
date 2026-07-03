'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE crawl_runs
      ADD COLUMN output_dir TEXT NOT NULL DEFAULT 'output';

    ALTER TABLE crawl_runs
      DROP CONSTRAINT crawl_runs_status_check;

    ALTER TABLE crawl_runs
      ADD CONSTRAINT crawl_runs_status_check CHECK (
        status IN (
          'running',
          'paused',
          'completed',
          'completed_with_failures',
          'limit_reached',
          'failed',
          'cancelled'
        )
      );
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    UPDATE crawl_runs
    SET status = 'cancelled'
    WHERE status = 'paused';

    ALTER TABLE crawl_runs
      DROP CONSTRAINT crawl_runs_status_check;

    ALTER TABLE crawl_runs
      ADD CONSTRAINT crawl_runs_status_check CHECK (
        status IN (
          'running',
          'completed',
          'completed_with_failures',
          'limit_reached',
          'failed',
          'cancelled'
        )
      );

    ALTER TABLE crawl_runs
      DROP COLUMN output_dir;
  `);
};

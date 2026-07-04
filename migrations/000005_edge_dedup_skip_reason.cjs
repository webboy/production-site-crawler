'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE url_edges
      ADD COLUMN skip_reason TEXT;

    UPDATE url_edges
    SET normalized_discovered_url = COALESCE(normalized_discovered_url, discovered_url)
    WHERE normalized_discovered_url IS NULL;

    UPDATE url_edges
    SET source = COALESCE(source, 'unknown')
    WHERE source IS NULL;

    UPDATE url_edges
    SET skip_reason = CASE WHEN in_scope THEN NULL ELSE 'scope' END;

    DELETE FROM url_edges
    WHERE id IN (
      SELECT id
      FROM (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY crawl_run_id, from_url_id, normalized_discovered_url, source
            ORDER BY
              (to_url_id IS NOT NULL) DESC,
              created_at ASC
          ) AS rn
        FROM url_edges
      ) ranked
      WHERE rn > 1
    );

    ALTER TABLE url_edges
      ALTER COLUMN normalized_discovered_url SET NOT NULL,
      ALTER COLUMN source SET NOT NULL;

    ALTER TABLE url_edges
      ADD CONSTRAINT url_edges_skip_reason_check CHECK (
        skip_reason IS NULL OR skip_reason IN ('scope', 'depth', 'limit')
      );

    CREATE UNIQUE INDEX url_edges_dedup
      ON url_edges (crawl_run_id, from_url_id, normalized_discovered_url, source);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS url_edges_dedup;

    ALTER TABLE url_edges
      DROP CONSTRAINT IF EXISTS url_edges_skip_reason_check;

    ALTER TABLE url_edges
      DROP COLUMN skip_reason;

    ALTER TABLE url_edges
      ALTER COLUMN normalized_discovered_url DROP NOT NULL,
      ALTER COLUMN source DROP NOT NULL;
  `);
};

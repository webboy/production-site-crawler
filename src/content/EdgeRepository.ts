import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import type { EdgeSkipReason } from '../worker/edgeTarget.js';

export interface RecordEdgeInput {
  crawlRunId: string;
  fromUrlId: string;
  toUrlId: string | null;
  discoveredUrl: string;
  normalizedDiscoveredUrl: string;
  inScope: boolean;
  source: string;
  skipReason?: EdgeSkipReason | null;
}

export class EdgeRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async recordEdge(input: RecordEdgeInput): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO url_edges (
          crawl_run_id,
          from_url_id,
          to_url_id,
          discovered_url,
          normalized_discovered_url,
          in_scope,
          source,
          skip_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (crawl_run_id, from_url_id, normalized_discovered_url, source)
        DO UPDATE SET
          to_url_id = COALESCE(EXCLUDED.to_url_id, url_edges.to_url_id),
          in_scope = EXCLUDED.in_scope,
          skip_reason = EXCLUDED.skip_reason
      `,
      [
        input.crawlRunId,
        input.fromUrlId,
        input.toUrlId,
        input.discoveredUrl,
        input.normalizedDiscoveredUrl,
        input.inScope,
        input.source,
        input.skipReason ?? null,
      ],
    );
  }
}

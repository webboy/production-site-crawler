import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';

export interface RecordEdgeInput {
  crawlRunId: string;
  fromUrlId: string;
  toUrlId: string | null;
  discoveredUrl: string;
  normalizedDiscoveredUrl: string;
  inScope: boolean;
  source: string;
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
          source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        input.crawlRunId,
        input.fromUrlId,
        input.toUrlId,
        input.discoveredUrl,
        input.normalizedDiscoveredUrl,
        input.inScope,
        input.source,
      ],
    );
  }
}

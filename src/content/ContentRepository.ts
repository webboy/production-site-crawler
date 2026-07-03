import type { Pool } from 'pg';
import { getPool } from '../db/pool.js';
import type { MetadataStatus } from './ContentHandler.js';

export interface CreateContentInput {
  crawlUrlId: string;
  crawlRunId: string;
  kind: string;
  contentType: string;
  filePath: string;
  byteSize: number;
  contentHash: string;
  etag?: string | null;
  metadata: Record<string, unknown>;
  metadataStatus: MetadataStatus;
  metadataError?: string | null;
}

export class ContentRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async create(input: CreateContentInput): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO contents (
          crawl_url_id,
          crawl_run_id,
          kind,
          content_type,
          file_path,
          byte_size,
          content_hash,
          etag,
          metadata,
          metadata_status,
          metadata_error
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
        ON CONFLICT (crawl_url_id) DO NOTHING
      `,
      [
        input.crawlUrlId,
        input.crawlRunId,
        input.kind,
        input.contentType,
        input.filePath,
        input.byteSize,
        input.contentHash,
        input.etag ?? null,
        JSON.stringify(input.metadata),
        input.metadataStatus,
        input.metadataError ?? null,
      ],
    );
  }
}

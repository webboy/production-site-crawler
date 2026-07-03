import { createHash } from 'node:crypto';
import { getHeader } from '../fetch/headers.js';
import type { FetchResponse } from '../fetch/types.js';
import type { CrawlUrlTask } from '../frontier/types.js';
import type { ContentProcessor } from '../worker/ContentProcessor.js';
import type { ContentProcessResult } from '../worker/types.js';
import type { OutputStorage } from '../storage/OutputStorage.js';
import type { ContentRepository } from './ContentRepository.js';
import type { HandlerRegistry } from './HandlerRegistry.js';

export class HandlerContentProcessor implements ContentProcessor {
  constructor(
    private readonly registry: HandlerRegistry,
    private readonly storage: OutputStorage,
    private readonly contentRepository: ContentRepository,
  ) {}

  async process(task: CrawlUrlTask, response: FetchResponse): Promise<ContentProcessResult> {
    const body = response.body;

    if (body === null) {
      return {
        outcome: 'skipped_unsupported',
        bytes: 0,
      };
    }

    const contentType = getHeader(response.headers, 'Content-Type') ?? 'application/octet-stream';
    const handler = this.registry.find(contentType);

    if (handler === null) {
      return {
        outcome: 'skipped_unsupported',
        bytes: 0,
        contentType,
      };
    }

    const { filePath } = await this.storage.save(handler.kind, task.urlHash, contentType, body);
    const contentHash = createHash('sha256').update(body).digest('hex');
    const etag = getHeader(response.headers, 'ETag') ?? null;

    let metadata: Record<string, unknown> = {};
    let metadataStatus: 'ok' | 'partial' | 'failed' = 'ok';
    let metadataError: string | undefined;
    let discovered;

    try {
      const extractResult = await handler.extract({
        task,
        body,
        contentType,
        headers: response.headers,
        basePageUrl: task.url,
      });

      metadata = extractResult.metadata;
      metadataStatus = extractResult.metadataStatus;
      metadataError = extractResult.metadataError;
      discovered = extractResult.discovered;
    } catch (error) {
      metadata = {};
      metadataStatus = 'failed';
      metadataError = error instanceof Error ? error.message : String(error);
      discovered = undefined;
    }

    await this.contentRepository.create({
      crawlUrlId: task.id,
      crawlRunId: task.crawlRunId,
      kind: handler.kind,
      contentType,
      filePath,
      byteSize: body.length,
      contentHash,
      etag,
      metadata,
      metadataStatus,
      metadataError: metadataError ?? null,
    });

    return {
      outcome: 'processed',
      bytes: body.length,
      contentType,
      discovered,
    };
  }
}

import type { CrawlUrlTask } from '../frontier/types.js';
import type { DiscoveredLink } from '../worker/types.js';

export type MetadataStatus = 'ok' | 'partial' | 'failed';
export type ContentKind = 'html' | 'image' | 'video' | 'pdf';

export interface HandlerExtractInput {
  task: CrawlUrlTask;
  body: Buffer;
  contentType: string;
  headers: Record<string, string>;
  basePageUrl: string;
}

export interface HandlerExtractResult {
  metadata: Record<string, unknown>;
  metadataStatus: MetadataStatus;
  metadataError?: string;
  discovered?: DiscoveredLink[];
}

export interface ContentHandler {
  readonly kind: ContentKind;
  supports(contentType: string): boolean;
  extract(input: HandlerExtractInput): Promise<HandlerExtractResult>;
}

import { getHeader } from '../fetch/headers.js';
import type { FetchResponse } from '../fetch/types.js';
import type { CrawlUrlTask } from '../frontier/types.js';
import type { ContentProcessResult } from './types.js';

export interface ContentProcessor {
  process(task: CrawlUrlTask, response: FetchResponse): Promise<ContentProcessResult>;
}

export class NoopContentProcessor implements ContentProcessor {
  async process(_task: CrawlUrlTask, response: FetchResponse): Promise<ContentProcessResult> {
    const contentType = getHeader(response.headers, 'Content-Type') ?? 'application/octet-stream';

    return {
      bytes: response.body?.length ?? 0,
      contentType,
    };
  }
}

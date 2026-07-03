import { normalizeContentType } from '../storage/FilePathStrategy.js';
import type { ContentHandler } from './ContentHandler.js';

export class HandlerRegistry {
  constructor(private readonly handlers: ContentHandler[]) {}

  find(contentType: string): ContentHandler | null {
    const normalized = normalizeContentType(contentType);

    return this.handlers.find((handler) => handler.supports(normalized)) ?? null;
  }
}

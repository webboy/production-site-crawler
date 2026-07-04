import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { CreateContentInput } from '../../src/content/ContentRepository.js';
import { HandlerContentProcessor } from '../../src/content/HandlerContentProcessor.js';
import { HandlerRegistry } from '../../src/content/HandlerRegistry.js';
import { HtmlHandler } from '../../src/content/HtmlHandler.js';
import type { ContentHandler } from '../../src/content/ContentHandler.js';
import type { OutputStorage } from '../../src/storage/OutputStorage.js';

class StubStorage implements Pick<OutputStorage, 'save'> {
  readonly saved: Array<{ kind: string; urlHash: string; contentType: string; body: Buffer }> = [];

  async save(
    kind: 'html' | 'image' | 'video' | 'pdf',
    urlHash: string,
    contentType: string,
    body: Buffer,
  ) {
    this.saved.push({ kind, urlHash, contentType, body });
    return { filePath: `/tmp/${urlHash}.html` };
  }
}

class StubContentRepository {
  readonly created: CreateContentInput[] = [];

  async create(input: CreateContentInput): Promise<void> {
    this.created.push(input);
  }
}

function createLogCapture() {
  const entries: unknown[] = [];
  const logger = pino({
    level: 'info',
    hooks: {
      logMethod(inputArgs, method) {
        entries.push(inputArgs[0]);
        method.apply(this, inputArgs);
      },
    },
  });

  return { logger, entries };
}

describe('HandlerContentProcessor', () => {
  const task = {
    id: 'task-1',
    crawlRunId: 'run-1',
    url: 'https://example.com/page',
    normalizedUrl: 'https://example.com/page',
    urlHash: 'deadbeef',
    host: 'example.com',
    depth: 0,
    status: 'in_progress' as const,
    httpStatusCode: 200,
    contentType: 'text/html',
    attemptCount: 1,
    maxAttempts: 5,
    nextAttemptAt: new Date(),
    lastError: null,
    lastErrorType: null,
    discoveredFromUrlId: null,
    claimedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('skips unsupported content types without saving files', async () => {
    const storage = new StubStorage();
    const repository = new StubContentRepository();
    const processor = new HandlerContentProcessor(
      new HandlerRegistry([new HtmlHandler()]),
      storage as OutputStorage,
      repository as never,
    );

    const result = await processor.process(task, {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from('{}'),
    });

    expect(result).toEqual({
      outcome: 'skipped_unsupported',
      bytes: 0,
      contentType: 'application/json',
    });
    expect(storage.saved).toHaveLength(0);
    expect(repository.created).toHaveLength(0);
  });

  it('persists content rows for supported handlers', async () => {
    const storage = new StubStorage();
    const repository = new StubContentRepository();
    const processor = new HandlerContentProcessor(
      new HandlerRegistry([new HtmlHandler()]),
      storage as OutputStorage,
      repository as never,
    );

    const result = await processor.process(task, {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html', ETag: '"abc"' },
      body: Buffer.from('<html><head><title>T</title></head><body></body></html>'),
    });

    expect(result.outcome).toBe('processed');
    expect(result.bytes).toBeGreaterThan(0);
    expect(storage.saved).toHaveLength(1);
    expect(repository.created[0]).toMatchObject({
      crawlUrlId: task.id,
      crawlRunId: task.crawlRunId,
      kind: 'html',
      contentType: 'text/html',
      etag: '"abc"',
      metadataStatus: 'ok',
    });
  });

  it('emits content_saved after persisting supported content', async () => {
    const storage = new StubStorage();
    const repository = new StubContentRepository();
    const { logger, entries } = createLogCapture();
    const processor = new HandlerContentProcessor(
      new HandlerRegistry([new HtmlHandler()]),
      storage as OutputStorage,
      repository as never,
      logger,
    );

    await processor.process(task, {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: Buffer.from('<html><head><title>T</title></head><body></body></html>'),
    });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'content_saved',
          runId: task.crawlRunId,
          urlId: task.id,
          url: task.url,
          kind: 'html',
          contentType: 'text/html',
          filePath: '/tmp/deadbeef.html',
          byteSize: expect.any(Number),
          contentHash: expect.any(String),
        }),
      ]),
    );
  });

  it('records failed metadata when handler extraction throws', async () => {
    class ThrowingHandler implements ContentHandler {
      readonly kind = 'html' as const;

      supports(): boolean {
        return true;
      }

      async extract(): Promise<never> {
        throw new Error('extract failed');
      }
    }

    const storage = new StubStorage();
    const repository = new StubContentRepository();
    const processor = new HandlerContentProcessor(
      new HandlerRegistry([new ThrowingHandler()]),
      storage as OutputStorage,
      repository as never,
    );

    const result = await processor.process(task, {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: Buffer.from('<html></html>'),
    });

    expect(result.outcome).toBe('processed');
    expect(repository.created[0]?.metadataStatus).toBe('failed');
    expect(repository.created[0]?.metadataError).toBe('extract failed');
  });
});

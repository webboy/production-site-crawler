import { describe, expect, it } from 'vitest';
import { ImageHandler } from '../../src/content/ImageHandler.js';
import { TINY_PNG } from '../fixtures/contentFixtures.js';

describe('ImageHandler', () => {
  const handler = new ImageHandler();

  it('extracts dimensions from a valid PNG', async () => {
    const result = await handler.extract({
      task: {
        id: 'task-1',
        crawlRunId: 'run-1',
        url: 'https://example.com/image.png',
        normalizedUrl: 'https://example.com/image.png',
        urlHash: 'abc',
        host: 'example.com',
        depth: 0,
        status: 'in_progress',
        httpStatusCode: 200,
        contentType: 'image/png',
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
      },
      body: TINY_PNG,
      contentType: 'image/png',
      headers: {},
      basePageUrl: 'https://example.com/image.png',
    });

    expect(result.metadataStatus).toBe('ok');
    expect(result.metadata).toMatchObject({
      width: 1,
      height: 1,
      fileSize: TINY_PNG.length,
    });
  });
});

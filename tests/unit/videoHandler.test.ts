import { describe, expect, it } from 'vitest';
import { VideoHandler } from '../../src/content/VideoHandler.js';

describe('VideoHandler', () => {
  const handler = new VideoHandler();

  it('returns partial metadata with file size only', async () => {
    const body = Buffer.from('fake-video-bytes');

    const result = await handler.extract({
      task: {
        id: 'task-1',
        crawlRunId: 'run-1',
        url: 'https://example.com/video.mp4',
        normalizedUrl: 'https://example.com/video.mp4',
        urlHash: 'abc',
        host: 'example.com',
        depth: 0,
        status: 'in_progress',
        httpStatusCode: 200,
        contentType: 'video/mp4',
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
      body,
      contentType: 'video/mp4',
      headers: {},
      basePageUrl: 'https://example.com/video.mp4',
    });

    expect(result.metadataStatus).toBe('partial');
    expect(result.metadata).toEqual({
      fileSize: body.length,
      durationSeconds: null,
    });
    expect(result.metadataError).toContain('not implemented');
  });
});

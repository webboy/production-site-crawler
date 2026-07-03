import { describe, expect, it } from 'vitest';
import { HtmlHandler } from '../../src/content/HtmlHandler.js';

describe('HtmlHandler', () => {
  const handler = new HtmlHandler();

  it('extracts title, links, sources, anchor text, and relative URLs', async () => {
    const html = Buffer.from(`
      <html>
        <head><title>  Example Page  </title></head>
        <body>
          <a href="/about">About Us</a>
          <img src="photo.jpg" />
          <video src="clip.mp4"></video>
          <source src="audio.webm" />
          <link href="/styles.css" rel="stylesheet" />
          <object data="/widget.swf"></object>
          <embed src="/plugin.swf" />
          <a href="mailto:test@example.com">Email</a>
        </body>
      </html>
    `);

    const result = await handler.extract({
      task: {
        id: 'task-1',
        crawlRunId: 'run-1',
        url: 'https://example.com/page',
        normalizedUrl: 'https://example.com/page',
        urlHash: 'abc',
        host: 'example.com',
        depth: 0,
        status: 'in_progress',
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
      },
      body: html,
      contentType: 'text/html',
      headers: {},
      basePageUrl: 'https://example.com/page',
    });

    expect(result.metadataStatus).toBe('ok');
    expect(result.metadata.title).toBe('Example Page');
    expect(result.discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          normalizedUrl: 'https://example.com/about',
          source: 'a.href',
          anchorText: 'About Us',
          depth: 1,
        }),
        expect.objectContaining({
          normalizedUrl: 'https://example.com/photo.jpg',
          source: 'img.src',
        }),
        expect.objectContaining({
          normalizedUrl: 'https://example.com/clip.mp4',
          source: 'video.src',
        }),
        expect.objectContaining({
          normalizedUrl: 'https://example.com/audio.webm',
          source: 'source.src',
        }),
        expect.objectContaining({
          normalizedUrl: 'https://example.com/styles.css',
          source: 'link.href',
        }),
        expect.objectContaining({
          normalizedUrl: 'https://example.com/widget.swf',
          source: 'object.data',
        }),
        expect.objectContaining({
          normalizedUrl: 'https://example.com/plugin.swf',
          source: 'embed.src',
        }),
      ]),
    );

    expect(result.discovered?.some((link) => link.url.includes('mailto:'))).toBe(false);
  });
});

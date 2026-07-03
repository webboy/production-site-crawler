import { describe, expect, it } from 'vitest';
import { PdfHandler } from '../../src/content/PdfHandler.js';
import { CORRUPT_PDF, MINIMAL_PDF } from '../fixtures/contentFixtures.js';

describe('PdfHandler', () => {
  const handler = new PdfHandler();

  const baseInput = {
    task: {
      id: 'task-1',
      crawlRunId: 'run-1',
      url: 'https://example.com/doc.pdf',
      normalizedUrl: 'https://example.com/doc.pdf',
      urlHash: 'abc',
      host: 'example.com',
      depth: 0,
      status: 'in_progress' as const,
      httpStatusCode: 200,
      contentType: 'application/pdf',
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
    contentType: 'application/pdf',
    headers: {},
    basePageUrl: 'https://example.com/doc.pdf',
  };

  it('extracts page count from a valid PDF', async () => {
    const result = await handler.extract({
      ...baseInput,
      body: MINIMAL_PDF,
    });

    expect(result.metadataStatus).toBe('ok');
    expect(result.metadata.pageCount).toBe(1);
  });

  it('returns failed metadata for corrupt PDF without throwing', async () => {
    const result = await handler.extract({
      ...baseInput,
      body: CORRUPT_PDF,
    });

    expect(result.metadataStatus).toBe('failed');
    expect(result.metadata).toEqual({ fileSize: CORRUPT_PDF.length });
    expect(result.metadataError).toBeTruthy();
  });
});

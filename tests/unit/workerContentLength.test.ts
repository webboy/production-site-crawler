import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { logContentLengthMismatch } from '../../src/worker/worker.js';

function createLogCapture() {
  const entries: unknown[] = [];
  const logger = pino({
    level: 'warn',
    hooks: {
      logMethod(inputArgs, method) {
        entries.push(inputArgs[0]);
        method.apply(this, inputArgs);
      },
    },
  });

  return { logger, entries };
}

describe('logContentLengthMismatch', () => {
  const context = {
    runId: 'run-1',
    urlId: 'url-1',
    url: 'https://example.com/page',
  };

  it('logs a warning when Content-Length does not match body length', () => {
    const { logger, entries } = createLogCapture();

    logContentLengthMismatch(
      logger,
      context,
      { 'Content-Length': '10' },
      Buffer.from('12345'),
    );

    expect(entries).toEqual([
      expect.objectContaining({
        event: 'content_length_mismatch',
        runId: context.runId,
        urlId: context.urlId,
        url: context.url,
        expectedBytes: 10,
        actualBytes: 5,
      }),
    ]);
  });

  it('does not log when Content-Length matches body length', () => {
    const { logger, entries } = createLogCapture();
    const body = Buffer.from('12345');

    logContentLengthMismatch(logger, context, { 'Content-Length': '5' }, body);

    expect(entries).toHaveLength(0);
  });

  it('does not log when Content-Length header is missing or invalid', () => {
    const { logger, entries } = createLogCapture();
    const body = Buffer.from('12345');

    logContentLengthMismatch(logger, context, {}, body);
    logContentLengthMismatch(logger, context, { 'Content-Length': 'abc' }, body);
    logContentLengthMismatch(logger, context, { 'Content-Length': '-1' }, body);

    expect(entries).toHaveLength(0);
  });
});

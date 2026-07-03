import { describe, expect, it } from 'vitest';
import { classifyResponse } from '../../src/worker/ResponseClassifier.js';

describe('classifyResponse', () => {
  it('maps 200 with body to success_with_body', () => {
    expect(
      classifyResponse({
        statusCode: 200,
        headers: {},
        body: Buffer.from('hello'),
      }),
    ).toBe('success_with_body');
  });

  it('maps 200 with null body to empty_body', () => {
    expect(
      classifyResponse({
        statusCode: 200,
        headers: {},
        body: null,
      }),
    ).toBe('empty_body');
  });

  it('maps 200 with empty buffer to empty_body', () => {
    expect(
      classifyResponse({
        statusCode: 200,
        headers: {},
        body: Buffer.alloc(0),
      }),
    ).toBe('empty_body');
  });

  it('maps 404 to not_found', () => {
    expect(classifyResponse({ statusCode: 404, headers: {}, body: null })).toBe('not_found');
  });

  it('maps 403 to blocked', () => {
    expect(classifyResponse({ statusCode: 403, headers: {}, body: null })).toBe('blocked');
  });

  it('maps 429 to rate_limited', () => {
    expect(classifyResponse({ statusCode: 429, headers: {}, body: null })).toBe('rate_limited');
  });

  it('maps 500 to server_error', () => {
    expect(classifyResponse({ statusCode: 500, headers: {}, body: null })).toBe('server_error');
  });

  it('maps unexpected statuses to unexpected', () => {
    expect(classifyResponse({ statusCode: 418, headers: {}, body: null })).toBe('unexpected');
  });
});

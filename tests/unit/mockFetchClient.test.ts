import { describe, expect, it } from 'vitest';
import { MockFetchClient } from '../../src/fetch/MockFetchClient.js';

describe('MockFetchClient', () => {
  it('returns a registered single response', async () => {
    const client = new MockFetchClient().register('https://example.com', {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: Buffer.from('ok'),
    });

    await expect(client.fetchUrl('https://example.com')).resolves.toEqual({
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: Buffer.from('ok'),
    });
  });

  it('advances through an ordered response sequence and then repeats the final response', async () => {
    const client = new MockFetchClient().register('https://example.com', [
      { statusCode: 500, headers: {}, body: null },
      { statusCode: 500, headers: {}, body: null },
      { statusCode: 200, headers: {}, body: Buffer.from('done') },
    ]);

    await expect(client.fetchUrl('https://example.com')).resolves.toMatchObject({
      statusCode: 500,
    });
    await expect(client.fetchUrl('https://example.com')).resolves.toMatchObject({
      statusCode: 500,
    });
    await expect(client.fetchUrl('https://example.com')).resolves.toMatchObject({
      statusCode: 200,
    });
    await expect(client.fetchUrl('https://example.com')).resolves.toMatchObject({
      statusCode: 200,
    });
  });

  it('uses a configurable default response for unknown URLs', async () => {
    const client = new MockFetchClient().setDefault({
      statusCode: 403,
      headers: {},
      body: null,
    });

    await expect(client.fetchUrl('https://unknown.example')).resolves.toEqual({
      statusCode: 403,
      headers: {},
      body: null,
    });
  });
});

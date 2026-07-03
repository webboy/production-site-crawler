import { describe, expect, it } from 'vitest';
import { HttpFetchClient } from '../../src/fetch/HttpFetchClient.js';
import type { FetchLike } from '../../src/fetch/HttpFetchClient.js';
import { FetchTransportError } from '../../src/fetch/types.js';

function jsonResponse(envelope: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => envelope,
  } as Response;
}

describe('HttpFetchClient', () => {
  it('builds the request URL with encoded target URL', async () => {
    let requestedUrl = '';
    const fetchImpl: FetchLike = async (input) => {
      requestedUrl = input;
      return jsonResponse({ statusCode: 200, headers: {}, body: null });
    };

    const client = new HttpFetchClient({
      baseUrl: 'http://mock-api.mock.com/fetch',
      fetchImpl,
    });

    await client.fetchUrl('http://x.com/a?b=1');

    expect(requestedUrl).toBe('http://mock-api.mock.com/fetch?url=http%3A%2F%2Fx.com%2Fa%3Fb%3D1');
  });

  it('maps a valid envelope and decodes a base64 body', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        body: Buffer.from('<html></html>').toString('base64'),
      });

    const client = new HttpFetchClient({ baseUrl: 'http://fetch.test', fetchImpl });

    await expect(client.fetchUrl('https://example.com')).resolves.toEqual({
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: Buffer.from('<html></html>'),
    });
  });

  it('returns inner 500 envelopes without throwing', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ statusCode: 500, headers: {}, body: null });

    const client = new HttpFetchClient({ baseUrl: 'http://fetch.test', fetchImpl });

    await expect(client.fetchUrl('https://example.com')).resolves.toMatchObject({
      statusCode: 500,
    });
  });

  it('throws FetchTransportError for network failure', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('socket closed');
    };

    const client = new HttpFetchClient({ baseUrl: 'http://fetch.test', fetchImpl });

    await expect(client.fetchUrl('https://example.com')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('throws FetchTransportError for invalid JSON', async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json');
        },
      }) as Response;

    const client = new HttpFetchClient({ baseUrl: 'http://fetch.test', fetchImpl });

    await expect(client.fetchUrl('https://example.com')).rejects.toMatchObject({
      kind: 'invalid_envelope',
    });
  });

  it('throws FetchTransportError for invalid envelopes', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ statusCode: '200', headers: {} });
    const client = new HttpFetchClient({ baseUrl: 'http://fetch.test', fetchImpl });

    await expect(client.fetchUrl('https://example.com')).rejects.toBeInstanceOf(
      FetchTransportError,
    );
  });

  it('throws FetchTransportError on timeout', async () => {
    const fetchImpl: FetchLike = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    const client = new HttpFetchClient({
      baseUrl: 'http://fetch.test',
      fetchImpl,
      timeoutMs: 1,
    });

    await expect(client.fetchUrl('https://example.com')).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('throws FetchTransportError for non-2xx transport status', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: 'upstream' }, 502);
    const client = new HttpFetchClient({ baseUrl: 'http://fetch.test', fetchImpl });

    await expect(client.fetchUrl('https://example.com')).rejects.toMatchObject({
      kind: 'transport_status',
      status: 502,
    });
  });
});

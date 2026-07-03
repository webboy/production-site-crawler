import { normalizeBody } from './body.js';
import type { BodyDecodeStrategy } from './body.js';
import { FetchTransportError } from './types.js';
import type { FetchClient, FetchResponse } from './types.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpFetchClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  bodyStrategy?: BodyDecodeStrategy;
}

interface RawFetchEnvelope {
  statusCode?: unknown;
  headers?: unknown;
  body?: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === 'string');
}

function mapEnvelope(envelope: RawFetchEnvelope, bodyStrategy: BodyDecodeStrategy): FetchResponse {
  if (!Number.isInteger(envelope.statusCode)) {
    throw new FetchTransportError({
      kind: 'invalid_envelope',
      message: 'Fetch API envelope is missing a numeric statusCode',
    });
  }

  const statusCode = envelope.statusCode as number;

  if (!isStringRecord(envelope.headers)) {
    throw new FetchTransportError({
      kind: 'invalid_envelope',
      message: 'Fetch API envelope is missing string headers',
    });
  }

  try {
    return {
      statusCode,
      headers: envelope.headers,
      body: normalizeBody(envelope.body ?? null, bodyStrategy),
    };
  } catch (error) {
    throw new FetchTransportError({
      kind: 'invalid_envelope',
      message: 'Fetch API envelope contains an invalid body',
      cause: error,
    });
  }
}

export class HttpFetchClient implements FetchClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly bodyStrategy: BodyDecodeStrategy;

  constructor(options: HttpFetchClientOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.bodyStrategy = options.bodyStrategy ?? 'base64';
  }

  async fetchUrl(url: string): Promise<FetchResponse> {
    const requestUrl = new URL(this.baseUrl);
    requestUrl.searchParams.set('url', url);

    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, this.timeoutMs);

    let response: Response;

    try {
      response = await this.fetchImpl(requestUrl.href, {
        method: 'GET',
        signal: controller.signal,
      });
    } catch (error) {
      throw new FetchTransportError({
        kind: didTimeout ? 'timeout' : 'network',
        message: didTimeout ? 'Fetch API request timed out' : 'Fetch API request failed',
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new FetchTransportError({
        kind: 'transport_status',
        message: `Fetch API transport returned HTTP ${response.status}`,
        status: response.status,
      });
    }

    let envelope: unknown;

    try {
      envelope = await response.json();
    } catch (error) {
      throw new FetchTransportError({
        kind: 'invalid_envelope',
        message: 'Fetch API transport returned invalid JSON',
        cause: error,
      });
    }

    if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new FetchTransportError({
        kind: 'invalid_envelope',
        message: 'Fetch API envelope must be a JSON object',
      });
    }

    return mapEnvelope(envelope, this.bodyStrategy);
  }
}

export interface FetchResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | null;
}

export interface FetchClient {
  fetchUrl(url: string): Promise<FetchResponse>;
}

export type FetchTransportErrorKind =
  'network' | 'invalid_envelope' | 'timeout' | 'transport_status';

export interface FetchTransportErrorOptions {
  kind: FetchTransportErrorKind;
  message: string;
  cause?: unknown;
  status?: number;
}

export class FetchTransportError extends Error {
  readonly kind: FetchTransportErrorKind;
  readonly status?: number;

  constructor(options: FetchTransportErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'FetchTransportError';
    this.kind = options.kind;
    this.status = options.status;
  }
}

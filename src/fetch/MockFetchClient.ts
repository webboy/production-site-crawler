import type { FetchClient, FetchResponse } from './types.js';

type ResponseOrSequence = FetchResponse | FetchResponse[];

interface RegisteredResponse {
  responses: FetchResponse[];
  nextIndex: number;
}

function cloneResponse(response: FetchResponse): FetchResponse {
  return {
    statusCode: response.statusCode,
    headers: { ...response.headers },
    body: response.body === null ? null : Buffer.from(response.body),
  };
}

function toSequence(responseOrSequence: ResponseOrSequence): FetchResponse[] {
  return Array.isArray(responseOrSequence) ? responseOrSequence : [responseOrSequence];
}

export class MockFetchClient implements FetchClient {
  private readonly responses = new Map<string, RegisteredResponse>();
  private defaultResponse: FetchResponse = {
    statusCode: 404,
    headers: {},
    body: null,
  };

  register(url: string, responseOrSequence: ResponseOrSequence): this {
    const responses = toSequence(responseOrSequence);

    if (responses.length === 0) {
      throw new Error('MockFetchClient requires at least one response');
    }

    this.responses.set(url, {
      responses: responses.map(cloneResponse),
      nextIndex: 0,
    });

    return this;
  }

  setDefault(response: FetchResponse): this {
    this.defaultResponse = cloneResponse(response);
    return this;
  }

  async fetchUrl(url: string): Promise<FetchResponse> {
    const registered = this.responses.get(url);

    if (registered === undefined) {
      return cloneResponse(this.defaultResponse);
    }

    const index = Math.min(registered.nextIndex, registered.responses.length - 1);
    registered.nextIndex += 1;

    const response = registered.responses[index];

    if (response === undefined) {
      return cloneResponse(this.defaultResponse);
    }

    return cloneResponse(response);
  }
}

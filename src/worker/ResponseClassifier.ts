import type { FetchResponse } from '../fetch/types.js';
import type { ResponseAction } from './types.js';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export function classifyResponse(response: FetchResponse): ResponseAction {
  const { statusCode, body } = response;

  if (REDIRECT_STATUS_CODES.has(statusCode)) {
    return 'redirect';
  }

  if (statusCode === 200) {
    return body !== null && body.length > 0 ? 'success_with_body' : 'empty_body';
  }

  if (statusCode === 404) {
    return 'not_found';
  }

  if (statusCode === 403) {
    return 'blocked';
  }

  if (statusCode === 429) {
    return 'rate_limited';
  }

  if (statusCode === 500) {
    return 'server_error';
  }

  return 'unexpected';
}

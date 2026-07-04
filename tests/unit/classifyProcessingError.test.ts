import { describe, expect, it } from 'vitest';
import { classifyProcessingError } from '../../src/worker/classifyProcessingError.js';

describe('classifyProcessingError', () => {
  it('marks TypeError as permanent', () => {
    expect(classifyProcessingError(new TypeError('bad access'))).toEqual({
      retryable: false,
      lastErrorType: 'processing_bug',
    });
  });

  it('marks PG connection errors as retryable', () => {
    expect(classifyProcessingError({ code: '57P01', message: 'shutdown' })).toEqual({
      retryable: true,
      lastErrorType: 'db_transient',
    });
  });

  it('defaults unknown errors to retryable processing_error', () => {
    expect(classifyProcessingError(new Error('something broke'))).toEqual({
      retryable: true,
      lastErrorType: 'processing_error',
    });
  });
});

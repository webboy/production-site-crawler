const RETRYABLE_NODE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOSPC',
]);

const RETRYABLE_PG_CODES = new Set(['57P01', '08006', '08001']);

const PERMANENT_PG_CODES = new Set(['23505', '23503']);

export interface ProcessingErrorClassification {
  retryable: boolean;
  lastErrorType: string;
}

function getErrorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

export function classifyProcessingError(error: unknown): ProcessingErrorClassification {
  if (error instanceof TypeError || error instanceof ReferenceError) {
    return { retryable: false, lastErrorType: 'processing_bug' };
  }

  const code = getErrorCode(error);

  if (code !== undefined) {
    if (RETRYABLE_PG_CODES.has(code)) {
      return { retryable: true, lastErrorType: 'db_transient' };
    }

    if (PERMANENT_PG_CODES.has(code)) {
      return { retryable: false, lastErrorType: 'db_constraint' };
    }

    if (RETRYABLE_NODE_CODES.has(code)) {
      return {
        retryable: true,
        lastErrorType: code === 'ENOSPC' ? 'storage_error' : 'processing_error',
      };
    }
  }

  return { retryable: true, lastErrorType: 'processing_error' };
}

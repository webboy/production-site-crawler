export type BodyDecodeStrategy = 'auto' | 'base64' | 'utf8';

export class BodyNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyNormalizationError';
  }
}

function isValidBase64(value: string): boolean {
  if (value === '') {
    return true;
  }

  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function isTextualContentType(contentType: string | null | undefined): boolean {
  if (contentType === null || contentType === undefined) {
    return false;
  }

  const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  return (
    essence.startsWith('text/') ||
    essence.endsWith('+xml') ||
    essence === 'application/json' ||
    essence === 'application/xml' ||
    essence === 'application/xhtml+xml' ||
    essence === 'application/javascript' ||
    essence === 'application/ecmascript'
  );
}

function decodeString(
  raw: string,
  strategy: BodyDecodeStrategy,
  contentType: string | null | undefined,
): Buffer {
  if (strategy === 'utf8') {
    return Buffer.from(raw, 'utf8');
  }

  const trimmed = raw.trim();

  if (strategy === 'base64') {
    if (!isValidBase64(trimmed)) {
      throw new BodyNormalizationError('Invalid base64 body string');
    }

    return Buffer.from(trimmed, 'base64');
  }

  if (isTextualContentType(contentType)) {
    return Buffer.from(raw, 'utf8');
  }

  if (trimmed !== '' && isValidBase64(trimmed)) {
    return Buffer.from(trimmed, 'base64');
  }

  return Buffer.from(raw, 'utf8');
}

export function normalizeBody(
  raw: unknown,
  strategy: BodyDecodeStrategy = 'auto',
  contentType?: string | null,
): Buffer | null {
  if (raw === null) {
    return null;
  }

  if (Buffer.isBuffer(raw)) {
    return raw;
  }

  if (raw instanceof Uint8Array) {
    return Buffer.from(raw);
  }

  if (typeof raw === 'string') {
    return decodeString(raw, strategy, contentType);
  }

  throw new BodyNormalizationError(`Unsupported body value: ${typeof raw}`);
}

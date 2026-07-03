export type BodyDecodeStrategy = 'base64' | 'utf8';

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

export function normalizeBody(
  raw: unknown,
  strategy: BodyDecodeStrategy = 'base64',
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
    if (strategy === 'utf8') {
      return Buffer.from(raw, 'utf8');
    }

    const normalized = raw.trim();

    if (!isValidBase64(normalized)) {
      throw new BodyNormalizationError('Invalid base64 body string');
    }

    return Buffer.from(normalized, 'base64');
  }

  throw new BodyNormalizationError(`Unsupported body value: ${typeof raw}`);
}

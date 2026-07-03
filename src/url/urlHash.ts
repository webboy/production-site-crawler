import { createHash } from 'node:crypto';

export function urlHash(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

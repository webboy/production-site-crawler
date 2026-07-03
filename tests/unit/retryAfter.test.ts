import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from '../../src/worker/retryAfter.js';

describe('parseRetryAfter', () => {
  const now = new Date('2026-07-03T12:00:00.000Z');

  it('returns null for missing or empty values', () => {
    expect(parseRetryAfter(undefined, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('   ', now)).toBeNull();
  });

  it('parses delta seconds into milliseconds', () => {
    expect(parseRetryAfter('10', now)).toBe(10_000);
    expect(parseRetryAfter('0', now)).toBe(0);
  });

  it('parses HTTP-date values relative to now', () => {
    expect(parseRetryAfter('Wed, 03 Jul 2026 12:00:10 GMT', now)).toBe(10_000);
  });

  it('returns null for invalid values', () => {
    expect(parseRetryAfter('not-a-date', now)).toBeNull();
    expect(parseRetryAfter('-5', now)).toBeNull();
  });

  it('clamps past HTTP dates to zero', () => {
    expect(parseRetryAfter('Wed, 03 Jul 2026 11:59:50 GMT', now)).toBe(0);
  });
});

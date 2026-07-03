import { describe, expect, it } from 'vitest';
import { getHeader } from '../../src/fetch/headers.js';

describe('getHeader', () => {
  it('looks up headers case-insensitively', () => {
    expect(getHeader({ 'Content-Type': 'text/html' }, 'content-type')).toBe('text/html');
    expect(getHeader({ 'retry-after': '10' }, 'Retry-After')).toBe('10');
  });

  it('returns undefined for missing headers', () => {
    expect(getHeader({ ETag: 'abc' }, 'content-length')).toBeUndefined();
  });
});

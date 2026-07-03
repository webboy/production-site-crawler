import { describe, expect, it } from 'vitest';
import { urlHash } from '../../src/url/urlHash.js';

describe('urlHash', () => {
  it('returns a stable full sha256 hex digest', () => {
    const normalizedUrl = 'https://example.com/path?a=1';

    expect(urlHash(normalizedUrl)).toBe(urlHash(normalizedUrl));
    expect(urlHash(normalizedUrl)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when the normalized URL changes', () => {
    expect(urlHash('https://example.com/path?a=1')).not.toBe(
      urlHash('https://example.com/path?a=2'),
    );
  });
});

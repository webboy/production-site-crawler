import { describe, expect, it } from 'vitest';
import { normalize, normalizeDiscovered, resolve } from '../../src/url/UrlNormalizer.js';

describe('UrlNormalizer', () => {
  it('normalizes the examples from the project brief', () => {
    expect(normalize('HTTP://WWW.EXAMPLE.COM:80/a#top')).toBe('https://www.example.com/a');
    expect(normalize(resolve('/about', 'https://example.com/products') ?? '')).toBe(
      'https://example.com/about',
    );
    expect(normalize('https://example.com')).toBe('https://example.com/');
    expect(normalize('https://example.com/en/')).toBe('https://example.com/en');
    expect(normalize('https://example.com/p?b=2&a=1')).toBe('https://example.com/p?a=1&b=2');
  });

  it('keeps the resolved fetch URL distinct from the normalized dedup key', () => {
    const result = normalizeDiscovered(
      'http://WWW.Example.com:80/en/?b=2&a=1#top',
      'https://www.example.com/',
    );

    expect(result).toEqual({
      url: 'http://www.example.com/en/?b=2&a=1',
      normalizedUrl: 'https://www.example.com/en?a=1&b=2',
    });
  });

  it('resolves relative URLs against the base page URL', () => {
    expect(resolve('../contact', 'https://example.com/products/item')).toBe(
      'https://example.com/contact',
    );
  });

  it('sorts query params while preserving duplicate keys', () => {
    expect(normalize('https://example.com/search?b=2&a=2&a=1')).toBe(
      'https://example.com/search?a=1&a=2&b=2',
    );
  });

  it('rejects unsupported schemes', () => {
    const unsupported = [
      'mailto:test@example.com',
      'tel:+123',
      'javascript:alert(1)',
      'data:text/plain,hi',
      'ftp://example.com/file',
      'file:///tmp/file',
    ];

    for (const href of unsupported) {
      expect(resolve(href, 'https://example.com/')).toBeNull();
      expect(normalizeDiscovered(href, 'https://example.com/')).toEqual({
        rejected: 'unsupported_scheme',
      });
    }
  });

  it('rejects unparseable input', () => {
    expect(resolve('https://[', 'https://example.com/')).toBeNull();
    expect(normalizeDiscovered('https://[', 'https://example.com/')).toEqual({
      rejected: 'unparseable',
    });
  });
});

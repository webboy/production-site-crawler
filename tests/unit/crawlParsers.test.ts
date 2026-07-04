import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  parseConcurrency,
  parseMaxDepth,
  parseMaxUrls,
  parseUnlimitedOrPositive,
} from '../../src/cli/crawl.js';

describe('crawl CLI parsers', () => {
  it('rejects zero concurrency', () => {
    expect(() => parseConcurrency('0')).toThrow(InvalidArgumentError);
  });

  it('accepts positive concurrency', () => {
    expect(parseConcurrency('3')).toBe(3);
  });

  it('maps max URL unlimited sentinels and zero to null', () => {
    expect(parseMaxUrls('unlimited')).toBeNull();
    expect(parseMaxUrls('none')).toBeNull();
    expect(parseMaxUrls('0')).toBeNull();
    expect(parseMaxUrls('')).toBeNull();
  });

  it('accepts positive max urls and rejects invalid values', () => {
    expect(parseMaxUrls('3')).toBe(3);
    expect(() => parseMaxUrls('-1')).toThrow(InvalidArgumentError);
    expect(() => parseMaxUrls('abc')).toThrow(InvalidArgumentError);
  });

  it('keeps zero invalid for other positive-or-unlimited limits', () => {
    expect(() => parseUnlimitedOrPositive('0', 'max-bytes')).toThrow(InvalidArgumentError);
  });

  it('preserves maxDepth zero as seed-only', () => {
    expect(parseMaxDepth('0')).toBe(0);
  });

  it('maps unlimited max depth to null', () => {
    expect(parseMaxDepth('unlimited')).toBeNull();
  });
});

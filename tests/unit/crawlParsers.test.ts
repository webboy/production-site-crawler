import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  parseConcurrency,
  parseMaxDepth,
  parseUnlimitedOrPositive,
} from '../../src/cli/crawl.js';

describe('crawl CLI parsers', () => {
  it('rejects zero concurrency', () => {
    expect(() => parseConcurrency('0')).toThrow(InvalidArgumentError);
  });

  it('accepts positive concurrency', () => {
    expect(parseConcurrency('3')).toBe(3);
  });

  it('maps unlimited sentinels to null for max urls', () => {
    expect(parseUnlimitedOrPositive('unlimited', 'max-urls')).toBeNull();
    expect(parseUnlimitedOrPositive('none', 'max-urls')).toBeNull();
  });

  it('rejects zero max urls', () => {
    expect(() => parseUnlimitedOrPositive('0', 'max-urls')).toThrow(InvalidArgumentError);
  });

  it('preserves maxDepth zero as seed-only', () => {
    expect(parseMaxDepth('0')).toBe(0);
  });

  it('maps unlimited max depth to null', () => {
    expect(parseMaxDepth('unlimited')).toBeNull();
  });
});

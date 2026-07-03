import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

describe('loadConfig', () => {
  it('applies defaults, coerces numbers, and rejects malformed numeric values', () => {
    const defaults = loadConfig({});

    expect(defaults.databaseUrl).toBe(
      'postgres://crawler:crawler@localhost:5432/production_site_crawler',
    );
    expect(defaults.pg.port).toBe(5432);
    expect(defaults.pg.database).toBe('production_site_crawler');
    expect(defaults.fetchApiBaseUrl).toBe('http://mock-api.mock.com/fetch');
    expect(defaults.logLevel).toBe('info');
    expect(defaults.crawl.concurrency).toBe(5);
    expect(defaults.crawl.maxUrls).toBe(1000);
    expect(defaults.crawl.maxDepth).toBe(5);
    expect(defaults.crawl.maxBytes).toBe(104857600);
    expect(defaults.crawl.maxRuntimeSeconds).toBe(3600);
    expect(defaults.crawl.outputDir).toBe('output');

    const overridden = loadConfig({
      PGPORT: '15432',
      CONCURRENCY: '12',
      MAX_URLS: '25',
      MAX_DEPTH: '3',
      MAX_BYTES: '4096',
      MAX_RUNTIME_SECONDS: '60',
    });

    expect(overridden.pg.port).toBe(15432);
    expect(overridden.crawl.concurrency).toBe(12);
    expect(overridden.crawl.maxUrls).toBe(25);
    expect(overridden.crawl.maxDepth).toBe(3);
    expect(overridden.crawl.maxBytes).toBe(4096);
    expect(overridden.crawl.maxRuntimeSeconds).toBe(60);

    expect(() => loadConfig({ CONCURRENCY: 'not-a-number' })).toThrow(
      'Invalid numeric environment variable CONCURRENCY',
    );
  });
});

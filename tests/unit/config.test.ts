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
    expect(defaults.pg.poolMax).toBe(10);
    expect(loadConfig({ NODE_ENV: 'test' }).pg.poolMax).toBe(2);
    expect(defaults.fetchApiBaseUrl).toBe('http://mock-api.mock.com/fetch');
    expect(defaults.fetchBodyStrategy).toBe('auto');
    expect(defaults.logLevel).toBe('info');
    expect(defaults.crawl.concurrency).toBe(5);
    expect(defaults.crawl.maxUrls).toBe(1000);
    expect(loadConfig({ MAX_URLS: '0' }).crawl.maxUrls).toBeNull();
    expect(loadConfig({ MAX_URLS: '' }).crawl.maxUrls).toBeNull();
    expect(defaults.crawl.maxDepth).toBe(5);
    expect(defaults.crawl.maxBytes).toBe(104857600);
    expect(defaults.crawl.maxRuntimeSeconds).toBe(3600);
    expect(defaults.crawl.outputDir).toBe('output');
    expect(defaults.crawl.staleAfterMs).toBe(900_000);
    expect(defaults.retry.baseDelayMs).toBe(5000);
    expect(defaults.retry.maxDelayMs).toBe(300000);
    expect(defaults.retry.jitterRatio).toBe(0.25);
    expect(defaults.rateLimit.delayMs).toBe(150);
    expect(defaults.rateLimit.defaultPauseMs).toBe(5000);

    const overridden = loadConfig({
      PGPORT: '15432',
      PG_POOL_MAX: '4',
      CONCURRENCY: '12',
      MAX_URLS: '25',
      MAX_DEPTH: '3',
      MAX_BYTES: '4096',
      MAX_RUNTIME_SECONDS: '60',
      RETRY_BASE_DELAY_MS: '2500',
      RETRY_MAX_DELAY_MS: '120000',
      RETRY_JITTER_RATIO: '0.1',
      RATE_LIMIT_DELAY_MS: '200',
      RATE_LIMIT_DEFAULT_PAUSE_MS: '3000',
      FETCH_BODY_STRATEGY: 'base64',
      RUN_STALE_AFTER_MS: '60000',
    });

    expect(overridden.pg.port).toBe(15432);
    expect(overridden.pg.poolMax).toBe(4);
    expect(overridden.crawl.concurrency).toBe(12);
    expect(overridden.crawl.maxUrls).toBe(25);
    expect(overridden.crawl.maxDepth).toBe(3);
    expect(overridden.crawl.maxBytes).toBe(4096);
    expect(overridden.crawl.maxRuntimeSeconds).toBe(60);
    expect(overridden.retry.baseDelayMs).toBe(2500);
    expect(overridden.retry.maxDelayMs).toBe(120000);
    expect(overridden.retry.jitterRatio).toBe(0.1);
    expect(overridden.rateLimit.delayMs).toBe(200);
    expect(overridden.rateLimit.defaultPauseMs).toBe(3000);
    expect(overridden.fetchBodyStrategy).toBe('base64');
    expect(overridden.crawl.staleAfterMs).toBe(60_000);

    expect(() => loadConfig({ CONCURRENCY: 'not-a-number' })).toThrow(
      'Invalid numeric environment variable CONCURRENCY',
    );
    expect(() => loadConfig({ PG_POOL_MAX: '0' })).toThrow('PG_POOL_MAX must be at least 1');
    expect(() => loadConfig({ RUN_STALE_AFTER_MS: '0' })).toThrow(
      'RUN_STALE_AFTER_MS must be at least 1',
    );
    expect(() => loadConfig({ MAX_URLS: '-1' })).toThrow(
      'MAX_URLS must be >= 1, or 0/empty for unlimited',
    );
    expect(() => loadConfig({ MAX_URLS: 'not-a-number' })).toThrow(
      'Invalid numeric environment variable MAX_URLS',
    );
    expect(() => loadConfig({ FETCH_BODY_STRATEGY: 'xml' })).toThrow(
      'Invalid FETCH_BODY_STRATEGY: xml (expected auto | base64 | utf8)',
    );
  });
});

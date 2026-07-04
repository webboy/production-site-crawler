import dotenv from 'dotenv';
import type { BodyDecodeStrategy } from '../fetch/body.js';

dotenv.config();

export interface AppConfig {
  databaseUrl: string;
  pg: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    poolMax: number;
  };
  fetchApiBaseUrl: string;
  fetchBodyStrategy: BodyDecodeStrategy;
  logLevel: string;
  crawl: {
    concurrency: number;
    maxUrls: number;
    maxDepth: number;
    maxBytes: number;
    maxRuntimeSeconds: number;
    outputDir: string;
  };
  retry: {
    baseDelayMs: number;
    maxDelayMs: number;
    jitterRatio: number;
  };
  rateLimit: {
    delayMs: number;
    defaultPauseMs: number;
  };
  nodeEnv: string;
}

const DEFAULTS = {
  databaseUrl: 'postgres://crawler:crawler@localhost:5432/production_site_crawler',
  pgHost: 'localhost',
  pgPort: 5432,
  pgDatabase: 'production_site_crawler',
  pgUser: 'crawler',
  pgPassword: 'crawler',
  pgPoolMax: 10,
  testPgPoolMax: 2,
  fetchApiBaseUrl: 'http://mock-api.mock.com/fetch',
  logLevel: 'info',
  concurrency: 5,
  maxUrls: 1000,
  maxDepth: 5,
  maxBytes: 104857600,
  maxRuntimeSeconds: 3600,
  outputDir: 'output',
  retryBaseDelayMs: 5_000,
  retryMaxDelayMs: 300_000,
  retryJitterRatio: 0.25,
  rateLimitDelayMs: 150,
  rateLimitDefaultPauseMs: 5_000,
  fetchBodyStrategy: 'auto',
  nodeEnv: 'development',
} as const;

function readString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const rawValue = env[name];

  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable ${name}: ${rawValue}`);
  }

  return value;
}

function readFloat(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const rawValue = env[name];

  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable ${name}: ${rawValue}`);
  }

  return value;
}

function readBodyStrategy(env: NodeJS.ProcessEnv, name: string): BodyDecodeStrategy {
  const raw = env[name];

  if (raw === undefined || raw === '') {
    return 'auto';
  }

  if (raw === 'auto' || raw === 'base64' || raw === 'utf8') {
    return raw;
  }

  throw new Error(`Invalid ${name}: ${raw} (expected auto | base64 | utf8)`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = readString(env, 'NODE_ENV', DEFAULTS.nodeEnv);
  const concurrency = readNumber(env, 'CONCURRENCY', DEFAULTS.concurrency);
  const pgPoolMax = readNumber(
    env,
    'PG_POOL_MAX',
    nodeEnv === 'test' ? DEFAULTS.testPgPoolMax : DEFAULTS.pgPoolMax,
  );

  if (concurrency < 1) {
    throw new Error('CONCURRENCY must be at least 1');
  }

  if (pgPoolMax < 1) {
    throw new Error('PG_POOL_MAX must be at least 1');
  }

  return {
    databaseUrl: readString(env, 'DATABASE_URL', DEFAULTS.databaseUrl),
    pg: {
      host: readString(env, 'PGHOST', DEFAULTS.pgHost),
      port: readNumber(env, 'PGPORT', DEFAULTS.pgPort),
      database: readString(env, 'PGDATABASE', DEFAULTS.pgDatabase),
      user: readString(env, 'PGUSER', DEFAULTS.pgUser),
      password: readString(env, 'PGPASSWORD', DEFAULTS.pgPassword),
      poolMax: pgPoolMax,
    },
    fetchApiBaseUrl: readString(env, 'FETCH_API_BASE_URL', DEFAULTS.fetchApiBaseUrl),
    fetchBodyStrategy: readBodyStrategy(env, 'FETCH_BODY_STRATEGY'),
    logLevel: readString(env, 'LOG_LEVEL', DEFAULTS.logLevel),
    crawl: {
      concurrency,
      maxUrls: readNumber(env, 'MAX_URLS', DEFAULTS.maxUrls),
      maxDepth: readNumber(env, 'MAX_DEPTH', DEFAULTS.maxDepth),
      maxBytes: readNumber(env, 'MAX_BYTES', DEFAULTS.maxBytes),
      maxRuntimeSeconds: readNumber(env, 'MAX_RUNTIME_SECONDS', DEFAULTS.maxRuntimeSeconds),
      outputDir: readString(env, 'OUTPUT_DIR', DEFAULTS.outputDir),
    },
    retry: {
      baseDelayMs: readNumber(env, 'RETRY_BASE_DELAY_MS', DEFAULTS.retryBaseDelayMs),
      maxDelayMs: readNumber(env, 'RETRY_MAX_DELAY_MS', DEFAULTS.retryMaxDelayMs),
      jitterRatio: readFloat(env, 'RETRY_JITTER_RATIO', DEFAULTS.retryJitterRatio),
    },
    rateLimit: {
      delayMs: readNumber(env, 'RATE_LIMIT_DELAY_MS', DEFAULTS.rateLimitDelayMs),
      defaultPauseMs: readNumber(
        env,
        'RATE_LIMIT_DEFAULT_PAUSE_MS',
        DEFAULTS.rateLimitDefaultPauseMs,
      ),
    },
    nodeEnv,
  };
}

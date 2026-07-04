import { randomUUID } from 'node:crypto';
import { closePool, query } from '../../src/db/pool.js';
import { FrontierRepository } from '../../src/frontier/FrontierRepository.js';

export async function canReachDatabase(): Promise<boolean> {
  if (process.env.CI === 'true' && process.env.INTEGRATION_DATABASE_REACHABLE === '0') {
    throw new Error(
      'Integration database is unreachable in CI. Ensure the Postgres service is configured.',
    );
  }

  if (process.env.INTEGRATION_DATABASE_REACHABLE === '1') {
    return true;
  }

  if (process.env.INTEGRATION_DATABASE_REACHABLE === '0') {
    return false;
  }

  try {
    await query('SELECT 1');
    return true;
  } catch {
    await closePool();
    return false;
  }
}

export async function insertCrawlRun(): Promise<string> {
  const runId = randomUUID();

  await query(
    `
      INSERT INTO crawl_runs (id, seed_url, normalized_seed_url, scope_host)
      VALUES ($1, $2, $3, $4)
    `,
    [runId, `https://${runId}.example.com`, `https://${runId}.example.com/`, 'example.com'],
  );

  return runId;
}

export async function cleanupCrawlRun(crawlRunId: string): Promise<void> {
  await query('DELETE FROM crawl_runs WHERE id = $1', [crawlRunId]);
}

export function createFrontierRepository(): FrontierRepository {
  return new FrontierRepository();
}

export function buildUrlInput(crawlRunId: string, index: number) {
  return {
    crawlRunId,
    url: `https://example.com/page-${index}`,
    normalizedUrl: `https://example.com/page-${index}`,
    urlHash: `hash-${index}`,
    host: 'example.com',
    depth: 0,
  };
}

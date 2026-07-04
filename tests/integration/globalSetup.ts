import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { closePool, query } from '../../src/db/pool.js';

const execFileAsync = promisify(execFile);

async function canReachDatabase(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    await closePool();
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  if (!(await canReachDatabase())) {
    if (process.env.CI === 'true') {
      throw new Error(
        'Integration database is unreachable in CI. Ensure the Postgres service is configured.',
      );
    }

    process.env.INTEGRATION_DATABASE_REACHABLE = '0';
    return;
  }

  process.env.INTEGRATION_DATABASE_REACHABLE = '1';
  await closePool();
  await execFileAsync('npm', ['run', 'migrate:up'], {
    cwd: process.cwd(),
    env: process.env,
  });
}

import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { loadConfig } from '../config/env.js';
import { createLogger } from '../log/logger.js';

let pool: Pool | undefined;

function createPool(): Pool {
  const config = loadConfig();
  const logger = createLogger(config);

  const nextPool = new Pool(
    config.databaseUrl.trim() !== ''
      ? { connectionString: config.databaseUrl }
      : {
          host: config.pg.host,
          port: config.pg.port,
          database: config.pg.database,
          user: config.pg.user,
          password: config.pg.password,
        },
  );

  nextPool.on('error', (error) => {
    logger.error({ event: 'db_pool_error', error }, 'Unexpected PostgreSQL pool error');
  });

  return nextPool;
}

export function getPool(): Pool {
  pool ??= createPool();
  return pool;
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool === undefined) {
    return;
  }

  await pool.end();
  pool = undefined;
}

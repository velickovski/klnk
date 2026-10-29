import type pg from 'pg';
import { MIGRATION_LOCK_SQL } from '../../apps/server/src/migration-lock.js';

/** A legacy migration inspects constraints across schemas, so fixture teardown
 * must share its catalog fence even when every fixture has its own namespace. */
export async function dropFixtureSchema(pool: pg.Pool, schema: string): Promise<void> {
  if (!/^qa_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe cleanup namespace.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(MIGRATION_LOCK_SQL);
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

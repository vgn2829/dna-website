import { Pool } from 'pg';
import { describeDbTarget } from './dbTarget';

// Verify the server certificate by default. Set DB_SSL_REJECT_UNAUTHORIZED=false
// only for local/dev databases with self-signed certs. If a custom CA is needed,
// provide it via DB_SSL_CA.
function sslConfig() {
  if (!process.env.DATABASE_URL) return undefined;
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  return process.env.DB_SSL_CA
    ? { rejectUnauthorized, ca: process.env.DB_SSL_CA }
    : { rejectUnauthorized };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
});

// What this Pool was actually built for — captured at creation, so tests
// (tests/setup.ts) can verify it was created AFTER the test environment
// chose its database, and startup logs can say which database is in use.
export const poolTarget = describeDbTarget(process.env.DATABASE_URL);

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

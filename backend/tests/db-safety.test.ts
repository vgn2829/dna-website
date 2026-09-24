import { describe, it, expect, afterEach } from 'vitest';
import { query, poolTarget } from '../src/db/client';
import { initSchema } from '../src/db/schema';
import { assertTestDatabaseTarget, checkSchemaInitAllowed, describeDbTarget } from '../src/db/dbTarget';

// ─────────────────────────────────────────────────────────────────────────
// V3.0 operational safety: which database dev/test processes may touch.
// Hostnames below are fictional; no real deployment is referenced.
// ─────────────────────────────────────────────────────────────────────────

const REMOTE = 'postgresql://user:pw@db.example-hosted.com:6543/postgres';
const LOCAL_DEV = 'postgresql://localhost:5432/dna_club';

describe('test database target', () => {
  it('is connected to the dna_club_test database', async () => {
    const rows = await query<{ db: string }>('SELECT current_database() AS db');
    expect(rows[0].db).toBe('dna_club_test');
  });

  it('built its pool AFTER tests/env.ts chose the test database', () => {
    expect(poolTarget).toMatchObject({ database: 'dna_club_test', isLocal: true });
  });

  it('accepts a local *_test database and rejects anything else', () => {
    expect(assertTestDatabaseTarget('postgresql://localhost:5432/dna_club_test?sslmode=disable')).toMatchObject({ database: 'dna_club_test' });
    expect(assertTestDatabaseTarget('postgresql://postgres:postgres@127.0.0.1:5432/app_test')).toMatchObject({ isLocal: true });
    expect(() => assertTestDatabaseTarget('postgresql://localhost:5432/venugopal')).toThrow(/disposable/);
    expect(() => assertTestDatabaseTarget('postgresql://localhost:5432/dna_club')).toThrow(/disposable/);
    expect(() => assertTestDatabaseTarget(REMOTE)).toThrow(/remote/);
    expect(() => assertTestDatabaseTarget('postgresql://u:p@db.example-hosted.com/dna_club_test')).toThrow(/remote/);
    expect(() => assertTestDatabaseTarget(undefined)).toThrow();
  });
});

describe('schema initialization guard', () => {
  const allowed = (env: Record<string, string | undefined>) => checkSchemaInitAllowed(env).allowed;

  it('allows local development databases', () => {
    expect(allowed({ DATABASE_URL: LOCAL_DEV })).toBe(true);
    expect(allowed({ DATABASE_URL: 'postgresql://127.0.0.1/dna_club', NODE_ENV: 'development' })).toBe(true);
    expect(allowed({ DATABASE_URL: 'postgresql:///dna_club?host=/var/run/postgresql' })).toBe(true);
  });

  it('refuses a remote database from development, with an explanation', () => {
    const check = checkSchemaInitAllowed({ DATABASE_URL: REMOTE });
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/Refusing schema initialization against remote database "postgres" on db\.example-hosted\.com from a development environment/);
    expect(check.reason).toContain('ALLOW_REMOTE_SCHEMA_INIT=db.example-hosted.com');
  });

  it('still allows an explicitly production environment (Render, Docker image)', () => {
    expect(allowed({ DATABASE_URL: REMOTE, NODE_ENV: 'production' })).toBe(true);
  });

  it('only honours an override naming the exact host — not a blanket flag', () => {
    expect(allowed({ DATABASE_URL: REMOTE, ALLOW_REMOTE_SCHEMA_INIT: 'true' })).toBe(false);
    expect(allowed({ DATABASE_URL: REMOTE, ALLOW_REMOTE_SCHEMA_INIT: 'other.example.com' })).toBe(false);
    expect(allowed({ DATABASE_URL: REMOTE, ALLOW_REMOTE_SCHEMA_INIT: 'db.example-hosted.com' })).toBe(true);
  });

  it('in a test environment, only a local *_test database may be initialized (override ignored)', () => {
    expect(allowed({ DATABASE_URL: 'postgresql://localhost/dna_club_test', NODE_ENV: 'test' })).toBe(true);
    expect(allowed({ DATABASE_URL: LOCAL_DEV, NODE_ENV: 'test' })).toBe(false);
    expect(allowed({ DATABASE_URL: REMOTE, NODE_ENV: 'test', ALLOW_REMOTE_SCHEMA_INIT: 'db.example-hosted.com' })).toBe(false);
  });

  it('refuses when DATABASE_URL is missing or malformed', () => {
    expect(allowed({})).toBe(false);
    expect(allowed({ DATABASE_URL: 'not a url' })).toBe(false);
  });

  it('parses targets', () => {
    expect(describeDbTarget(REMOTE)).toEqual({ host: 'db.example-hosted.com', database: 'postgres', isLocal: false });
  });
});

describe('initSchema() enforces the guard at its real call site', () => {
  const original = process.env.DATABASE_URL;
  afterEach(() => { process.env.DATABASE_URL = original; });

  it('refuses before issuing any SQL when pointed at a remote database', async () => {
    process.env.DATABASE_URL = REMOTE; // the pool itself stays on the test DB
    await expect(initSchema()).rejects.toThrow(/test environment may only initialize a local database named \*_test/);
  });

  it('runs normally against the local test database', async () => {
    await expect(initSchema()).resolves.toBeUndefined();
  });
});

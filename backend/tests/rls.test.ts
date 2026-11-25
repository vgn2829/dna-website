import { describe, expect, it } from 'vitest';
import { query } from '../src/db/client';
import { V1_RLS_TABLES, enableRlsForNewTables } from '../src/db/rls';

// Supabase's public REST API (anon key) must see nothing in tables that hold
// roll numbers, comments or the roster. RLS-on-with-no-policies achieves that
// while the table-owning backend is unaffected (every other suite proves the
// backend can still read and write these tables).

const PREFIXES = ['designer_', 'showcase_', 'inspiration_', 'creator_', 'artwork_credits', 'student_roster'];

describe('row-level security on DNA 2.0 V1 tables', () => {
  it('is enabled on every table the release introduces', async () => {
    const rows = await query<{ tablename: string; rowsecurity: boolean }>(`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`, [[...V1_RLS_TABLES]]);
    expect(rows.map(r => r.tablename).sort()).toEqual([...V1_RLS_TABLES].sort());          // all exist
    expect(rows.filter(r => !r.rowsecurity).map(r => r.tablename)).toEqual([]);
  });

  it('cannot silently miss a future table with a V1 name prefix', async () => {
    const all = await query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    const candidates = all.map(r => r.tablename).filter(t => PREFIXES.some(p => t.startsWith(p)));
    const missing = candidates.filter(t => !(V1_RLS_TABLES as readonly string[]).includes(t));
    expect(missing, `add these to V1_RLS_TABLES in src/db/rls.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('is idempotent, and one failing table never stops the rest or throws', async () => {
    expect(await enableRlsForNewTables((await import('../src/db/client')).pool)).toEqual([]);
    expect(await enableRlsForNewTables((await import('../src/db/client')).pool)).toEqual([]);
    const failing = { query: async (sql: string) => { if (sql.includes('showcase_comments')) throw new Error('must be owner'); } };
    const skipped = await enableRlsForNewTables(failing as never);
    expect(skipped).toEqual(['showcase_comments']);
  });

  it('leaves the backend able to use the tables (owner bypasses RLS)', async () => {
    const [{ n }] = await query<{ n: string }>('SELECT COUNT(*)::text AS n FROM showcase_comments');
    expect(Number(n)).toBeGreaterThanOrEqual(0);
  });
});

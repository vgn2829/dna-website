import { describe, it, expect, beforeAll } from 'vitest';
import { localRequest } from './localServer';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query, pool } from '../src/db/client';
import { initSchema } from '../src/db/schema';
import { signStudentToken } from '../src/middleware/studentAuth';

// ─────────────────────────────────────────────────────────────────────────
// V3.2.7 — lookup indexes added by initSchema() for columns real queries
// filter on (see the comment above them in db/schema.ts; the EXPLAIN
// ANALYZE evidence was taken on a 10× dataset, not here). These tests are
// structural: the indexes exist on the right columns, the migration is
// re-runnable and restores them, results don't depend on them, and each
// target query can use its index. They don't assert timings or plan text.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

const ADDED = {
  idx_board_items_board_id: { table: 'board_items', columns: ['board_id'] },
  idx_workspace_members_roll_number: { table: 'workspace_members', columns: ['roll_number'] },
  idx_boards_owner_roll: { table: 'boards', columns: ['owner_roll'] },
} as const;

// Indexes that existed before V3.2.7 and must be untouched by it.
const PRE_EXISTING = [
  'board_items_pkey', 'board_members_pkey', 'workspace_members_pkey', 'boards_pkey', 'workspaces_pkey',
  'idx_boards_workspace_id', 'idx_boards_project_id', 'idx_assets_workspace_id', 'idx_projects_workspace_id',
  'idx_templates_workspace_id', 'idx_notifications_recipient_created', 'storage_derivatives_pkey',
];

type IndexInfo = { name: string; table: string; columns: string[]; unique: boolean };
async function indexes(): Promise<IndexInfo[]> {
  return query<IndexInfo>(`
    SELECT i.relname AS name, t.relname AS "table", ix.indisunique AS unique,
           array_agg(a.attname ORDER BY k.ord)::text[] AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = current_schema()
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    GROUP BY i.relname, t.relname, ix.indisunique`);
}

// Walks an EXPLAIN (FORMAT JSON) plan tree for the index names it uses.
function indexNames(plan: Record<string, unknown>): string[] {
  const own = typeof plan['Index Name'] === 'string' ? [plan['Index Name'] as string] : [];
  const kids = (plan.Plans as Array<Record<string, unknown>> | undefined) ?? [];
  return [...own, ...kids.flatMap(indexNames)];
}

async function registerStudent(roll: string) {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

let fx: { roll: string; board: string; project: string };

beforeAll(async () => {
  await query('TRUNCATE "board_items", "board_members", "board_favorites", "boards", "projects", "workspace_members", "workspaces" CASCADE');
  const roll = 'IDX1';
  await registerStudent(roll); await registerStudent('IDX2');
  const now = new Date().toISOString();
  const ws = `ws-${uuidv4()}`; const team = `ws-${uuidv4()}`;
  await query(`INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, 'Personal', true, $2, $3), ($4, 'Team', false, 'IDX2', $3)`, [ws, roll, now, team]);
  await query(`INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'owner', 'O', $3), ($4, $2, 'member', 'O', $3), ($4, 'IDX2', 'owner', 'T', $3)`, [ws, roll, now, team]);
  const project = await request(app).post('/api/projects').set(auth(roll)).send({ name: 'P', workspace_id: ws });
  expect(project.status).toBe(201);
  const board = `board-${uuidv4()}`;
  const insertBoard = (id: string, owner: string, wsId: string, opts: { archived?: boolean; visibility?: string; projectId?: string | null } = {}) => query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id, project_id)
     VALUES ($1, $1, $2, 'O', $3, 'members_only', $4, $4, $5, $6, $7, $8)`,
    [id, owner, opts.visibility ?? 'private', now, `room-${id}`, opts.archived ?? false, wsId, opts.projectId ?? null]);
  await insertBoard(board, roll, ws, { projectId: project.body.id });
  await insertBoard(`board-${uuidv4()}`, roll, ws, { archived: true });
  await insertBoard(`board-${uuidv4()}`, roll, ws, { archived: true });
  await insertBoard(`board-${uuidv4()}`, 'IDX2', team, { visibility: 'shared' });
  await query(
    `INSERT INTO board_items (id, board_id, image_url, added_by_roll, created_at) VALUES ($1, $3, 'https://x/a.png', $4, $5), ($2, $3, 'https://x/b.png', $4, $5)`,
    [`item-${uuidv4()}`, `item-${uuidv4()}`, board, roll, now]);
  fx = { roll, board, project: project.body.id };
});

// The read endpoints each added index serves (see db/schema.ts).
async function snapshot() {
  const out: Record<string, unknown> = {};
  for (const path of ['/api/workspaces', '/api/boards/archived', '/api/boards/shared', `/api/boards/${fx.board}`, `/api/projects/${fx.project}/boards`]) {
    const res = await request(app).get(path).set(auth(fx.roll));
    expect(res.status, path).toBe(200);
    out[path] = res.body;
  }
  return out;
}

describe('V3.2.7 lookup indexes', () => {
  it('initSchema creates each index on exactly the intended column (non-unique)', async () => {
    const all = await indexes();
    for (const [name, spec] of Object.entries(ADDED)) {
      const found = all.find(i => i.name === name);
      expect(found, name).toBeDefined();
      expect(found).toMatchObject({ table: spec.table, columns: spec.columns, unique: false });
    }
  });

  it('leaves every pre-existing index in place', async () => {
    const names = (await indexes()).map(i => i.name);
    for (const name of PRE_EXISTING) expect(names, name).toContain(name);
  });

  it('does not add the rejected candidates', async () => {
    const all = await indexes();
    // No benefit measured for GET /boards (its cost is the owner/member OR), so none was added.
    expect(all.filter(i => i.table === 'board_members' && i.columns[0] === 'roll_number')).toEqual([]);
    // Personal-workspace lookup: negligible at 10× (LIMIT 1 over a tiny table).
    expect(all.filter(i => i.table === 'workspaces' && i.columns[0] === 'owner_roll')).toEqual([]);
    // No duplicates of what the migration added.
    for (const spec of Object.values(ADDED)) {
      expect(all.filter(i => i.table === spec.table && i.columns.join() === spec.columns.join()).length, spec.table).toBe(1);
    }
  });

  it('results are identical without the indexes, and re-running the migration restores them', async () => {
    const withIndexes = await snapshot();
    const before = (await indexes()).length;
    for (const name of Object.keys(ADDED)) await query(`DROP INDEX ${name}`);
    const names = (await indexes()).map(i => i.name);
    for (const name of Object.keys(ADDED)) expect(names).not.toContain(name);

    expect(await snapshot()).toEqual(withIndexes);

    await initSchema(); // applies to a database that lacks them
    await initSchema(); // and is a no-op the second time
    const after = await indexes();
    expect(after.length).toBe(before);
    for (const name of Object.keys(ADDED)) expect(after.map(i => i.name)).toContain(name);
    expect(await snapshot()).toEqual(withIndexes);
  });

  it('each target query can use its index', async () => {
    // With sequential scans disabled the planner picks an index only if one
    // matches the predicate. Tiny test tables would otherwise always seq-scan,
    // so this checks that the index fits the query, not that it's chosen at scale.
    const cases = [
      { index: 'idx_board_items_board_id', sql: `SELECT * FROM board_items WHERE board_id = $1 AND placed_at IS NULL ORDER BY created_at DESC`, params: [fx.board] },
      { index: 'idx_workspace_members_roll_number', sql: `SELECT workspace_id FROM workspace_members WHERE roll_number = $1`, params: [fx.roll] },
      { index: 'idx_boards_owner_roll', sql: `SELECT b.id FROM boards b WHERE b.is_archived AND b.owner_roll = $1 ORDER BY b.updated_at DESC`, params: [fx.roll] },
    ];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      for (const c of cases) {
        const r = await client.query(`EXPLAIN (FORMAT JSON) ${c.sql}`, c.params);
        expect(indexNames(r.rows[0]['QUERY PLAN'][0].Plan), c.index).toContain(c.index);
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

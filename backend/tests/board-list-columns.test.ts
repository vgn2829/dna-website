import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localRequest } from './localServer';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query, pool } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { toPublicBoard } from '../src/lib/boardRows';

// ─────────────────────────────────────────────────────────────────────────
// V3.2.1 — board LIST endpoints select BOARD_LIST_COLUMNS instead of `b.*`,
// so canvas_data (the whole tldraw document) is never pulled from Postgres
// into Node for a list. Responses must be byte-for-byte what they were:
// toPublicBoard(<full row>) plus the computed list fields.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

// Columns toPublicBoard never returns (see lib/boardRows.ts).
const STRIPPED = ['canvas_data', 'canvas_item_count', 'canvas_placed_item_ids'];
// Read-time fields computed per response (not columns). preview_thumbnails
// (V3.2.5, lib/boardPreviewThumbnails.ts) maps preview image srcs to ready
// thumbnail URLs; it is never stored.
const COMPUTED = ['item_count', 'member_count', 'is_favorite', 'preview_thumbnails'];
// A legacy-sized canvas: ~1 MB that a list must never load.
const BIG_CANVAS = JSON.stringify({ document: { store: {}, schema: {} }, session: {}, legacy: 'x'.repeat(1_000_000) });

async function registerStudent(roll: string) {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}
async function createWorkspace(roll: string, personal: boolean) {
  const ws = `ws-${uuidv4()}`; const now = new Date().toISOString();
  await query(`INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, 'WS', $2, $3, $4)`, [ws, personal, roll, now]);
  await query(`INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'owner', 'Owner', $3)`, [ws, roll, now]);
  return ws;
}
async function createBoard(roll: string, ws: string, opts: { visibility?: string; archived?: boolean; projectId?: string } = {}) {
  const id = `board-${uuidv4()}`; const now = new Date().toISOString();
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id, project_id,
                         canvas_data, canvas_item_count, canvas_preview, canvas_placed_item_ids)
     VALUES ($1, 'Board', $2, 'Owner', $3, 'members_only', $4, $4, $5, $6, $7, $8, $9, 3, $10, '{}')`,
    [id, roll, opts.visibility ?? 'private', now, `room-${id}`, opts.archived ?? false, ws, opts.projectId ?? null, BIG_CANVAS,
     JSON.stringify({ v: 1, x: 0, y: 0, w: 10, h: 10, items: [] })]
  );
  return id;
}

// The exact key set a list response should expose: every boards column
// except the stripped ones, plus the computed fields. Read from the live
// schema, so adding a boards column fails this test until the list
// column set is updated deliberately.
async function expectedKeys(extra: string[] = []) {
  const cols = (await query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'boards'`)).map(r => r.column_name);
  return [...cols.filter(c => !STRIPPED.includes(c)), ...COMPUTED, ...extra].sort();
}
// What the endpoint returned before V3.2.1 for this board: toPublicBoard of
// the full `b.*` row (computed list fields are compared separately).
async function fullRowPublic(id: string) {
  const [row] = await query(`SELECT * FROM boards WHERE id = $1`, [id]);
  return toPublicBoard(row as Record<string, unknown>);
}

let setup: { roll: string; personal: string; team: string; projectId: string; boards: Record<string, string> };

beforeEach(async () => {
  await query('TRUNCATE "board_items", "board_members", "board_favorites", "boards", "projects", "templates", "workspace_members", "workspaces" CASCADE');
  const roll = 'BLC1';
  await registerStudent(roll); await registerStudent('BLC2');
  const personal = await createWorkspace(roll, true);
  const team = await createWorkspace(roll, false);
  const project = await request(app).post('/api/projects').set(auth(roll)).send({ name: 'P', workspace_id: personal });
  expect(project.status).toBe(201);
  const boards = {
    own: await createBoard(roll, personal),
    team: await createBoard(roll, team),
    shared: await createBoard(roll, team, { visibility: 'shared' }),
    archived: await createBoard(roll, personal, { archived: true }),
    inProject: await createBoard(roll, personal, { projectId: project.body.id }),
    otherUsers: await createBoard('BLC2', await createWorkspace('BLC2', true)),
  };
  await query(`INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1, 'BLC2', 'Other', $2)`, [boards.own, new Date().toISOString()]);
  setup = { roll, personal, team, projectId: project.body.id, boards };
});
afterEach(() => { vi.restoreAllMocks(); });

const LISTS = () => [
  { name: 'GET /boards', path: '/api/boards', extra: ['project_name'] },
  { name: 'GET /boards?workspace_id', path: `/api/boards?workspace_id=${setup.team}`, extra: ['project_name'] },
  { name: 'GET /boards/archived', path: '/api/boards/archived', extra: [] },
  { name: 'GET /boards/shared?workspace_id', path: `/api/boards/shared?workspace_id=${setup.team}`, extra: [] },
  { name: 'GET /boards/shared (all)', path: '/api/boards/shared', extra: [] },
  { name: 'GET /projects/:id/boards', path: `/api/projects/${setup.projectId}/boards`, extra: [] },
];

describe('board list endpoints — explicit columns, unchanged responses', () => {
  it('every list returns exactly the public board fields, with values identical to toPublicBoard(full row)', async () => {
    for (const list of LISTS()) {
      const res = await request(app).get(list.path).set(auth(setup.roll));
      expect(res.status, list.name).toBe(200);
      expect(res.body.length, list.name).toBeGreaterThan(0);
      const keys = await expectedKeys(list.extra);
      for (const board of res.body as Array<Record<string, unknown>>) {
        expect(Object.keys(board).sort(), `${list.name} keys`).toEqual(keys);
        const pub = await fullRowPublic(board.id as string);
        for (const [k, v] of Object.entries(pub)) expect(board[k], `${list.name} ${k}`).toEqual(v);
        expect(board).not.toHaveProperty('canvas_data');
      }
    }
  });

  it('computed fields and scoping are unchanged', async () => {
    const mine = (await request(app).get('/api/boards').set(auth(setup.roll))).body as Array<Record<string, unknown>>;
    const ids = mine.map(b => b.id).sort();
    expect(ids).toEqual([setup.boards.own, setup.boards.team, setup.boards.shared, setup.boards.inProject].sort()); // not archived, not other user's
    const own = mine.find(b => b.id === setup.boards.own)!;
    expect(own).toMatchObject({ item_count: 3, member_count: 1, is_favorite: false, project_name: null });
    expect(mine.find(b => b.id === setup.boards.inProject)!.project_name).toBe('P');

    const team = (await request(app).get(`/api/boards?workspace_id=${setup.team}`).set(auth(setup.roll))).body as Array<{ id: string }>;
    expect(team.map(b => b.id).sort()).toEqual([setup.boards.team, setup.boards.shared].sort());
    const archived = (await request(app).get('/api/boards/archived').set(auth(setup.roll))).body as Array<{ id: string }>;
    expect(archived.map(b => b.id)).toEqual([setup.boards.archived]);
    const shared = (await request(app).get('/api/boards/shared').set(auth(setup.roll))).body as Array<{ id: string }>;
    expect(shared.map(b => b.id)).toEqual([setup.boards.shared]);
    const project = (await request(app).get(`/api/projects/${setup.projectId}/boards`).set(auth(setup.roll))).body as Array<{ id: string }>;
    expect(project.map(b => b.id)).toEqual([setup.boards.inProject]);

    // Another student still sees none of BLC1's private boards (only the one they were added to)
    const other = (await request(app).get('/api/boards').set(auth('BLC2'))).body as Array<{ id: string }>;
    expect(other.map(b => b.id).sort()).toEqual([setup.boards.own, setup.boards.otherUsers].sort());
  });

  it('never loads canvas_data from Postgres for a list request', async () => {
    const seen: Array<{ sql: string; keys: string[] }> = [];
    const original = pool.query.bind(pool);
    vi.spyOn(pool, 'query').mockImplementation((async (...args: unknown[]) => {
      const result = await (original as (...a: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>)(...args);
      const sql = typeof args[0] === 'string' ? args[0] : String((args[0] as { text?: string })?.text ?? '');
      seen.push({ sql, keys: result.rows?.[0] ? Object.keys(result.rows[0]) : [] });
      return result;
    }) as never);

    for (const list of LISTS()) {
      seen.length = 0;
      const res = await request(app).get(list.path).set(auth(setup.roll));
      expect(res.status, list.name).toBe(200);
      const boardQueries = seen.filter(q => /FROM boards b/.test(q.sql));
      expect(boardQueries.length, `${list.name} ran its list query`).toBeGreaterThan(0);
      for (const q of seen) expect(q.keys, `${list.name}: a row with canvas_data reached Node`).not.toContain('canvas_data');
      for (const q of boardQueries) expect(q.sql, list.name).not.toMatch(/\bb\.\*/);
    }
  });

  it('the board detail and canvas endpoints still serve the full canvas', async () => {
    const detail = await request(app).get(`/api/boards/${setup.boards.own}`).set(auth(setup.roll));
    expect(detail.status).toBe(200);
    expect(detail.body).not.toHaveProperty('canvas_data'); // unchanged: detail never shipped it
    const canvas = await request(app).get(`/api/boards/${setup.boards.own}/canvas`).set(auth(setup.roll));
    expect(canvas.status).toBe(200);
    expect(canvas.body.canvas_data).toBe(BIG_CANVAS);
  });
});

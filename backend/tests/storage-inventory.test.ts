import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query, pool } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { getStorage } from '../src/storage';
import * as storageModule from '../src/storage';
import { createVersion } from '../src/realtime/history/versionStorage';
import { classifyStorageObjects, summarizeInventory, type ClassifiedObject } from '../src/storage/inventory';
import { settleDerivativeJobs } from '../src/storage/derivatives';

// ─────────────────────────────────────────────────────────────────────────
// Storage inventory (dry run) — classification of real local-storage
// objects created through the real upload / board / asset / template /
// duplicate / version paths. Every test also proves the inventory never
// touched storage: the same objects exist, unchanged, afterwards.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function registerStudent(roll: string) {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

async function workspace(roll: string, name = 'WS') {
  const res = await request(app).post('/api/workspaces').set(auth(roll)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
async function board(roll: string, ws: string, name = 'Board') {
  const res = await request(app).post('/api/boards').set(auth(roll)).send({ name, workspace_id: ws });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
// A board-owned canvas file, uploaded through the real canvas-files route.
async function canvasFile(roll: string, boardId: string) {
  const res = await request(app).post(`/api/boards/${boardId}/canvas-files`).set(auth(roll))
    .field('fileId', `f${uuidv4().replace(/-/g, '').slice(0, 12)}`)
    .attach('file', PNG_1PX, { filename: 'x.png', contentType: 'image/png' });
  expect(res.status).toBe(200);
  const key = new URL(res.body.url).pathname.replace(/^\/uploads\//, '');
  return { key, url: res.body.url as string };
}
async function asset(roll: string, ws: string) {
  const res = await request(app).post('/api/assets').set(auth(roll)).field('workspace_id', ws)
    .attach('file', PNG_1PX, { filename: 'a.png', contentType: 'image/png' });
  expect(res.status).toBe(201);
  const key = (await query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [res.body.id]))[0].storage_key;
  return { id: res.body.id as string, key, url: res.body.url as string };
}
// Minimal saved canvas that references `url` as a tldraw image asset src.
const canvasReferencing = (...urls: string[]) => JSON.stringify({
  document: { store: Object.fromEntries(urls.map((u, i) => [`asset:a${i}`, { typeName: 'asset', id: `asset:a${i}`, type: 'image', props: { src: u } }])), schema: {} },
  session: {},
});
const emptyCanvas = () => JSON.stringify({ document: { store: {}, schema: {} }, session: {} });
async function saveCanvas(roll: string, boardId: string, canvas: string) {
  expect((await request(app).put(`/api/boards/${boardId}/canvas`).set(auth(roll)).send({ canvas_data: canvas })).status).toBe(200);
}
const deleteBoard = async (roll: string, id: string) => expect((await request(app).delete(`/api/boards/${id}`).set(auth(roll))).status).toBe(200);

// Classify exactly the given keys, and prove the classification left the
// underlying objects untouched.
async function classifyKeys(keys: string[]): Promise<Record<string, ClassifiedObject>> {
  const listed = (await Promise.all([...new Set(keys.map(k => k.slice(0, k.lastIndexOf('/') + 1)))].map(p => getStorage().list(p)))).flat();
  const objects = listed.filter(o => keys.includes(o.path));
  expect(objects.map(o => o.path).sort()).toEqual([...keys].sort());
  const before = keys.map(k => fs.readFileSync(path.join(UPLOADS_DIR, k)));
  // Image uploads schedule a background thumbnail derivative (V3.2.3,
  // storage/derivatives.ts). Let those finish first, so the spies below
  // observe only what CLASSIFICATION does — which must still be nothing.
  await settleDerivativeJobs();
  const deleteSpy = vi.spyOn(getStorage(), 'delete');
  const uploadSpy = vi.spyOn(getStorage(), 'upload');
  const result = await classifyStorageObjects(objects);
  expect(deleteSpy).not.toHaveBeenCalled();
  expect(uploadSpy).not.toHaveBeenCalled();
  keys.forEach((k, i) => expect(fs.readFileSync(path.join(UPLOADS_DIR, k)).equals(before[i])).toBe(true));
  return Object.fromEntries(result.map(r => [r.path, r]));
}

beforeEach(async () => {
  await query('TRUNCATE "board_items", "board_versions", "board_members", "board_favorites", "boards", "templates", "assets", "workspace_members", "workspaces" CASCADE');
});
afterEach(() => { vi.restoreAllMocks(); });

describe('storage inventory — board canvas files', () => {
  it('1. a live board file is LIVE_OWNER (not a candidate)', async () => {
    await registerStudent('SI1');
    const b = await board('SI1', await workspace('SI1'));
    const f = await canvasFile('SI1', b);
    await saveCanvas('SI1', b, canvasReferencing(f.url));
    const r = (await classifyKeys([f.key]))[f.key];
    expect(r).toMatchObject({ namespace: 'canvas-files', classification: 'LIVE_OWNER', ownerExists: true, owner: `board ${b}` });
    expect(r.referenceTypes).toEqual(['board canvas']);
  });

  it('2. a deleted board file with no remaining references is ORPHAN', async () => {
    await registerStudent('SI2');
    const b = await board('SI2', await workspace('SI2'));
    const f = await canvasFile('SI2', b);
    await saveCanvas('SI2', b, canvasReferencing(f.url));
    await deleteBoard('SI2', b);
    expect((await classifyKeys([f.key]))[f.key]).toMatchObject({ classification: 'ORPHAN', ownerExists: false, referenceCount: 0 });
  });

  it('3/9/10. a deleted board file still referenced by a cross-workspace duplicate, a template and a version is REFERENCED_WITHOUT_OWNER', async () => {
    await registerStudent('SI3');
    await registerStudent('SI3M');
    const team = await workspace('SI3', 'Team');
    const b = await board('SI3', team);
    const f = await canvasFile('SI3', b);
    await saveCanvas('SI3', b, canvasReferencing(f.url));
    await query(`INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1, 'SI3M', 'M', $2)`, [b, new Date().toISOString()]);
    const dup = await request(app).post(`/api/boards/${b}/duplicate`).set(auth('SI3M'));
    expect(dup.status).toBe(201);
    expect(dup.body.workspace_id).not.toBe(team); // lands in the duplicator's personal workspace
    const tpl = await request(app).post('/api/templates').set(auth('SI3')).send({ source_board_id: b, name: 'T' });
    expect(tpl.status).toBe(201);
    const other = await board('SI3', team, 'Other');
    await createVersion({ boardId: other, snapshot: JSON.parse(canvasReferencing(f.url)) as never, createdByRoll: 'SI3', createdByName: 'S', trigger: 'explicit' });
    await deleteBoard('SI3', b);

    const r = (await classifyKeys([f.key]))[f.key];
    expect(r).toMatchObject({ classification: 'REFERENCED_WITHOUT_OWNER', ownerExists: false, referenceCount: 3 });
    expect(r.referenceTypes).toEqual(['board canvas', 'board version', 'template']);
  });

  it('11/12. stays REFERENCED_WITHOUT_OWNER until the final reference disappears, then becomes ORPHAN', async () => {
    await registerStudent('SI11');
    const ws = await workspace('SI11');
    const b = await board('SI11', ws);
    const f = await canvasFile('SI11', b);
    const r1 = await board('SI11', ws, 'Ref 1');
    const r2 = await board('SI11', ws, 'Ref 2');
    await saveCanvas('SI11', r1, canvasReferencing(f.url));
    await saveCanvas('SI11', r2, canvasReferencing(f.url));
    await deleteBoard('SI11', b);

    expect((await classifyKeys([f.key]))[f.key]).toMatchObject({ classification: 'REFERENCED_WITHOUT_OWNER', referenceCount: 2 });
    await saveCanvas('SI11', r1, emptyCanvas());                 // first reference removed
    expect((await classifyKeys([f.key]))[f.key]).toMatchObject({ classification: 'REFERENCED_WITHOUT_OWNER', referenceCount: 1 });
    await deleteBoard('SI11', r2);                               // final reference removed
    expect((await classifyKeys([f.key]))[f.key]).toMatchObject({ classification: 'ORPHAN', referenceCount: 0 });
  });
});

describe('storage inventory — asset library files', () => {
  it('4. a live asset file is LIVE_OWNER', async () => {
    await registerStudent('SI4');
    const a = await asset('SI4', await workspace('SI4'));
    expect((await classifyKeys([a.key]))[a.key]).toMatchObject({ namespace: 'assets', classification: 'LIVE_OWNER', ownerExists: true });
  });

  it('5. an asset deleted while a board references it (retained by 3e8fba3) is REFERENCED_WITHOUT_OWNER, not ORPHAN', async () => {
    await registerStudent('SI5');
    const ws = await workspace('SI5');
    const a = await asset('SI5', ws);
    const b = await board('SI5', ws);
    await saveCanvas('SI5', b, canvasReferencing(a.url));
    const del = await request(app).delete(`/api/assets/${a.id}`).set(auth('SI5'));
    expect(del.body).toEqual({ success: true, fileRetained: true });
    expect((await classifyKeys([a.key]))[a.key]).toMatchObject({ classification: 'REFERENCED_WITHOUT_OWNER', ownerExists: false, referenceTypes: ['board canvas'] });
  });

  it('6. an asset row gone with no references (object left by a failed storage delete) is ORPHAN', async () => {
    await registerStudent('SI6');
    const a = await asset('SI6', await workspace('SI6'));
    // The real route's documented failure path: row deleted, object delete
    // fails → storageWarning, object left behind with no row.
    vi.spyOn(storageModule.getStorage(), 'delete').mockRejectedValueOnce(new Error('simulated storage outage'));
    const del = await request(app).delete(`/api/assets/${a.id}`).set(auth('SI6'));
    expect(del.body.storageWarning).toBeTruthy();
    vi.restoreAllMocks();
    expect((await classifyKeys([a.key]))[a.key]).toMatchObject({ classification: 'ORPHAN', ownerExists: false, referenceCount: 0 });
  });
});

describe('storage inventory — unsafe or unmanaged paths are UNKNOWN and retained', () => {
  it('7. malformed managed paths are UNKNOWN', async () => {
    const id = uuidv4();
    const keys = [`canvas-files/${id}/nested/x.png`, `assets/${id}/no-extension`];
    for (const k of keys) await getStorage().upload(k, PNG_1PX, 'image/png');
    try {
      const r = await classifyKeys(keys);
      for (const k of keys) expect(r[k]).toMatchObject({ classification: 'UNKNOWN', owner: null });
      expect(r[keys[0]].reason).toMatch(/malformed canvas-files path/);
    } finally {
      for (const k of keys) await getStorage().delete(k); // disposable test fixtures only
    }
  });

  it('8. files in namespaces the cleanup does not manage are UNKNOWN', async () => {
    const keys = [`gallery/${uuidv4()}.png`, `team/${uuidv4()}.png`, `unexpected-${uuidv4()}/file.bin`];
    for (const k of keys) await getStorage().upload(k, PNG_1PX, 'image/png');
    try {
      const r = await classifyKeys(keys);
      for (const k of keys) expect(r[k]).toMatchObject({ classification: 'UNKNOWN', namespace: 'other' });
    } finally {
      for (const k of keys) await getStorage().delete(k); // disposable test fixtures only
    }
  });
});

describe('storage inventory — read-only session', () => {
  it('classifies on a client inside BEGIN READ ONLY, where any write is rejected by Postgres', async () => {
    await registerStudent('SIRO');
    const a = await asset('SIRO', await workspace('SIRO'));
    const objects = (await getStorage().list(a.key.slice(0, a.key.lastIndexOf('/') + 1))).filter(o => o.path === a.key);
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      expect((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('on');
      const [r] = await classifyStorageObjects(objects, client);
      expect(r).toMatchObject({ path: a.key, classification: 'LIVE_OWNER' });
      await expect(client.query("UPDATE boards SET name = name")).rejects.toThrow(/read-only transaction/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(fs.existsSync(path.join(UPLOADS_DIR, a.key))).toBe(true);
  });
});

describe('storage inventory — summary', () => {
  it('only ORPHAN rows count as candidates; totals are consistent', async () => {
    await registerStudent('SIS');
    const ws = await workspace('SIS');
    const live = await asset('SIS', ws);
    const b = await board('SIS', ws);
    const gone = await canvasFile('SIS', b);
    await deleteBoard('SIS', b);
    const items = Object.values(await classifyKeys([live.key, gone.key]));
    const s = summarizeInventory(items);
    expect(s.totalObjects).toBe(2);
    expect(s.byClass.LIVE_OWNER.count).toBe(1);
    expect(s.byClass.ORPHAN.count).toBe(1);
    expect(s.orphansByNamespace).toEqual({ 'canvas-files': { count: 1, bytes: PNG_1PX.length } });
    expect(s.totalBytes).toBe(2 * PNG_1PX.length);
  });
});

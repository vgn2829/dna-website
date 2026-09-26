import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import { settleDerivativeJobs } from '../src/storage/derivatives';

// ─────────────────────────────────────────────────────────────────────────
// Shared Creative Library — ADMIN moderation of templates and assets
// (visibility override, hide/restore), through the real HTTP router against
// the local test DB. Its own file (own app, own rate-limit window): the
// companion library-visibility.test.ts already makes a few hundred requests.
//
// Cast, in every test: OWNER and MEMBER share a team workspace; OUTSIDER is
// a registered student who is not a member of it (and owns a workspace of
// their own). "Community" is the item's workspace members — never public,
// never another workspace.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
const request = localRequest(app);

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const CANVAS = JSON.stringify({ document: { store: { 'shape:a': { id: 'shape:a', type: 'geo' } }, schema: {} }, session: {} });

const OWNER = 'LIBOWN1', MEMBER = 'LIBMEM1', OUTSIDER = 'LIBOUT1';
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

async function registerStudent(roll: string, name = `Student ${roll}`): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, name, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

async function createWorkspace(roll: string, name: string): Promise<string> {
  return (await request(app).post('/api/workspaces').set(auth(roll)).send({ name })).body.id as string;
}

async function addMember(ws: string, roll: string, role?: 'admin'): Promise<void> {
  await request(app).post(`/api/workspaces/${ws}/members`).set(auth(OWNER)).send({ roll_number: roll, ...(role ? { role } : {}) });
}

async function createBoardDirect(roll: string, ws: string): Promise<string> {
  const id = `lib-board-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, room_id, created_at, updated_at, canvas_data, workspace_id)
     VALUES ($1, 'Source', $2, 'Owner', 'private', $3, $4, $4, $5, $6)`,
    [id, roll, `room-${id}`, now, CANVAS, ws]
  );
  return id;
}

async function createTemplate(roll: string, board: string, visibility?: 'personal' | 'community', name = 'Poster') {
  return request(app).post('/api/templates').set(auth(roll)).send({ name, source_board_id: board, ...(visibility ? { visibility } : {}) });
}

async function uploadPng(roll: string, ws: string, visibility?: string) {
  const req = request(app).post('/api/assets').set(auth(roll)).field('workspace_id', ws);
  if (visibility !== undefined) req.field('visibility', visibility);
  return req.attach('file', PNG_1PX, { filename: 'mark.png', contentType: 'image/png' });
}

const listTemplates = (roll: string, ws: string, scope?: string) =>
  request(app).get(`/api/templates?workspace_id=${ws}${scope ? `&scope=${scope}` : ''}`).set(auth(roll));
const listAssets = (roll: string, ws: string, scope?: string) =>
  request(app).get(`/api/assets?workspace_id=${ws}${scope ? `&scope=${scope}` : ''}`).set(auth(roll));
const ids = (rows: Array<{ id: string }>) => rows.map(r => r.id).sort();

let ws: string;
let outsiderWs: string;

beforeEach(async () => {
  await query('TRUNCATE "assets", "asset_collections", "templates", "board_members", "boards", "projects", "workspace_members", "workspaces" CASCADE');
  await registerStudent(OWNER, 'Venu');
  await registerStudent(MEMBER);
  await registerStudent(OUTSIDER);
  ws = await createWorkspace(OWNER, 'DnA Design');
  await addMember(ws, MEMBER);
  outsiderWs = await createWorkspace(OUTSIDER, 'Elsewhere');
});

afterEach(() => { vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────
// Admin moderation (routes/assets.ts + routes/templates.ts /admin/*): the
// site admin JWT from POST /api/auth/admin/login. Student tokens — even a
// workspace owner's or a workspace admin's — never reach these routes.
// ─────────────────────────────────────────────────────────────────────────
describe('admin moderation', () => {
  let adminToken = '';
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  // Direct inserts (like asset-library.test.ts's insertAssetDirect): the upload
  // route is covered above and is rate-limited to 20 per minute.
  let n = 0;
  const insertAsset = async (roll: string, workspace: string, visibility: 'personal' | 'community' = 'personal') => {
    const id = `adm-asset-${++n}-${Math.random().toString(36).slice(2, 8)}`;
    await query(
      `INSERT INTO assets (id, workspace_id, owner_roll, owner_name, kind, filename, storage_key, mime_type, size_bytes, created_at, visibility)
       VALUES ($1, $2, $3, (SELECT name FROM student_sessions WHERE roll_number = $3), 'image', 'mark.png', $4, 'image/png', 10, $5, $6)`,
      [id, workspace, roll, `assets/${workspace}/${id}.png`, new Date(Date.now() + n).toISOString(), visibility]
    );
    return id;
  };
  beforeEach(async () => {
    if (!adminToken) {
      adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token;
    }
    await registerStudent('LIBWSADM');
    await addMember(ws, 'LIBWSADM', 'admin');
  });

  it('6–8 & 16: non-admins — plain member, workspace owner, workspace admin — cannot list or moderate (401)', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const t = (await createTemplate(OWNER, board, 'community')).body.id as string;
    const a = await insertAsset(OWNER, ws, 'community');
    for (const roll of [MEMBER, OWNER, 'LIBWSADM']) {
      expect((await request(app).get('/api/assets/admin/all').set(auth(roll))).status).toBe(401);
      expect((await request(app).get('/api/templates/admin/all').set(auth(roll))).status).toBe(401);
      expect((await request(app).patch(`/api/assets/admin/${a}`).set(auth(roll)).send({ status: 'hidden' })).status).toBe(401);
      expect((await request(app).patch(`/api/assets/admin/${a}`).set(auth(roll)).send({ visibility: 'personal' })).status).toBe(401);
      expect((await request(app).patch(`/api/templates/admin/${t}`).set(auth(roll)).send({ status: 'hidden' })).status).toBe(401);
    }
    expect((await query<{ status: string; visibility: string }>('SELECT status, visibility FROM assets WHERE id = $1', [a]))[0]).toEqual({ status: 'active', visibility: 'community' });
    expect((await query<{ status: string }>('SELECT status FROM templates WHERE id = $1', [t]))[0].status).toBe('active');
  });

  it('9 & 17: admin lists every item across workspaces — personal, community, hidden — with search and filters', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const personalT = (await createTemplate(OWNER, board, undefined, 'Secret Layout')).body.id as string;
    const outsiderBoard = await createBoardDirect(OUTSIDER, outsiderWs);
    const otherT = (await createTemplate(OUTSIDER, outsiderBoard, 'community', 'Elsewhere Kit')).body.id as string;
    const personalA = await insertAsset(OWNER, ws);
    const otherA = await insertAsset(OUTSIDER, outsiderWs, 'community');
    await request(app).patch(`/api/assets/admin/${personalA}`).set(admin()).send({ status: 'hidden' });

    const assets = await request(app).get('/api/assets/admin/all').set(admin());
    expect(assets.status).toBe(200);
    expect(ids(assets.body.assets)).toEqual([personalA, otherA].sort());
    const hiddenRow = assets.body.assets.find((x: { id: string }) => x.id === personalA);
    expect(hiddenRow).toMatchObject({ status: 'hidden', visibility: 'personal', owner_roll: OWNER, owner_name: 'Venu', workspace_name: 'DnA Design' });
    expect(hiddenRow.storage_key).toBeUndefined();
    expect(ids((await request(app).get('/api/assets/admin/all?status=hidden').set(admin())).body.assets)).toEqual([personalA]);
    expect(ids((await request(app).get('/api/assets/admin/all?q=venu').set(admin())).body.assets)).toEqual([personalA]);

    const templates = await request(app).get('/api/templates/admin/all').set(admin());
    expect(ids(templates.body.templates)).toEqual([personalT, otherT].sort());
    expect(templates.body.templates.every((t: Record<string, unknown>) => t.canvas_data === undefined)).toBe(true);
    expect(ids((await request(app).get('/api/templates/admin/all?q=Elsewhere').set(admin())).body.templates)).toEqual([otherT]);
    expect(ids((await request(app).get('/api/templates/admin/all?visibility=personal').set(admin())).body.templates)).toEqual([personalT]);
    expect((await request(app).get('/api/templates/admin/all?status=gone').set(admin())).status).toBe(400);
  });

  it('10 & 18: admin switches Personal ↔ Community; members see the change, within the item\'s own workspace only', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const t = (await createTemplate(OWNER, board)).body.id as string;
    const a = await insertAsset(OWNER, ws);

    expect((await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ visibility: 'community' })).body.visibility).toBe('community');
    expect((await request(app).patch(`/api/templates/admin/${t}`).set(admin()).send({ visibility: 'community' })).body.visibility).toBe('community');
    expect(ids((await listAssets(MEMBER, ws)).body.assets)).toEqual([a]);
    expect(ids((await listTemplates(MEMBER, ws)).body)).toEqual([t]);
    // 23: an admin override never reaches another workspace.
    expect((await listAssets(OUTSIDER, ws)).status).toBe(403);
    expect((await listAssets(OUTSIDER, outsiderWs)).body.assets).toEqual([]);
    expect((await listTemplates(OUTSIDER, outsiderWs)).body).toEqual([]);

    await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ visibility: 'personal' });
    await request(app).patch(`/api/templates/admin/${t}`).set(admin()).send({ visibility: 'personal' });
    expect((await listAssets(MEMBER, ws)).body.assets).toEqual([]);
    expect((await listTemplates(MEMBER, ws)).body).toEqual([]);
    // Ownership never moves.
    expect((await query<{ owner_roll: string }>('SELECT owner_roll FROM assets WHERE id = $1', [a]))[0].owner_roll).toBe(OWNER);
  });

  it('11–15: hidden assets leave every normal flow (owner included), keep their file, and restore intact', async () => {
    const pack = (await request(app).post('/api/asset-collections').set(auth(OWNER)).send({ workspace_id: ws, name: 'Brand' })).body.id as string;
    const a = await insertAsset(OWNER, ws, 'community');
    const url = (await request(app).get(`/api/assets/${a}`).set(auth(OWNER))).body.url as string;
    await request(app).patch(`/api/assets/${a}`).set(auth(OWNER)).send({ collection_id: pack });
    const keyBefore = (await query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [a]))[0].storage_key;
    await settleDerivativeJobs();
    const storage = storageModule.getStorage();
    const deleteSpy = vi.spyOn(storage, 'delete');
    const uploadSpy = vi.spyOn(storage, 'upload');

    const hidden = await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ status: 'hidden' });
    expect(hidden.status).toBe(200);
    expect(hidden.body.status).toBe('hidden');

    for (const roll of [OWNER, MEMBER]) {
      for (const scope of [undefined, 'all', 'mine', 'community']) expect(ids((await listAssets(roll, ws, scope)).body.assets)).toEqual([]);
      expect((await request(app).get(`/api/assets?workspace_id=${ws}&q=mark`).set(auth(roll))).body.assets).toEqual([]);
      expect((await request(app).get(`/api/assets/${a}`).set(auth(roll))).status).toBe(404);
    }
    expect((await request(app).patch(`/api/assets/${a}`).set(auth(OWNER)).send({ visibility: 'personal' })).status).toBe(404);
    expect((await request(app).delete(`/api/assets/${a}`).set(auth(OWNER))).status).toBe(404);
    const count = ((await request(app).get(`/api/asset-collections?workspace_id=${ws}`).set(auth(OWNER))).body.collections as Array<{ asset_count: number }>)[0].asset_count;
    expect(count).toBe(0);

    // 14 & 15: still there, same file, nothing written or removed in storage.
    expect(await query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [a])).toEqual([{ storage_key: keyBefore }]);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();

    const restored = await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ status: 'active' });
    expect(restored.body).toMatchObject({ status: 'active', visibility: 'community', collection_id: pack, url });
    expect(ids((await listAssets(MEMBER, ws)).body.assets)).toEqual([a]);
    expect((await request(app).get(`/api/assets/${a}`).set(auth(MEMBER))).status).toBe(200);
  });

  it('19–22: hidden templates cannot be listed, fetched or used by anyone (owner included); restore is lossless', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const t = (await createTemplate(OWNER, board, 'community')).body.id as string;
    const before = (await query<Record<string, unknown>>('SELECT canvas_data, name, owner_roll, workspace_id, visibility FROM templates WHERE id = $1', [t]))[0];

    expect((await request(app).patch(`/api/templates/admin/${t}`).set(admin()).send({ status: 'hidden' })).body.status).toBe('hidden');
    for (const roll of [OWNER, MEMBER]) {
      for (const scope of [undefined, 'all', 'mine', 'community']) expect((await listTemplates(roll, ws, scope)).body).toEqual([]);
      expect((await request(app).get(`/api/templates/${t}`).set(auth(roll))).status).toBe(404);
      expect((await request(app).post(`/api/templates/${t}/use`).set(auth(roll)).send({})).status).toBe(404);
    }
    expect((await request(app).patch(`/api/templates/${t}`).set(auth(OWNER)).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/templates/${t}`).set(auth(OWNER))).status).toBe(404);
    expect(await query('SELECT 1 FROM boards WHERE owner_roll = $1', [MEMBER])).toHaveLength(0);

    const restored = await request(app).patch(`/api/templates/admin/${t}`).set(admin()).send({ status: 'active' });
    expect(restored.body.status).toBe('active');
    expect((await query<Record<string, unknown>>('SELECT canvas_data, name, owner_roll, workspace_id, visibility FROM templates WHERE id = $1', [t]))[0]).toEqual(before);
    expect((await request(app).post(`/api/templates/${t}/use`).set(auth(MEMBER)).send({})).status).toBe(201);
  });

  it('23 & 24: the admin token is not a student token; admin updates cannot move ownership or workspace; bad requests fail', async () => {
    const a = await insertAsset(OWNER, ws);
    // An admin token never passes student routes (no workspace membership).
    expect((await request(app).get(`/api/assets?workspace_id=${ws}`).set(admin())).status).toBe(401);
    expect((await request(app).get(`/api/assets/${a}`).set(admin())).status).toBe(401);
    // Only visibility/status are accepted — ownership/workspace fields are ignored.
    await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ status: 'active', workspace_id: outsiderWs, owner_roll: OUTSIDER });
    expect((await query<{ workspace_id: string; owner_roll: string }>('SELECT workspace_id, owner_roll FROM assets WHERE id = $1', [a]))[0])
      .toEqual({ workspace_id: ws, owner_roll: OWNER });
    // Direct unauthorized / malformed calls.
    expect((await request(app).get('/api/assets/admin/all')).status).toBe(401);
    expect((await request(app).get('/api/templates/admin/all').set({ Authorization: 'Bearer not-a-token' })).status).toBe(401);
    expect((await request(app).patch('/api/assets/admin/nope').set(admin()).send({ status: 'hidden' })).status).toBe(404);
    expect((await request(app).patch('/api/templates/admin/nope').set(admin()).send({ status: 'hidden' })).status).toBe(404);
    expect((await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ status: 'deleted' })).status).toBe(400);
    expect((await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({})).status).toBe(400);
  });
});

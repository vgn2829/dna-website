import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import { derivativeKey, settleDerivativeJobs } from '../src/storage/derivatives';

// ─────────────────────────────────────────────────────────────────────────
// Shared Creative Library — upload stability, permissions and admin
// moderation for assets (routes/assets.ts), through the real HTTP router,
// the local test DB and the real LocalStorageProvider (SUPABASE_* unset).
//
//   - any signed-in workspace member uploads Personal or Community
//     (Community reaches the source workspace's members, plus workspaces
//     the asset is explicitly shared with — routes/assetSharing.ts)
//   - uploads are idempotent per client_upload_id: a retried upload never
//     stores a second file or row, even when two attempts race
//   - concurrent uploads resolve independently
//   - admin endpoints refuse every student token; admin changes never move
//     owner, workspace or storage key; admin delete follows the same
//     reference-safe storage rules as the owner's delete
//
// This file makes exactly 20 upload requests — the route's per-minute
// limiter (one limiter per test file). Add uploads elsewhere.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
const request = localRequest(app);
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const OWNER = 'UPLOWN1', MEMBER = 'UPLMEM1', OUTSIDER = 'UPLOUT1';
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

function upload(roll: string, ws: string, opts: { visibility?: string; clientUploadId?: string; name?: string; bytes?: Buffer; type?: string; kind?: string } = {}) {
  const req = request(app).post('/api/assets').set(auth(roll)).field('workspace_id', ws);
  if (opts.visibility) req.field('visibility', opts.visibility);
  if (opts.clientUploadId) req.field('client_upload_id', opts.clientUploadId);
  if (opts.kind) req.field('kind', opts.kind);
  return req.attach('file', opts.bytes ?? PNG_1PX, { filename: opts.name ?? 'mark.png', contentType: opts.type ?? 'image/png' });
}

const rowOf = async (id: string) => (await query<{ owner_roll: string; workspace_id: string; storage_key: string; visibility: string; status: string }>(
  'SELECT owner_roll, workspace_id, storage_key, visibility, status FROM assets WHERE id = $1', [id]))[0];
const objectExists = (key: string) => fs.existsSync(path.join(UPLOADS_DIR, key));

let ws: string;
let outsiderWs: string;
let adminToken = '';
const admin = () => ({ Authorization: `Bearer ${adminToken}` });

beforeEach(async () => {
  await query('TRUNCATE "board_items", "board_versions", "board_members", "boards", "templates", "assets", "asset_collections", "projects", "workspace_members", "workspaces" CASCADE');
  for (const r of [OWNER, MEMBER, OUTSIDER]) await registerStudent(r);
  ws = (await request(app).post('/api/workspaces').set(auth(OWNER)).send({ name: 'DnA QA' })).body.id as string;
  await request(app).post(`/api/workspaces/${ws}/members`).set(auth(OWNER)).send({ roll_number: MEMBER });
  outsiderWs = (await request(app).post('/api/workspaces').set(auth(OUTSIDER)).send({ name: 'Elsewhere' })).body.id as string;
  if (!adminToken) {
    adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleDerivativeJobs();
});

describe('who can upload', () => {
  it('1 & 2: a workspace member uploads Personal and Community; the row, storage object and owner are right', async () => {
    const personal = await upload(MEMBER, ws);
    const community = await upload(MEMBER, ws, { visibility: 'community' });
    expect([personal.status, community.status]).toEqual([201, 201]);
    expect([personal.body.visibility, community.body.visibility]).toEqual(['personal', 'community']);
    for (const res of [personal, community]) {
      const row = await rowOf(res.body.id);
      expect(row.owner_roll).toBe(MEMBER);
      expect(row.workspace_id).toBe(ws);
      expect(row.storage_key).toBe(`assets/${ws}/${res.body.id}.png`);
      expect(objectExists(row.storage_key)).toBe(true);
    }
  });

  it('3: a non-member cannot upload into the workspace, and anonymous uploads are refused', async () => {
    expect((await upload(OUTSIDER, ws, { visibility: 'community' })).status).toBe(403);
    const anon = await request(app).post('/api/assets').field('workspace_id', ws).attach('file', PNG_1PX, { filename: 'a.png', contentType: 'image/png' });
    expect(anon.status).toBe(401);
    expect((await query('SELECT 1 FROM assets')).length).toBe(0);
  });

  it('an empty (0-byte) file is refused, so a broken image is never stored', async () => {
    const res = await upload(OWNER, ws, { bytes: Buffer.alloc(0) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The file is empty (0 bytes)');
    expect((await query('SELECT 1 FROM assets')).length).toBe(0);
  });

  it('non-image files (RAW, video) upload as downloadable files, never as previewable images', async () => {
    const raw = await upload(OWNER, ws, { name: 'DSC09876.ARW', type: 'image/x-sony-arw', kind: 'file', bytes: Buffer.alloc(2048, 7) });
    const video = await upload(OWNER, ws, { name: 'clip.mp4', type: 'video/mp4', kind: 'file', bytes: Buffer.alloc(4096, 1), visibility: 'community' });
    expect([raw.status, video.status]).toEqual([201, 201]);
    expect(raw.body).toMatchObject({ kind: 'file', extension: 'arw', thumb_url: null });
    expect(video.body).toMatchObject({ kind: 'file', extension: 'mp4', visibility: 'community' });
    for (const res of [raw, video]) expect(objectExists((await rowOf(res.body.id)).storage_key)).toBe(true);
  });
});

describe('idempotent, independent uploads', () => {
  it('a retry with the same client_upload_id returns the first asset — one row, one stored file', async () => {
    const spy = vi.spyOn(storageModule.getStorage(), 'uploadFile');
    const id = uuidv4();
    const first = await upload(OWNER, ws, { clientUploadId: id, visibility: 'community' });
    const retry = await upload(OWNER, ws, { clientUploadId: id, visibility: 'community' });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body).not.toHaveProperty('client_upload_id');
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await query('SELECT id FROM assets')).length).toBe(1);
    // The key is per owner: another member's same key is a different upload.
    expect((await upload(MEMBER, ws, { clientUploadId: id })).status).toBe(201);
    expect((await query('SELECT id FROM assets')).length).toBe(2);
  });

  it('two attempts racing with the same key still leave exactly one row and one stored file', async () => {
    const id = uuidv4();
    const storeSpy = vi.spyOn(storageModule.getStorage(), 'uploadFile');
    const deleteSpy = vi.spyOn(storageModule.getStorage(), 'delete');
    const [a, b] = await Promise.all([upload(OWNER, ws, { clientUploadId: id }), upload(OWNER, ws, { clientUploadId: id })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    // Either the loser saw the winner's row (one store), or both stored and
    // the loser removed its own copy (two stores, one delete).
    expect(storeSpy.mock.calls.length - deleteSpy.mock.calls.length).toBe(1);
    expect(a.body.id).toBe(b.body.id);
    const rows = await query<{ storage_key: string }>('SELECT storage_key FROM assets');
    expect(rows).toHaveLength(1);
    const stored = fs.readdirSync(path.join(UPLOADS_DIR, 'assets', ws));
    expect(stored).toEqual([path.basename(rows[0].storage_key)]);
  });

  it('rejects a malformed client_upload_id before storing anything', async () => {
    const res = await upload(OWNER, ws, { clientUploadId: '../../etc' });
    expect(res.status).toBe(400);
    expect((await query('SELECT 1 FROM assets')).length).toBe(0);
  });

  it('22: simultaneous uploads resolve independently — one bad request fails alone', async () => {
    const results = await Promise.all([
      upload(OWNER, ws, { name: 'a.png' }),
      upload(OWNER, ws, { name: 'b.png', visibility: 'community' }),
      upload(OWNER, ws, { name: 'c.psd', type: 'application/octet-stream', kind: 'file', bytes: Buffer.alloc(1024, 3) }),
      upload(OWNER, ws, { visibility: 'public' }), // invalid visibility
    ]);
    expect(results.map(r => r.status)).toEqual([201, 201, 201, 400]);
    const keys = (await query<{ storage_key: string }>('SELECT storage_key FROM assets')).map(r => r.storage_key);
    expect(new Set(keys).size).toBe(3);
    for (const k of keys) expect(objectExists(k)).toBe(true);
  });
});

describe('admin moderation', () => {
  it('4: every student token — member, workspace owner — is refused by the admin endpoints; the admin token is allowed', async () => {
    const a = (await upload(OWNER, ws, { visibility: 'community' })).body.id as string;
    for (const who of [MEMBER, OWNER]) {
      expect((await request(app).get('/api/assets/admin/all').set(auth(who))).status).toBe(401);
      expect((await request(app).patch(`/api/assets/admin/${a}`).set(auth(who)).send({ status: 'hidden' })).status).toBe(401);
      expect((await request(app).delete(`/api/assets/admin/${a}`).set(auth(who))).status).toBe(401);
    }
    expect((await request(app).delete(`/api/assets/admin/${a}`)).status).toBe(401);
    expect((await rowOf(a)).status).toBe('active');

    const list = await request(app).get('/api/assets/admin/all?visibility=community').set(admin());
    expect(list.status).toBe(200);
    expect(list.body.assets.map((x: { id: string }) => x.id)).toEqual([a]);
    expect(list.body.assets[0]).toMatchObject({ owner_roll: OWNER, workspace_name: 'DnA QA', visibility: 'community', status: 'active', kind: 'image', extension: 'png' });
    expect(list.body.assets[0].size_bytes).toBeGreaterThan(0);
  });

  it('5: hide, restore and visibility changes never move owner, workspace or the stored file', async () => {
    const a = (await upload(MEMBER, ws, { visibility: 'workspace' })).body.id as string;
    // The outsider's workspace reaches the asset only through an explicit grant.
    expect((await request(app).put(`/api/assets/admin/${a}/shares/${outsiderWs}`).set(admin())).status).toBe(204);
    const before = await rowOf(a);
    const listCommunity = async (roll: string, w: string) =>
      (await request(app).get(`/api/assets?workspace_id=${w}`).set(auth(roll))).body.assets.map((x: { id: string }) => x.id);

    expect((await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ status: 'hidden' })).body.status).toBe('hidden');
    expect(await listCommunity(OUTSIDER, outsiderWs)).toEqual([]);
    expect(await listCommunity(OWNER, ws)).toEqual([]);
    expect((await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ status: 'active' })).body.status).toBe('active');
    expect(await listCommunity(OWNER, ws)).toEqual([a]);
    expect(await listCommunity(OUTSIDER, outsiderWs)).toEqual([a]);
    expect((await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ visibility: 'personal' })).body.visibility).toBe('personal');
    expect(await listCommunity(OUTSIDER, outsiderWs)).toEqual([]);

    const after = await rowOf(a);
    expect({ ...after, visibility: before.visibility }).toEqual(before);
    expect(objectExists(after.storage_key)).toBe(true);
  });

  it('delete (active or hidden): row, file and derivatives go when nothing references the file', async () => {
    const a = (await upload(OWNER, ws, { visibility: 'community' })).body.id as string;
    await settleDerivativeJobs();
    const key = (await rowOf(a)).storage_key;
    const derived = derivativeKey(key);
    expect(objectExists(derived)).toBe(true);
    await request(app).patch(`/api/assets/admin/${a}`).set(admin()).send({ status: 'hidden' });

    const res = await request(app).delete(`/api/assets/admin/${a}`).set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await rowOf(a)).toBeUndefined();
    expect(objectExists(key)).toBe(false);
    expect(objectExists(derived)).toBe(false);
    expect((await request(app).delete(`/api/assets/admin/${a}`).set(admin())).status).toBe(404);
  });

  it('delete keeps the file while a board still uses it (placed shared asset — by reference, never copied)', async () => {
    const up = await upload(OWNER, ws, { visibility: 'workspace' });
    const key = (await rowOf(up.body.id)).storage_key;
    // Shared with the outsider's workspace, the outsider places the
    // workspace asset on their own board: the canvas stores the asset's
    // URL — the same single stored object.
    expect((await request(app).put(`/api/assets/admin/${up.body.id}/shares/${outsiderWs}`).set(admin())).status).toBe(204);
    const board = (await request(app).post('/api/boards').set(auth(OUTSIDER)).send({ name: 'Mine', workspace_id: outsiderWs })).body.id as string;
    const seen = (await request(app).get(`/api/assets/${up.body.id}?workspace_id=${outsiderWs}`).set(auth(OUTSIDER))).body.url as string;
    expect(seen).toContain((await rowOf(up.body.id)).storage_key);
    const canvas = { document: { store: { 'asset:x': { typeName: 'asset', id: 'asset:x', type: 'image', props: { src: seen } } }, schema: {} }, session: {} };
    expect((await request(app).put(`/api/boards/${board}/canvas`).set(auth(OUTSIDER)).send({ canvas_data: JSON.stringify(canvas) })).status).toBe(200);
    expect(fs.readdirSync(path.join(UPLOADS_DIR, 'assets', ws))).toHaveLength(1);

    const res = await request(app).delete(`/api/assets/admin/${up.body.id}`).set(admin());
    expect(res.body).toEqual({ success: true, fileRetained: true });
    expect(await rowOf(up.body.id)).toBeUndefined();
    expect(objectExists(key)).toBe(true);
  });
});

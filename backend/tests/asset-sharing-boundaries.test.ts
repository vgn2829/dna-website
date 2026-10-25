import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import { settleDerivativeJobs } from '../src/storage/derivatives';

// ─────────────────────────────────────────────────────────────────────────
// Asset sharing boundaries (routes/assets.ts + routes/assetSharing.ts),
// through the real HTTP router, the local test DB and LocalStorageProvider.
//
// The reported bug: Community was scoped to the asset's source workspace,
// and most assets live in a personal workspace (one member), so publishing
// reached nobody. The fix is an explicit grant to a team workspace the
// owner manages. These tests pin that flow end to end, plus what a revoke
// must and must not do to content already saved on boards.
//
// Cast: ALICE owns personal workspace p-alice and team TEAM (owner);
// BOB is an ordinary member of TEAM and of STUDIO (owned by DAVE); EVE is
// in none of them.
// ─────────────────────────────────────────────────────────────────────────

afterEach(async () => { await settleDerivativeJobs(); vi.restoreAllMocks(); });

const app = createApp();
const request = localRequest(app);
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const ids = (r: { body: { assets: { id: string }[] } }) => r.body.assets.map(a => a.id);
const list = (roll: string, ws: string, filters = '') => request(app).get(`/api/assets?workspace_id=${ws}${filters}`).set(auth(roll));
const detail = (roll: string, id: string, ws?: string) =>
  request(app).get(`/api/assets/${id}${ws ? `?workspace_id=${ws}` : ''}`).set(auth(roll));
const upload = (roll: string, ws: string, fields: Record<string, string> = {}) => {
  let req = request(app).post('/api/assets').set(auth(roll)).field('workspace_id', ws);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', PNG, { filename: 'mark.png', contentType: 'image/png' });
};
const share = (roll: string, id: string, ws: string) => request(app).put(`/api/assets/${id}/shares/${ws}`).set(auth(roll));
const unshare = (roll: string, id: string, ws: string) => request(app).delete(`/api/assets/${id}/shares/${ws}`).set(auth(roll));

let adminToken = '';
const admin = () => ({ Authorization: `Bearer ${adminToken}` });

beforeEach(async () => {
  await query('TRUNCATE "board_items", "board_versions", "board_members", "boards", "templates", "assets", "asset_collections", "workspace_members", "workspaces" CASCADE');
  for (const roll of ['ALICE', 'BOB', 'EVE']) {
    await query(
      `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
       VALUES ($1, $2, '01 Jan 2026', $1, $3) ON CONFLICT (roll_number) DO NOTHING`,
      [roll, `IITK-DnA-${roll}-AAAA`, `${roll.toLowerCase()}@iitk.ac.in`]
    );
  }
  await query(`INSERT INTO workspaces(id, name, is_personal, owner_roll, created_at) VALUES
    ('p-alice', 'Alice', true, 'ALICE', now()), ('p-bob', 'Bob', true, 'BOB', now()), ('team', 'Team', false, 'ALICE', now()),
    ('studio', 'Studio', false, 'DAVE', now())`);
  await query(`INSERT INTO workspace_members(workspace_id, roll_number, role, added_at) VALUES
    ('p-alice', 'ALICE', 'owner', now()), ('p-bob', 'BOB', 'owner', now()),
    ('team', 'ALICE', 'owner', now()), ('team', 'BOB', 'member', now()),
    ('studio', 'DAVE', 'owner', now()), ('studio', 'BOB', 'member', now())`);
  if (!adminToken) {
    adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
  }
});

describe('personal workspace → team workspace sharing (the reported bug)', () => {
  it('a community asset in a personal workspace reaches a team only once it is explicitly shared', async () => {
    const up = await upload('ALICE', 'p-alice', { visibility: 'community' });
    expect(up.status).toBe(201);
    const id = up.body.id as string;

    // Before sharing: Community alone reaches no one outside p-alice.
    expect(ids(await list('BOB', 'team', '&scope=community'))).toEqual([]);
    expect((await detail('BOB', id, 'team')).status).toBe(404);

    const before = (await query('SELECT * FROM assets WHERE id = $1', [id]))[0];
    expect((await share('ALICE', id, 'team')).status).toBe(204);

    for (const scope of ['', '&scope=all', '&scope=community']) expect(ids(await list('BOB', 'team', scope))).toEqual([id]);
    expect(ids(await list('BOB', 'team', '&scope=mine'))).toEqual([]);
    expect(ids(await list('BOB', 'team', '&q=mark'))).toEqual([id]);
    // Picker revalidation (BoardPage) and an unscoped detail both allow it.
    const seen = await detail('BOB', id, 'team');
    expect(seen.status).toBe(200);
    expect(seen.body.url).toBe(up.body.url);
    expect((await detail('BOB', id)).status).toBe(200);
    // Not through Bob's other workspaces, and never for Eve.
    expect((await detail('BOB', id, 'p-bob')).status).toBe(404);
    expect((await detail('EVE', id)).status).toBe(404);

    // Metadata only: same row, same owner, same workspace, same single object.
    expect((await query('SELECT * FROM assets WHERE id = $1', [id]))[0]).toEqual(before);
    expect(await query('SELECT count(*)::int AS n FROM assets')).toEqual([{ n: 1 }]);
    expect(fs.readdirSync(path.join(UPLOADS_DIR, 'assets', 'p-alice')).filter(f => f.startsWith(id))).toHaveLength(1);
  });

  it('a personal workspace is never a grant target, for owners or site admins', async () => {
    const id = (await upload('ALICE', 'team', { visibility: 'community' })).body.id as string;
    const info = await request(app).get(`/api/assets/${id}/shares`).set(auth('ALICE'));
    expect(info.status).toBe(200);
    expect(info.body.targets).toEqual([]); // not p-alice (personal), not team (source)
    expect((await share('ALICE', id, 'p-alice')).status).toBe(404);
    expect((await request(app).put(`/api/assets/admin/${id}/shares/p-bob`).set(admin())).status).toBe(404);
    expect(await query('SELECT * FROM asset_workspace_grants')).toEqual([]);
  });

  it('only the owner manages sharing; ordinary members and recipients cannot share or revoke', async () => {
    const id = (await upload('ALICE', 'p-alice', { visibility: 'community' })).body.id as string;
    expect((await share('BOB', id, 'team')).status).toBe(404);
    expect((await request(app).get(`/api/assets/${id}/shares`).set(auth('BOB'))).status).toBe(404);
    await share('ALICE', id, 'team');
    expect((await unshare('BOB', id, 'team')).status).toBe(404);
    expect(ids(await list('BOB', 'team'))).toEqual([id]);
  });
});

describe('ordinary members share their own assets', () => {
  it('an ordinary member shares their own asset into a team they belong to, and nowhere else', async () => {
    const id = (await upload('BOB', 'p-bob', { visibility: 'community' })).body.id as string;
    const info = await request(app).get(`/api/assets/${id}/shares`).set(auth('BOB'));
    expect(info.status).toBe(200);
    expect(info.body.targets.map((t: { id: string }) => t.id).sort()).toEqual(['studio', 'team']);

    expect((await share('BOB', id, 'team')).status).toBe(204);
    expect(ids(await list('ALICE', 'team'))).toEqual([id]);
    expect((await detail('ALICE', id, 'team')).status).toBe(200);
    // Not into a personal workspace (another's, or their own), nor one they aren't in.
    expect((await share('BOB', id, 'p-alice')).status).toBe(404);
    expect((await share('BOB', id, 'p-bob')).status).toBe(409); // its own source
    // Outsiders stay isolated.
    expect((await detail('EVE', id)).status).toBe(404);
    expect((await share('EVE', id, 'team')).status).toBe(404);
    expect(ids(await list('DAVE', 'studio'))).toEqual([]);

    // Bob revokes his own grant.
    expect((await unshare('BOB', id, 'team')).status).toBe(204);
    expect(ids(await list('ALICE', 'team'))).toEqual([]);
  });

  it("no member can share, inspect or revoke another user's asset", async () => {
    const id = (await upload('ALICE', 'team', { visibility: 'community' })).body.id as string;
    // Bob can see and use it in TEAM, and is a member of STUDIO — still not his to share.
    expect((await detail('BOB', id, 'team')).status).toBe(200);
    expect((await share('BOB', id, 'studio')).status).toBe(404);
    expect((await request(app).get(`/api/assets/${id}/shares`).set(auth('BOB'))).status).toBe(404);
    expect((await request(app).put(`/api/assets/admin/${id}/shares/studio`).set(auth('BOB'))).status).toBe(401);
    expect(await query('SELECT * FROM asset_workspace_grants')).toEqual([]);

    // Once a site admin shares it into STUDIO, Bob still can't revoke it.
    expect((await request(app).put(`/api/assets/admin/${id}/shares/studio`).set(admin())).status).toBe(204);
    expect((await unshare('BOB', id, 'studio')).status).toBe(404);
    expect(ids(await list('DAVE', 'studio'))).toEqual([id]);
  });

  it('removed members lose the right to share, and recipients lose access', async () => {
    const own = (await upload('BOB', 'team', { visibility: 'community' })).body.id as string;
    // Removed from the target: can no longer share into it.
    await query(`DELETE FROM workspace_members WHERE workspace_id = 'studio' AND roll_number = 'BOB'`);
    expect((await share('BOB', own, 'studio')).status).toBe(404);
    // Removed from the source: can no longer share it anywhere.
    await query(`INSERT INTO workspace_members(workspace_id, roll_number, role, added_at) VALUES ('studio', 'BOB', 'member', now())`);
    await query(`DELETE FROM workspace_members WHERE workspace_id = 'team' AND roll_number = 'BOB'`);
    expect((await share('BOB', own, 'studio')).status).toBe(404);
    expect((await request(app).get(`/api/assets/${own}/shares`).set(auth('BOB'))).status).toBe(404);

    // A recipient removed from the target loses list and detail access.
    const alice = (await upload('ALICE', 'p-alice', { visibility: 'community' })).body.id as string;
    await share('ALICE', alice, 'team');
    expect(ids(await list('ALICE', 'team'))).toContain(alice);
    await query(`INSERT INTO workspace_members(workspace_id, roll_number, role, added_at) VALUES ('team', 'BOB', 'member', now())`);
    expect((await detail('BOB', alice, 'team')).status).toBe(200);
    await query(`DELETE FROM workspace_members WHERE workspace_id = 'team' AND roll_number = 'BOB'`);
    expect((await list('BOB', 'team')).status).toBe(403);
    expect((await detail('BOB', alice)).status).toBe(404);
  });
});

describe('revoking blocks new discovery and use but never touches saved content', () => {
  it('a board that already placed the asset keeps it; the file survives revoke and even owner delete', async () => {
    const up = await upload('ALICE', 'p-alice', { visibility: 'community' });
    const id = up.body.id as string;
    const key = (await query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [id]))[0].storage_key;
    await share('ALICE', id, 'team');

    // Bob places it on a team board: the canvas stores the asset's URL.
    const board = (await request(app).post('/api/boards').set(auth('BOB')).send({ name: 'Team board', workspace_id: 'team' })).body.id as string;
    const url = (await detail('BOB', id, 'team')).body.url as string;
    const canvas = JSON.stringify({ document: { store: { 'asset:x': { typeName: 'asset', id: 'asset:x', type: 'image', props: { src: url } } }, schema: {} }, session: {} });
    expect((await request(app).put(`/api/boards/${board}/canvas`).set(auth('BOB')).send({ canvas_data: canvas })).status).toBe(200);

    expect((await unshare('ALICE', id, 'team')).status).toBe(204);
    // New discovery and new use (the picker's revalidation) are blocked…
    expect(ids(await list('BOB', 'team'))).toEqual([]);
    expect((await detail('BOB', id, 'team')).status).toBe(404);
    // …but the saved board is untouched and its image still resolves.
    expect((await query<{ canvas_data: string }>('SELECT canvas_data FROM boards WHERE id = $1', [board]))[0].canvas_data).toBe(canvas);
    expect(fs.existsSync(path.join(UPLOADS_DIR, key))).toBe(true);
    expect((await request(app).get(`/uploads/${key}`)).status).toBe(200);

    // Deleting the asset later still keeps a file a board references.
    const del = await request(app).delete(`/api/assets/${id}`).set(auth('ALICE'));
    expect(del.body).toEqual({ success: true, fileRetained: true });
    expect(fs.existsSync(path.join(UPLOADS_DIR, key))).toBe(true);
  });

  it('unpublishing or hiding suspends a grant; a removed recipient loses access', async () => {
    const id = (await upload('ALICE', 'p-alice', { visibility: 'community' })).body.id as string;
    await share('ALICE', id, 'team');
    expect((await request(app).patch(`/api/assets/${id}`).set(auth('ALICE')).send({ visibility: 'personal' })).status).toBe(200);
    expect(ids(await list('BOB', 'team'))).toEqual([]);
    expect((await detail('BOB', id, 'team')).status).toBe(404);
    expect((await share('ALICE', id, 'team')).status).toBe(409);

    await request(app).patch(`/api/assets/${id}`).set(auth('ALICE')).send({ visibility: 'community' });
    await request(app).patch(`/api/assets/admin/${id}`).set(admin()).send({ status: 'hidden' });
    expect(ids(await list('BOB', 'team'))).toEqual([]);
    expect((await detail('BOB', id, 'team')).status).toBe(404);

    await request(app).patch(`/api/assets/admin/${id}`).set(admin()).send({ status: 'active' });
    expect(ids(await list('BOB', 'team'))).toEqual([id]);
    await query(`DELETE FROM workspace_members WHERE workspace_id = 'team' AND roll_number = 'BOB'`);
    expect((await list('BOB', 'team')).status).toBe(403);
    expect((await detail('BOB', id)).status).toBe(404);
  });
});

describe('upload efficiency', () => {
  it('stores originals as immutable and fingerprints only keyed (retryable) uploads', async () => {
    const store = vi.spyOn(storageModule.getStorage(), 'uploadFile');
    const plain = await upload('ALICE', 'team');
    const keyed = await upload('ALICE', 'team', { client_upload_id: 'keyed-upload-1' });
    expect(plain.status).toBe(201);
    expect(keyed.status).toBe(201);
    for (const call of store.mock.calls) expect(call[3]).toEqual({ cacheControl: storageModule.IMMUTABLE_CACHE_SECONDS });

    const rows = await query<{ id: string; upload_fingerprint: string | null }>('SELECT id, upload_fingerprint FROM assets');
    expect(rows.find(r => r.id === plain.body.id)!.upload_fingerprint).toBeNull();
    expect(rows.find(r => r.id === keyed.body.id)!.upload_fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // The local provider serves the same header Supabase stores.
    const key = (await query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [plain.body.id]))[0].storage_key;
    const served = await request(app).get(`/uploads/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('other uploads (not under assets/) keep their default caching', async () => {
    const dir = path.join(UPLOADS_DIR, 'canvas-qa');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'x.png'), PNG);
    try {
      const served = await request(app).get('/uploads/canvas-qa/x.png');
      expect(served.status).toBe(200);
      expect(served.headers['cache-control']).not.toContain('immutable');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

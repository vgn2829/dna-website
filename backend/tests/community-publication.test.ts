import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { pool, query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { settleDerivativeJobs } from '../src/storage/derivatives';
import { ASSET_VISIBILITY_MIGRATION, migrateAssetVisibility } from '../src/db/assetSharingSchema';

// ─────────────────────────────────────────────────────────────────────────
// Club-wide Community publication for assets (lib/libraryVisibility.ts),
// through the real HTTP router, the local test DB, LocalStorageProvider and
// the real thumbnail pipeline.
//
// The reported bug: an artwork published to Community from its owner's
// Personal workspace (in the Admin panel or by the owner) reached nobody.
// Community was scoped to the asset's source workspace — a personal
// workspace's only member is its owner — and grants can never target a
// personal workspace. Community is now a deliberate publication to every
// signed-in student, from whichever workspace they are in.
//
// Cast: ALICE (personal p-alice); BOB, a member of TEAM (and his own
// p-bob) — he is never in any workspace of Alice's; CAROL, a member of
// STUDIO only.
// ─────────────────────────────────────────────────────────────────────────

afterEach(async () => { await settleDerivativeJobs(); vi.restoreAllMocks(); });

const app = createApp();
const request = localRequest(app);
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const ids = (r: { body: { assets: { id: string }[] } }) => r.body.assets.map(a => a.id);
const list = (roll: string, ws: string, filters = '') => request(app).get(`/api/assets?workspace_id=${ws}${filters}`).set(auth(roll));
const detail = (roll: string, id: string, ws?: string) =>
  request(app).get(`/api/assets/${id}${ws ? `?workspace_id=${ws}` : ''}`).set(auth(roll));
const patch = (roll: string, id: string, body: object) => request(app).patch(`/api/assets/${id}`).set(auth(roll)).send(body);
// A served file, through the app's own /uploads route (local storage).
const fetchFile = (url: string) => request(app).get(new URL(url).pathname);

let adminToken = '';
const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const adminPatch = (id: string, body: object) => request(app).patch(`/api/assets/admin/${id}`).set(admin()).send(body);

let jpeg: Buffer;
const upload = (roll: string, ws: string, visibility?: string, filename = 'artwork.jpg') => {
  let req = request(app).post('/api/assets').set(auth(roll)).field('workspace_id', ws);
  if (visibility) req = req.field('visibility', visibility);
  return req.attach('file', jpeg, { filename, contentType: 'image/jpeg' });
};

beforeEach(async () => {
  jpeg ??= await sharp({ create: { width: 900, height: 700, channels: 3, background: '#36c' } }).jpeg().toBuffer();
  await query('TRUNCATE "storage_derivatives", "board_items", "board_versions", "board_members", "boards", "templates", "assets", "asset_collections", "workspace_members", "workspaces" CASCADE');
  for (const roll of ['ALICE', 'BOB', 'CAROL']) {
    await query(
      `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
       VALUES ($1, $2, '01 Jan 2026', $1, $3) ON CONFLICT (roll_number) DO NOTHING`,
      [roll, `IITK-DnA-${roll}-AAAA`, `${roll.toLowerCase()}@iitk.ac.in`]
    );
  }
  await query(`INSERT INTO workspaces(id, name, is_personal, owner_roll, created_at) VALUES
    ('p-alice', 'Alice', true, 'ALICE', now()), ('p-bob', 'Bob', true, 'BOB', now()),
    ('team', 'Team', false, 'BOB', now()), ('studio', 'Studio', false, 'CAROL', now())`);
  await query(`INSERT INTO workspace_members(workspace_id, roll_number, role, added_at) VALUES
    ('p-alice', 'ALICE', 'owner', now()), ('p-bob', 'BOB', 'owner', now()),
    ('team', 'BOB', 'owner', now()), ('studio', 'CAROL', 'owner', now())`);
  if (!adminToken) {
    adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
  }
});

describe('publishing from Personal to Community', () => {
  it.each([
    ['the Admin panel', (id: string) => adminPatch(id, { visibility: 'community' })],
    ['the owner', (id: string) => patch('ALICE', id, { visibility: 'community' })],
  ])('published by %s, another user finds, opens and fetches it from a workspace the owner is not in', async (_by, publish) => {
    const up = await upload('ALICE', 'p-alice');
    expect(up.status).toBe(201);
    const id = up.body.id as string;
    await settleDerivativeJobs();

    // Personal: Bob sees nothing, anywhere.
    for (const ws of ['team', 'p-bob']) expect(ids(await list('BOB', ws))).toEqual([]);
    expect((await detail('BOB', id)).status).toBe(404);

    const published = await publish(id);
    expect(published.status).toBe(200);
    expect(published.body.visibility).toBe('community');

    // Discovery from every workspace Bob is in — without joining Alice's.
    for (const ws of ['team', 'p-bob']) {
      for (const filters of ['', '&scope=all', '&scope=community', '&q=artwork', '&kind=image']) {
        expect(ids(await list('BOB', ws, filters))).toEqual([id]);
      }
      expect(ids(await list('BOB', ws, '&scope=mine'))).toEqual([]);
      // Collections are per workspace: a collection view stays local.
      expect(ids(await list('BOB', ws, '&collection_id=none'))).toEqual([]);
    }
    // …and for an unrelated member too.
    expect(ids(await list('CAROL', 'studio', '&scope=community'))).toEqual([id]);

    // Opening it, unscoped and as a picker action for Bob's own board workspace.
    for (const ws of [undefined, 'team', 'p-bob']) {
      const seen = await detail('BOB', id, ws);
      expect(seen.status).toBe(200);
      expect(seen.body.url).toBe(up.body.url);
      expect(seen.body).not.toHaveProperty('storage_key');
    }
    // The original and its thumbnail are retrievable through the URLs given.
    const seen = (await detail('BOB', id, 'team')).body as { url: string; thumb_url: string | null };
    expect((await fetchFile(seen.url)).status).toBe(200);
    expect(seen.thumb_url).toEqual(expect.any(String));
    expect((await fetchFile(seen.thumb_url!)).status).toBe(200);

    // Nothing moved: same row, owner, workspace and single stored object.
    const row = (await query<{ owner_roll: string; workspace_id: string }>('SELECT owner_roll, workspace_id FROM assets WHERE id = $1', [id]))[0];
    expect(row).toEqual({ owner_roll: 'ALICE', workspace_id: 'p-alice' });
    expect(await query('SELECT count(*)::int AS n FROM assets')).toEqual([{ n: 1 }]);
    expect(await query('SELECT * FROM asset_workspace_grants')).toEqual([]);
  });

  it('never exposes the owner’s unpublished assets, and a picker action needs the target workspace', async () => {
    const personal = (await upload('ALICE', 'p-alice', 'personal', 'sketch.jpg')).body.id as string;
    const scoped = (await upload('ALICE', 'p-alice', 'workspace', 'draft.jpg')).body.id as string;
    const published = (await upload('ALICE', 'p-alice', 'community', 'final.jpg')).body.id as string;

    for (const filters of ['', '&scope=all', '&scope=community', '&q=sketch', '&q=draft', `&cursor=${personal}`]) {
      const res = await list('BOB', 'team', filters);
      expect(res.status).toBe(200);
      expect(ids(res)).not.toContain(personal);
      expect(ids(res)).not.toContain(scoped);
    }
    for (const id of [personal, scoped]) {
      expect((await detail('BOB', id)).status).toBe(404);
      expect((await detail('BOB', id, 'team')).status).toBe(404);
    }
    // A Community asset revalidated for a workspace Bob isn't in answers 404.
    expect((await detail('BOB', published, 'studio')).status).toBe(404);
    expect((await detail('BOB', published, 'p-alice')).status).toBe(404);
    // Listing someone else's workspace still needs membership.
    expect((await list('BOB', 'p-alice')).status).toBe(403);
  });

  it('an ordinary workspace share never becomes Community-wide', async () => {
    const id = (await upload('ALICE', 'p-alice', 'workspace')).body.id as string;
    await query(`INSERT INTO workspace_members(workspace_id, roll_number, role, added_at) VALUES ('team', 'ALICE', 'member', now())`);
    expect((await request(app).put(`/api/assets/${id}/shares/team`).set(auth('ALICE'))).status).toBe(204);

    expect(ids(await list('BOB', 'team'))).toEqual([id]);
    expect(ids(await list('BOB', 'team', '&scope=community'))).toEqual([]);
    expect(ids(await list('BOB', 'p-bob'))).toEqual([]);
    expect(ids(await list('CAROL', 'studio'))).toEqual([]);
    expect((await detail('CAROL', id)).status).toBe(404);
    // Sharing a Community asset to a workspace is refused: it needs no grant.
    await patch('ALICE', id, { visibility: 'community' });
    const other = (await upload('ALICE', 'p-alice', 'community')).body.id as string;
    expect((await request(app).put(`/api/assets/${other}/shares/team`).set(auth('ALICE'))).status).toBe(409);
  });

  it('an empty Community answers an empty list, not an error', async () => {
    const res = await list('BOB', 'team', '&scope=community');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ assets: [], nextCursor: null });
  });
});

describe('revoking Community publication', () => {
  it.each([
    ['the owner', (id: string) => patch('ALICE', id, { visibility: 'personal' })],
    ['the Admin panel', (id: string) => adminPatch(id, { visibility: 'personal' })],
    ['an admin hide', (id: string) => adminPatch(id, { status: 'hidden' })],
  ])('by %s stops discovery and new use, but keeps the file and every saved reference', async (_by, revoke) => {
    const up = await upload('ALICE', 'p-alice', 'community');
    const id = up.body.id as string;
    await settleDerivativeJobs();
    const key = (await query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [id]))[0].storage_key;

    // Bob places it on a team board, saves a version and a template of it.
    const board = (await request(app).post('/api/boards').set(auth('BOB')).send({ name: 'Team board', workspace_id: 'team' })).body.id as string;
    const url = (await detail('BOB', id, 'team')).body.url as string;
    const canvas = JSON.stringify({ document: { store: { 'asset:x': { typeName: 'asset', id: 'asset:x', type: 'image', props: { src: url } } }, schema: {} }, session: {} });
    expect((await request(app).put(`/api/boards/${board}/canvas`).set(auth('BOB')).send({ canvas_data: canvas })).status).toBe(200);
    // (The versions API is mounted only with realtime; a saved version is a row.)
    await query(`INSERT INTO board_versions(id, board_id, snapshot, created_by_roll, created_at, trigger)
      VALUES ('v1', $1, $2, 'BOB', now()::text, 'manual')`, [board, canvas]);
    expect((await request(app).post('/api/templates').set(auth('BOB')).send({ name: 'T', source_board_id: board })).status).toBe(201);

    expect((await revoke(id)).status).toBe(200);

    for (const ws of ['team', 'p-bob']) {
      for (const filters of ['', '&scope=community']) expect(ids(await list('BOB', ws, filters))).toEqual([]);
    }
    expect((await detail('BOB', id)).status).toBe(404);
    expect((await detail('BOB', id, 'team')).status).toBe(404);

    // Revocation is metadata only: the row, the file and the saved board,
    // version and template are untouched, and the image still resolves.
    expect(await query('SELECT 1 FROM assets WHERE id = $1', [id])).toHaveLength(1);
    expect((await query<{ canvas_data: string }>('SELECT canvas_data FROM boards WHERE id = $1', [board]))[0].canvas_data).toBe(canvas);
    expect((await query<{ snapshot: string }>(`SELECT snapshot FROM board_versions WHERE id = 'v1'`))[0].snapshot).toBe(canvas);
    expect(await query('SELECT 1 FROM templates')).toHaveLength(1);
    expect(fs.existsSync(path.join(UPLOADS_DIR, key))).toBe(true);
    expect((await fetchFile(url)).status).toBe(200);
    // Deleting the asset afterwards still keeps the referenced file.
    if ((await query<{ status: string }>('SELECT status FROM assets WHERE id = $1', [id]))[0].status === 'active') {
      expect((await request(app).delete(`/api/assets/${id}`).set(auth('ALICE'))).body).toEqual({ success: true, fileRetained: true });
    } else {
      expect((await request(app).delete(`/api/assets/admin/${id}`).set(admin())).body).toEqual({ success: true, fileRetained: true });
    }
    expect(fs.existsSync(path.join(UPLOADS_DIR, key))).toBe(true);
  });

  it('repeated publish and revoke requests are idempotent', async () => {
    const id = (await upload('ALICE', 'p-alice')).body.id as string;
    for (let i = 0; i < 2; i++) {
      const [a, b] = await Promise.all([patch('ALICE', id, { visibility: 'community' }), patch('ALICE', id, { visibility: 'community' })]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(ids(await list('BOB', 'team'))).toEqual([id]);
      expect((await patch('ALICE', id, { visibility: 'personal' })).status).toBe(200);
      expect((await patch('ALICE', id, { visibility: 'personal' })).status).toBe(200);
      expect(ids(await list('BOB', 'team'))).toEqual([]);
    }
    expect(await query('SELECT count(*)::int AS n FROM assets')).toEqual([{ n: 1 }]);
  });
});

describe('who may publish, revoke and access', () => {
  it('only the owner (or a site admin) can publish or revoke; others are refused through the API', async () => {
    const personal = (await upload('ALICE', 'p-alice')).body.id as string;
    const published = (await upload('ALICE', 'p-alice', 'community')).body.id as string;

    // Bob can use the published asset but never manage it.
    for (const body of [{ visibility: 'personal' }, { visibility: 'workspace' }, { filename: 'x.jpg' }, { collection_id: null }]) {
      expect((await patch('BOB', published, body)).status).toBe(403);
    }
    expect((await request(app).delete(`/api/assets/${published}`).set(auth('BOB'))).status).toBe(403);
    // Someone else's personal asset can't be published (or even seen).
    expect([403, 404]).toContain((await patch('BOB', personal, { visibility: 'community' })).status);
    // A student token never reaches the admin endpoints.
    expect((await request(app).patch(`/api/assets/admin/${personal}`).set(auth('BOB')).send({ visibility: 'community' })).status).toBe(401);
    expect((await request(app).get('/api/assets/admin/all').set(auth('BOB'))).status).toBe(401);
    // Unauthenticated: nothing, Community included.
    expect((await request(app).get('/api/assets?workspace_id=team')).status).toBe(401);
    expect((await request(app).get(`/api/assets/${published}`)).status).toBe(401);
    // An invalid visibility is refused.
    expect((await patch('ALICE', personal, { visibility: 'public' })).status).toBe(400);
    expect((await adminPatch(personal, { visibility: 'public' })).status).toBe(400);

    const rows = await query<{ id: string; visibility: string; filename: string }>('SELECT id, visibility, filename FROM assets ORDER BY filename, id');
    expect(Object.fromEntries(rows.map(r => [r.id, r.visibility]))).toEqual({ [personal]: 'personal', [published]: 'community' });
  });
});

describe('visibility migration', () => {
  it('renames pre-existing Community assets to Workspace exactly once, so nobody gains access', async () => {
    // Recreate the pre-migration state: the old two-value CHECK and a row
    // published under the old (workspace-scoped) meaning of Community.
    await query(`DELETE FROM schema_migrations WHERE key = $1`, [ASSET_VISIBILITY_MIGRATION]);
    await query(`ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_visibility_check`);
    await query(`ALTER TABLE assets ADD CONSTRAINT assets_visibility_check CHECK (visibility IN ('personal', 'community'))`);
    try {
      await query(`INSERT INTO assets(id, workspace_id, owner_roll, filename, storage_key, mime_type, size_bytes, created_at, visibility, kind)
        VALUES ('old-pub', 'p-alice', 'ALICE', 'old.png', 'assets/p-alice/old-pub.png', 'image/png', 68, now(), 'community', 'image'),
               ('old-own', 'p-alice', 'ALICE', 'own.png', 'assets/p-alice/old-own.png', 'image/png', 68, now(), 'personal', 'image')`);
    } finally {
      await migrateAssetVisibility(pool);
    }
    const rows = await query<{ id: string; visibility: string }>(`SELECT id, visibility FROM assets ORDER BY id`);
    expect(rows).toEqual([{ id: 'old-own', visibility: 'personal' }, { id: 'old-pub', visibility: 'workspace' }]);
    expect(ids(await list('BOB', 'team'))).toEqual([]);

    // Runs once: a row published after the migration stays Community.
    await query(`UPDATE assets SET visibility = 'community' WHERE id = 'old-pub'`);
    await migrateAssetVisibility(pool);
    expect((await query<{ visibility: string }>(`SELECT visibility FROM assets WHERE id = 'old-pub'`))[0].visibility).toBe('community');
    // The widened CHECK still refuses anything else.
    await expect(query(`UPDATE assets SET visibility = 'public' WHERE id = 'old-pub'`)).rejects.toThrow();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { pool, query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { initSchema } from '../src/db/schema';
import * as storageModule from '../src/storage';
import { settleDerivativeJobs } from '../src/storage/derivatives';

// ─────────────────────────────────────────────────────────────────────────
// Shared Creative Library V1 — personal/community visibility for templates
// and assets (lib/libraryVisibility.ts), through the real HTTP router
// against the local test DB.
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

describe('migration: existing content stays personal', () => {
  it('1 & 13: rows written before visibility existed default to personal, and re-running the migration publishes nothing', async () => {
    const board = await createBoardDirect(OWNER, ws);
    // Legacy-shaped inserts: no visibility column supplied, exactly like
    // every row that existed before this migration.
    await query(
      `INSERT INTO templates (id, workspace_id, source_board_id, name, canvas_data, owner_roll, created_at)
       VALUES ('tpl-legacy', $1, $2, 'Legacy', $3, $4, $5)`,
      [ws, board, CANVAS, OWNER, new Date().toISOString()]
    );
    await query(
      `INSERT INTO assets (id, workspace_id, owner_roll, kind, filename, storage_key, mime_type, size_bytes, created_at)
       VALUES ('asset-legacy', $1, $2, 'image', 'legacy.png', $3, 'image/png', 10, $4)`,
      [ws, OWNER, `assets/${ws}/asset-legacy.png`, new Date().toISOString()]
    );
    await initSchema(); // idempotent re-run
    expect((await query<{ visibility: string }>("SELECT visibility FROM templates WHERE id = 'tpl-legacy'"))[0].visibility).toBe('personal');
    expect((await query<{ visibility: string }>("SELECT visibility FROM assets WHERE id = 'asset-legacy'"))[0].visibility).toBe('personal');
    // …and are therefore invisible to other members.
    expect(ids((await listTemplates(MEMBER, ws)).body)).toEqual([]);
    expect(ids((await listAssets(MEMBER, ws)).body.assets)).toEqual([]);
  });

  it('the database rejects any visibility other than personal/community', async () => {
    await expect(query(
      `INSERT INTO assets (id, workspace_id, owner_roll, kind, filename, link_url, created_at, visibility)
       VALUES ('bad', $1, $2, 'link', 'x', 'https://x.test', $3, 'public')`,
      [ws, OWNER, new Date().toISOString()]
    )).rejects.toThrow();
  });
});

describe('templates', () => {
  it('new templates default to personal; 2: the owner lists them; 3: other members do not', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const created = await createTemplate(OWNER, board);
    expect(created.status).toBe(201);
    expect(created.body.visibility).toBe('personal');
    expect(ids((await listTemplates(OWNER, ws)).body)).toEqual([created.body.id]);
    expect(ids((await listTemplates(OWNER, ws, 'mine')).body)).toEqual([created.body.id]);
    expect(ids((await listTemplates(MEMBER, ws)).body)).toEqual([]);
    expect(ids((await listTemplates(MEMBER, ws, 'community')).body)).toEqual([]);
  });

  it('4: another member cannot fetch, use, edit or delete a personal template (404 — existence hidden)', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const t = (await createTemplate(OWNER, board)).body.id as string;
    expect((await request(app).get(`/api/templates/${t}`).set(auth(MEMBER))).status).toBe(404);
    expect((await request(app).post(`/api/templates/${t}/use`).set(auth(MEMBER)).send({})).status).toBe(404);
    expect((await request(app).patch(`/api/templates/${t}`).set(auth(MEMBER)).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).patch(`/api/templates/${t}`).set(auth(MEMBER)).send({ visibility: 'community' })).status).toBe(404);
    expect((await request(app).delete(`/api/templates/${t}`).set(auth(MEMBER))).status).toBe(404);
    expect(await query('SELECT 1 FROM boards WHERE owner_roll = $1', [MEMBER])).toHaveLength(0);
  });

  it('can be saved straight to community', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const created = await createTemplate(OWNER, board, 'community');
    expect(created.body.visibility).toBe('community');
    expect(ids((await listTemplates(MEMBER, ws, 'community')).body)).toEqual([created.body.id]);
  });

  it('5–7 & 10: owner publishes; it appears in the community list and is fetchable by members; owner unpublishes', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const t = (await createTemplate(OWNER, board)).body.id as string;

    const published = await request(app).patch(`/api/templates/${t}`).set(auth(OWNER)).send({ visibility: 'community' });
    expect(published.status).toBe(200);
    expect(published.body.visibility).toBe('community');

    const community = await listTemplates(MEMBER, ws, 'community');
    expect(ids(community.body)).toEqual([t]);
    // Creator attribution travels with the row; the snapshot never does.
    expect(community.body[0]).toMatchObject({ owner_roll: OWNER, owner_name: 'Venu' });
    expect(community.body[0].canvas_data).toBeUndefined();
    expect(ids((await listTemplates(MEMBER, ws)).body)).toEqual([t]);
    expect(ids((await listTemplates(MEMBER, ws, 'mine')).body)).toEqual([]);
    const fetched = await request(app).get(`/api/templates/${t}`).set(auth(MEMBER));
    expect(fetched.status).toBe(200);
    expect(fetched.body.owner_name).toBe('Venu');

    const unpublished = await request(app).patch(`/api/templates/${t}`).set(auth(OWNER)).send({ visibility: 'personal' });
    expect(unpublished.body.visibility).toBe('personal');
    expect(ids((await listTemplates(MEMBER, ws)).body)).toEqual([]);
    expect((await request(app).get(`/api/templates/${t}`).set(auth(MEMBER))).status).toBe(404);
  });

  it('8 & 9: a member cannot edit, archive, unpublish or delete a community template (403)', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const t = (await createTemplate(OWNER, board, 'community')).body.id as string;
    for (const body of [{ name: 'Hijacked' }, { description: 'x' }, { is_archived: true }, { visibility: 'personal' }]) {
      expect((await request(app).patch(`/api/templates/${t}`).set(auth(MEMBER)).send(body)).status).toBe(403);
    }
    expect((await request(app).delete(`/api/templates/${t}`).set(auth(MEMBER))).status).toBe(403);
    const row = (await query<{ name: string; visibility: string; is_archived: boolean }>('SELECT name, visibility, is_archived FROM templates WHERE id = $1', [t]))[0];
    expect(row).toEqual({ name: 'Poster', visibility: 'community', is_archived: false });
  });

  it('a workspace admin gets no owner powers over a member\'s template', async () => {
    await registerStudent('LIBADM1');
    await addMember(ws, 'LIBADM1', 'admin');
    const board = await createBoardDirect(MEMBER, ws);
    const t = (await createTemplate(MEMBER, board, 'community')).body.id as string;
    expect((await request(app).patch(`/api/templates/${t}`).set(auth('LIBADM1')).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).delete(`/api/templates/${t}`).set(auth('LIBADM1'))).status).toBe(403);
    expect((await request(app).delete(`/api/templates/${t}`).set(auth(OWNER))).status).toBe(403);
  });

  it('11 & 12: using a community template creates an independent, member-owned board; editing it never touches the source', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const t = (await createTemplate(OWNER, board, 'community')).body.id as string;
    const before = (await query<Record<string, unknown>>('SELECT * FROM templates WHERE id = $1', [t]))[0];

    const used = await request(app).post(`/api/templates/${t}/use`).set(auth(MEMBER)).send({ name: 'My copy' });
    expect(used.status).toBe(201);
    expect(used.body.owner_roll).toBe(MEMBER);
    expect(used.body.id).not.toBe(t);
    expect(used.body.id).not.toBe(board);
    expect(used.body.workspace_id).toBe(ws);

    // The member can edit their copy…
    const edited = await request(app).put(`/api/boards/${used.body.id}/canvas`).set(auth(MEMBER))
      .send({ canvas_data: JSON.stringify({ document: { store: {}, schema: {} }, session: {} }) });
    expect(edited.status).toBe(200);
    const rename = await request(app).put(`/api/boards/${used.body.id}`).set(auth(MEMBER)).send({ name: 'Renamed copy' });
    expect(rename.status).toBe(200);

    // …and the template (and its owner's source board) are untouched.
    const after = (await query<Record<string, unknown>>('SELECT * FROM templates WHERE id = $1', [t]))[0];
    expect(after).toEqual(before);
    expect((await query<{ canvas_data: string }>('SELECT canvas_data FROM boards WHERE id = $1', [board]))[0].canvas_data).toBe(CANVAS);
    expect((await request(app).get(`/api/templates/${t}`).set(auth(MEMBER))).body.owner_roll).toBe(OWNER);
  });

  it('rejects an invalid visibility or scope', async () => {
    const board = await createBoardDirect(OWNER, ws);
    expect((await createTemplate(OWNER, board, 'public' as 'community')).status).toBe(400);
    const t = (await createTemplate(OWNER, board)).body.id as string;
    expect((await request(app).patch(`/api/templates/${t}`).set(auth(OWNER)).send({ visibility: 'public' })).status).toBe(400);
    expect((await listTemplates(OWNER, ws, 'everyone')).status).toBe(400);
  });
});

describe('assets', () => {
  it('14 & 15: uploads default to personal — the owner sees it, another member does not (list, detail, patch)', async () => {
    const up = await uploadPng(OWNER, ws);
    expect(up.status).toBe(201);
    expect(up.body.visibility).toBe('personal');
    const id = up.body.id as string;
    expect(ids((await listAssets(OWNER, ws)).body.assets)).toEqual([id]);
    expect(ids((await listAssets(OWNER, ws, 'mine')).body.assets)).toEqual([id]);
    expect(ids((await listAssets(MEMBER, ws)).body.assets)).toEqual([]);
    expect((await request(app).get(`/api/assets/${id}`).set(auth(MEMBER))).status).toBe(404);
    expect((await request(app).patch(`/api/assets/${id}`).set(auth(MEMBER)).send({ collection_id: null })).status).toBe(404);
    expect((await request(app).delete(`/api/assets/${id}`).set(auth(MEMBER))).status).toBe(404);
  });

  it('upload and link creation accept community; bad visibility is rejected', async () => {
    const up = await uploadPng(OWNER, ws, 'community');
    expect(up.body.visibility).toBe('community');
    const link = await request(app).post('/api/assets/links').set(auth(OWNER))
      .send({ workspace_id: ws, name: 'Mockups', url: 'https://example.com/m', visibility: 'community' });
    expect(link.status).toBe(201);
    expect(link.body.visibility).toBe('community');
    expect((await uploadPng(OWNER, ws, 'public')).status).toBe(400);
    expect((await request(app).post('/api/assets/links').set(auth(OWNER))
      .send({ workspace_id: ws, name: 'x', url: 'https://example.com', visibility: 'public' })).status).toBe(400);
    expect((await listAssets(MEMBER, ws, 'community')).body.assets).toHaveLength(2);
  });

  it('16–18 & 21–23: owner publishes/unpublishes by metadata only — same storage key and URL, no storage upload or delete', async () => {
    const up = await uploadPng(OWNER, ws);
    const id = up.body.id as string;
    const keyBefore = (await query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [id]))[0].storage_key;
    // The upload's own background thumbnail job must finish first — it is
    // part of uploading, not of publishing.
    await settleDerivativeJobs();
    const storage = storageModule.getStorage();
    const uploadSpy = vi.spyOn(storage, 'upload');
    const deleteSpy = vi.spyOn(storage, 'delete');

    const published = await request(app).patch(`/api/assets/${id}`).set(auth(OWNER)).send({ visibility: 'community' });
    expect(published.status).toBe(200);
    expect(published.body.visibility).toBe('community');
    expect(published.body.url).toBe(up.body.url);
    expect(published.body.storage_key).toBeUndefined();

    // Visible to members, attributed, and usable: the same URL a board inserts.
    const seen = await listAssets(MEMBER, ws, 'community');
    expect(ids(seen.body.assets)).toEqual([id]);
    expect(seen.body.assets[0]).toMatchObject({ owner_roll: OWNER, owner_name: 'Venu', url: up.body.url });
    const detail = await request(app).get(`/api/assets/${id}`).set(auth(MEMBER));
    expect(detail.status).toBe(200);
    expect(detail.body.url).toBe(up.body.url);

    const unpublished = await request(app).patch(`/api/assets/${id}`).set(auth(OWNER)).send({ visibility: 'personal' });
    expect(unpublished.body.visibility).toBe('personal');
    expect(ids((await listAssets(MEMBER, ws)).body.assets)).toEqual([]);

    const after = await query<{ storage_key: string; owner_roll: string }>('SELECT storage_key, owner_roll FROM assets WHERE id = $1', [id]);
    expect(after).toEqual([{ storage_key: keyBefore, owner_roll: OWNER }]);
    expect(await query('SELECT 1 FROM assets')).toHaveLength(1);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('18: a member places a community asset on their own board by reference — ownership never moves', async () => {
    const id = (await uploadPng(OWNER, ws, 'community')).body.id as string;
    const url = (await request(app).get(`/api/assets/${id}`).set(auth(MEMBER))).body.url as string;
    const board = await createBoardDirect(MEMBER, ws);
    const canvas = JSON.stringify({ document: { store: { 'asset:x': { id: 'asset:x', type: 'image', props: { src: url }, meta: { sourceAssetId: id } } }, schema: {} }, session: {} });
    expect((await request(app).put(`/api/boards/${board}/canvas`).set(auth(MEMBER)).send({ canvas_data: canvas })).status).toBe(200);
    expect(await query('SELECT id FROM assets')).toEqual([{ id }]);
    expect((await query<{ owner_roll: string }>('SELECT owner_roll FROM assets WHERE id = $1', [id]))[0].owner_roll).toBe(OWNER);
  });

  it('19 & 20: a member cannot rename, unpublish or delete a community asset; a workspace admin cannot either', async () => {
    await registerStudent('LIBADM2');
    await addMember(ws, 'LIBADM2', 'admin');
    const id = (await uploadPng(OWNER, ws, 'community')).body.id as string;
    for (const roll of [MEMBER, 'LIBADM2']) {
      expect((await request(app).patch(`/api/assets/${id}`).set(auth(roll)).send({ filename: 'x.png' })).status).toBe(403);
      expect((await request(app).patch(`/api/assets/${id}`).set(auth(roll)).send({ visibility: 'personal' })).status).toBe(403);
      expect((await request(app).delete(`/api/assets/${id}`).set(auth(roll))).status).toBe(403);
    }
    expect((await query<{ filename: string; visibility: string }>('SELECT filename, visibility FROM assets WHERE id = $1', [id]))[0])
      .toEqual({ filename: 'mark.png', visibility: 'community' });
  });

  it('collections still work: members group community assets, and counts never reveal others\' personal assets', async () => {
    const pack = (await request(app).post('/api/asset-collections').set(auth(OWNER)).send({ workspace_id: ws, name: 'Brand' })).body.id as string;
    const shared = (await uploadPng(OWNER, ws, 'community')).body.id as string;
    const secret = (await uploadPng(OWNER, ws)).body.id as string;
    expect((await request(app).patch(`/api/assets/${shared}`).set(auth(MEMBER)).send({ collection_id: pack })).status).toBe(200);
    expect((await request(app).patch(`/api/assets/${secret}`).set(auth(OWNER)).send({ collection_id: pack })).status).toBe(200);

    const countFor = async (roll: string) =>
      ((await request(app).get(`/api/asset-collections?workspace_id=${ws}`).set(auth(roll))).body.collections as Array<{ id: string; asset_count: number }>)
        .find(c => c.id === pack)!.asset_count;
    expect(await countFor(OWNER)).toBe(2);
    expect(await countFor(MEMBER)).toBe(1);
    const inPack = await request(app).get(`/api/assets?workspace_id=${ws}&collection_id=${pack}`).set(auth(MEMBER));
    expect(ids(inPack.body.assets)).toEqual([shared]);
  });

  it('a cursor naming another member\'s personal asset cannot probe it', async () => {
    const secret = (await uploadPng(OWNER, ws)).body.id as string;
    await uploadPng(MEMBER, ws);
    const res = await request(app).get(`/api/assets?workspace_id=${ws}&cursor=${secret}`).set(auth(MEMBER));
    expect(res.status).toBe(200);
    expect(res.body.assets).toEqual([]);
  });

  it('rejects an invalid scope or visibility update', async () => {
    const id = (await uploadPng(OWNER, ws)).body.id as string;
    expect((await listAssets(OWNER, ws, 'public')).status).toBe(400);
    expect((await request(app).patch(`/api/assets/${id}`).set(auth(OWNER)).send({ visibility: 'public' })).status).toBe(400);
  });
});

describe('workspace boundaries', () => {
  it('24 & 25: a non-member cannot list, fetch, use, edit or delete community content, and scopes never cross workspaces', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const t = (await createTemplate(OWNER, board, 'community')).body.id as string;
    const a = (await uploadPng(OWNER, ws, 'community')).body.id as string;

    for (const scope of [undefined, 'all', 'mine', 'community']) {
      expect((await listTemplates(OUTSIDER, ws, scope)).status).toBe(403);
      expect((await listAssets(OUTSIDER, ws, scope)).status).toBe(403);
      // The outsider's own workspace never shows another workspace's community items.
      expect((await listTemplates(OUTSIDER, outsiderWs, scope)).body).toEqual([]);
      expect((await listAssets(OUTSIDER, outsiderWs, scope)).body.assets).toEqual([]);
    }
    expect((await request(app).get(`/api/templates/${t}`).set(auth(OUTSIDER))).status).toBe(403);
    expect((await request(app).post(`/api/templates/${t}/use`).set(auth(OUTSIDER)).send({})).status).toBe(403);
    expect((await request(app).patch(`/api/templates/${t}`).set(auth(OUTSIDER)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).delete(`/api/templates/${t}`).set(auth(OUTSIDER))).status).toBe(403);
    expect((await request(app).get(`/api/assets/${a}`).set(auth(OUTSIDER))).status).toBe(403);
    expect((await request(app).patch(`/api/assets/${a}`).set(auth(OUTSIDER)).send({ visibility: 'personal' })).status).toBe(403);
    expect((await request(app).delete(`/api/assets/${a}`).set(auth(OUTSIDER))).status).toBe(403);
    expect((await query('SELECT 1 FROM templates WHERE id = $1', [t]))).toHaveLength(1);
    expect((await query('SELECT 1 FROM assets WHERE id = $1', [a]))).toHaveLength(1);
  });

  it('26: personal content never leaks to other users or workspaces, whatever the scope', async () => {
    const board = await createBoardDirect(OWNER, ws);
    await createTemplate(OWNER, board);
    await uploadPng(OWNER, ws);
    for (const scope of [undefined, 'all', 'mine', 'community']) {
      expect((await listTemplates(MEMBER, ws, scope)).body).toEqual([]);
      expect((await listAssets(MEMBER, ws, scope)).body.assets).toEqual([]);
    }
  });

  it('unauthenticated requests and unknown ids are rejected', async () => {
    expect((await request(app).get(`/api/templates?workspace_id=${ws}`)).status).toBe(401);
    expect((await request(app).get(`/api/assets?workspace_id=${ws}`)).status).toBe(401);
    expect((await request(app).patch('/api/templates/nope').send({ visibility: 'community' })).status).toBe(401);
    expect((await request(app).patch('/api/templates/nope').set(auth(OWNER)).send({ visibility: 'community' })).status).toBe(404);
    expect((await request(app).patch('/api/assets/nope').set(auth(OWNER)).send({ visibility: 'community' })).status).toBe(404);
    expect((await request(app).post('/api/templates/nope/use').set(auth(OWNER)).send({})).status).toBe(404);
    expect((await request(app).delete('/api/assets/nope').set(auth(OWNER))).status).toBe(404);
    expect((await request(app).get('/api/templates/nope').set(auth(OWNER))).status).toBe(404);
  });

  it('list queries do not grow with the number of rows (no N+1)', async () => {
    const board = await createBoardDirect(OWNER, ws);
    const queriesFor = async (fn: () => Promise<unknown>) => {
      await settleDerivativeJobs(); // uploads' background thumbnail jobs also query
      const spy = vi.spyOn(pool, 'query');
      await fn();
      const n = spy.mock.calls.length;
      spy.mockRestore();
      return n;
    };
    await createTemplate(OWNER, board, 'community', 'T0');
    await uploadPng(OWNER, ws, 'community');
    const oneTemplate = await queriesFor(() => listTemplates(MEMBER, ws));
    const oneAsset = await queriesFor(() => listAssets(MEMBER, ws));
    for (let i = 1; i < 6; i++) {
      await createTemplate(OWNER, board, 'community', `T${i}`);
      await uploadPng(OWNER, ws, 'community');
    }
    expect((await listTemplates(MEMBER, ws)).body).toHaveLength(6);
    expect(await queriesFor(() => listTemplates(MEMBER, ws))).toBe(oneTemplate);
    expect(await queriesFor(() => listAssets(MEMBER, ws))).toBe(oneAsset);
  });
});

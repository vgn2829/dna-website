import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import { fileExtension, normalizeLinkUrl } from '../src/routes/assets';

// ─────────────────────────────────────────────────────────────────────────
// Workspace Asset Library (general files, link assets, collections, list
// filters). Same real-HTTP + local-test-Postgres + LocalStorageProvider
// style as assets.test.ts. Kept in its own file because uploadAssetLimiter
// (20/60s) is module-level: vitest isolates modules per file, so this file
// gets a fresh limiter instead of sharing assets.test.ts's budget. Tests
// that only need rows to EXIST insert them via SQL (insertAssetDirect),
// same rationale as projects.test.ts's createBoardDirect; tests about the
// upload route itself go through the real route.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4)
     ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

const tokenFor = (roll: string) => signStudentToken(roll);

async function createWorkspace(roll: string, name: string): Promise<string> {
  const res = await request(app)
    .post('/api/workspaces')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .send({ name });
  return res.body.id as string;
}

function uploadPng(roll: string, workspaceId: string, filename = 'test.png') {
  return request(app)
    .post('/api/assets')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .field('workspace_id', workspaceId)
    .attach('file', PNG_1PX, { filename, contentType: 'image/png' });
}

let clock = Date.parse('2026-01-01T00:00:00Z');
async function insertAssetDirect(roll: string, workspaceId: string, filename: string, kind: 'image' | 'file' = 'image'): Promise<string> {
  const id = uuidv4();
  const ext = filename.slice(filename.lastIndexOf('.') + 1);
  clock += 1000;
  await query(
    `INSERT INTO assets (id, workspace_id, owner_roll, owner_name, kind, filename, storage_key, mime_type, size_bytes, width, height, created_at)
     VALUES ($1, $2, $3, null, $4, $5, $6, $7, 10, null, null, $8)`,
    [id, workspaceId, roll, kind, filename, `assets/${workspaceId}/${id}.${ext}`,
     kind === 'image' ? 'image/png' : 'application/octet-stream', new Date(clock).toISOString()]
  );
  return id;
}

beforeEach(async () => {
  await query('TRUNCATE "assets", "workspace_members", "workspaces", "boards" CASCADE');
});

// ─────────────────────────────────────────────────────────────────────────
// Workspace Asset Library — general files (kind=file) + list filters.
// ─────────────────────────────────────────────────────────────────────────

function uploadFile(roll: string, workspaceId: string, buf: Buffer, filename: string, contentType: string, kind?: string) {
  const req = request(app)
    .post('/api/assets')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .field('workspace_id', workspaceId);
  if (kind) req.field('kind', kind);
  return req.attach('file', buf, { filename, contentType });
}

describe('fileExtension', () => {
  it('takes a safe lowercase extension from the last dot-segment', () => {
    expect(fileExtension('Brand Kit.PSD')).toBe('psd');
    expect(fileExtension('pack.tar.gz')).toBe('gz');
    expect(fileExtension('mockup.fig')).toBe('fig');
  });
  it('rejects missing or unsafe extensions', () => {
    expect(fileExtension('README')).toBeNull();
    expect(fileExtension('.env')).toBeNull();
    expect(fileExtension('trailing.')).toBeNull();
    expect(fileExtension('x.ps d')).toBeNull();
    expect(fileExtension('x.a/b')).toBeNull();
    expect(fileExtension('x.' + 'a'.repeat(13))).toBeNull();
  });
});

describe('POST /api/assets — general files (kind=file)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('existing image uploads are unchanged: kind image, inline URL', async () => {
    await registerStudent('LF1');
    const workspaceId = await createWorkspace('LF1', 'Design');
    const res = await uploadPng('LF1', workspaceId, 'logo.png');
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('image');
    expect(res.body.extension).toBe('png');
    expect(res.body.mime_type).toBe('image/png');
    expect(res.body.width).toBe(1);
    expect(res.body).not.toHaveProperty('storage_key');
  });

  it('an allowlisted image sent with kind=file is still classified as an image', async () => {
    await registerStudent('LF2');
    const workspaceId = await createWorkspace('LF2', 'Design');
    const res = await uploadFile('LF2', workspaceId, PNG_1PX, 'still-image.png', 'image/png', 'file');
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('image');
  });

  it('uploads a design file as a download-only octet-stream object', async () => {
    await registerStudent('LF3');
    const workspaceId = await createWorkspace('LF3', 'Design');
    const provider = storageModule.getStorage();
    const uploadSpy = vi.spyOn(provider, 'upload');
    const urlSpy = vi.spyOn(provider, 'getPublicUrl');

    const res = await uploadFile('LF3', workspaceId, Buffer.from('8BPS fake psd'), 'Brand Kit.psd', 'image/vnd.adobe.photoshop', 'file');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'file', extension: 'psd', filename: 'Brand Kit.psd', mime_type: 'image/vnd.adobe.photoshop', width: null, height: null });
    // Stored Content-Type is never the client's MIME.
    expect(uploadSpy.mock.calls[0][2]).toBe('application/octet-stream');
    expect(uploadSpy.mock.calls[0][0]).toMatch(new RegExp(`^assets/${workspaceId}/[0-9a-f-]+\\.psd$`));
    // URL is built as a download under the display filename.
    expect(urlSpy).toHaveBeenCalledWith(expect.stringMatching(/\.psd$/), { download: 'Brand Kit.psd' });
  });

  it('an uploaded HTML file can never render: stored as octet-stream and served as an attachment', async () => {
    await registerStudent('LF4');
    const workspaceId = await createWorkspace('LF4', 'Design');
    const uploadSpy = vi.spyOn(storageModule.getStorage(), 'upload');
    const res = await uploadFile('LF4', workspaceId, Buffer.from('<script>alert(1)</script>'), 'page.html', 'text/html', 'file');
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('file');
    expect(uploadSpy.mock.calls[0][2]).toBe('application/octet-stream');

    const path = new URL(res.body.url).pathname;
    const served = await request(app).get(path);
    expect(served.status).toBe(200);
    expect(served.headers['content-disposition']).toBe('attachment');
  });

  it('still rejects a non-image upload that did not opt in with kind=file', async () => {
    await registerStudent('LF5');
    const workspaceId = await createWorkspace('LF5', 'Design');
    const res = await uploadFile('LF5', workspaceId, Buffer.from('%PDF-1.4'), 'doc.pdf', 'application/pdf');
    expect(res.status).toBe(400);
  });

  it('rejects a general file without a usable extension', async () => {
    await registerStudent('LF6');
    const workspaceId = await createWorkspace('LF6', 'Design');
    const res = await uploadFile('LF6', workspaceId, Buffer.from('data'), 'README', 'application/octet-stream', 'file');
    expect(res.status).toBe(400);
  });

  it('allows general files up to 25MB but not beyond; images stay capped at 15MB', async () => {
    await registerStudent('LF7');
    const workspaceId = await createWorkspace('LF7', 'Design');
    const ok = await uploadFile('LF7', workspaceId, Buffer.alloc(20 * 1024 * 1024, 1), 'big.zip', 'application/zip', 'file');
    expect(ok.status).toBe(201);
    const tooBig = await uploadFile('LF7', workspaceId, Buffer.alloc(26 * 1024 * 1024, 1), 'huge.zip', 'application/zip', 'file');
    expect(tooBig.status).toBe(400);
    const bigImage = await uploadFile('LF7', workspaceId, Buffer.alloc(16 * 1024 * 1024, 1), 'huge.png', 'image/png', 'file');
    expect(bigImage.status).toBe(400);
  });

  it('rejects a general file upload into a workspace the caller is not a member of', async () => {
    await registerStudent('LF8');
    await registerStudent('LF9');
    const workspaceId = await createWorkspace('LF8', 'Private');
    const res = await uploadFile('LF9', workspaceId, Buffer.from('x'), 'a.pdf', 'application/pdf', 'file');
    expect(res.status).toBe(403);
    const rows = await query('SELECT id FROM assets WHERE workspace_id = $1', [workspaceId]);
    expect(rows).toHaveLength(0);
  });

  it('rows inserted without a kind (pre-migration shape) read back as images', async () => {
    await registerStudent('LF10');
    const workspaceId = await createWorkspace('LF10', 'Design');
    await query(
      `INSERT INTO assets (id, workspace_id, owner_roll, owner_name, filename, storage_key, mime_type, size_bytes, width, height, created_at)
       VALUES ('legacy-1', $1, 'LF10', null, 'old.png', $2, 'image/png', 10, 1, 1, $3)`,
      [workspaceId, `assets/${workspaceId}/legacy-1.png`, new Date().toISOString()]
    );
    const res = await request(app).get(`/api/assets?workspace_id=${workspaceId}`).set('Authorization', `Bearer ${tokenFor('LF10')}`);
    expect(res.body.assets[0]).toMatchObject({ id: 'legacy-1', kind: 'image', extension: 'png' });
  });
});

describe('GET /api/assets — kind/q filters and pagination', () => {
  async function seedLibrary(roll: string) {
    await registerStudent(roll);
    const workspaceId = await createWorkspace(roll, 'Library');
    await insertAssetDirect(roll, workspaceId, 'Logo Primary.png');
    await insertAssetDirect(roll, workspaceId, 'Logo Source.ai', 'file');
    await insertAssetDirect(roll, workspaceId, 'Brand Guide.pdf', 'file');
    await insertAssetDirect(roll, workspaceId, '50%_off banner.png');
    return workspaceId;
  }
  const list = (roll: string, qs: string) =>
    request(app).get(`/api/assets?${qs}`).set('Authorization', `Bearer ${tokenFor(roll)}`);

  it('filters by kind', async () => {
    const ws = await seedLibrary('LQ1');
    const files = await list('LQ1', `workspace_id=${ws}&kind=file`);
    expect(files.body.assets.map((a: { filename: string }) => a.filename).sort()).toEqual(['Brand Guide.pdf', 'Logo Source.ai']);
    const images = await list('LQ1', `workspace_id=${ws}&kind=image`);
    expect(images.body.assets).toHaveLength(2);
  });

  it('searches names case-insensitively and treats LIKE wildcards literally', async () => {
    const ws = await seedLibrary('LQ2');
    const logo = await list('LQ2', `workspace_id=${ws}&q=LOGO`);
    expect(logo.body.assets).toHaveLength(2);
    const combined = await list('LQ2', `workspace_id=${ws}&q=logo&kind=image`);
    expect(combined.body.assets.map((a: { filename: string }) => a.filename)).toEqual(['Logo Primary.png']);
    const pct = await list('LQ2', `workspace_id=${ws}&q=${encodeURIComponent('50%_')}`);
    expect(pct.body.assets.map((a: { filename: string }) => a.filename)).toEqual(['50%_off banner.png']);
    const wildcardOnly = await list('LQ2', `workspace_id=${ws}&q=${encodeURIComponent('%')}`);
    expect(wildcardOnly.body.assets).toHaveLength(1);
  });

  it('rejects an unknown kind filter', async () => {
    const ws = await seedLibrary('LQ3');
    const res = await list('LQ3', `workspace_id=${ws}&kind=folder`);
    expect(res.status).toBe(400);
  });

  it('paginates filtered results with the cursor', async () => {
    const ws = await seedLibrary('LQ4');
    const page1 = await list('LQ4', `workspace_id=${ws}&limit=2`);
    expect(page1.body.assets).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await list('LQ4', `workspace_id=${ws}&limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.assets).toHaveLength(2);
    const ids = [...page1.body.assets, ...page2.body.assets].map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('never returns another workspace’s assets, whatever the filters or cursor', async () => {
    const wsA = await seedLibrary('LQ5');
    const wsB = await seedLibrary('LQ6');
    const denied = await list('LQ6', `workspace_id=${wsA}&q=logo`);
    expect(denied.status).toBe(403);
    // A cursor id taken from workspace A cannot pull rows out of A when
    // listing B — the cursor is resolved within the listed workspace only.
    const a = await list('LQ5', `workspace_id=${wsA}&limit=1`);
    const cross = await list('LQ6', `workspace_id=${wsB}&cursor=${a.body.assets[0].id}`);
    expect(cross.status).toBe(200);
    expect(cross.body.assets).toHaveLength(0);
    const own = await list('LQ6', `workspace_id=${wsB}`);
    expect(own.body.assets.every((x: { workspace_id: string }) => x.workspace_id === wsB)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Links + collections.
// ─────────────────────────────────────────────────────────────────────────

async function addMember(workspaceId: string, roll: string, role: 'member' | 'admin' = 'member') {
  await registerStudent(roll);
  await query(
    `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, $3, $4, $5)`,
    [workspaceId, roll, role, `Student ${roll}`, new Date().toISOString()]
  );
}

const auth = (roll: string) => ({ Authorization: `Bearer ${tokenFor(roll)}` });

function createLink(roll: string, body: Record<string, unknown>) {
  return request(app).post('/api/assets/links').set(auth(roll)).send(body);
}
function createCollection(roll: string, workspaceId: string, name: string, description?: string) {
  return request(app).post('/api/asset-collections').set(auth(roll)).send({ workspace_id: workspaceId, name, description });
}
function patchAsset(roll: string, id: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/assets/${id}`).set(auth(roll)).send(body);
}

describe('normalizeLinkUrl', () => {
  it('accepts absolute http(s) URLs and canonicalises them', () => {
    expect(normalizeLinkUrl(' https://elements.envato.com/t-shirt-mockup ')).toBe('https://elements.envato.com/t-shirt-mockup');
    expect(normalizeLinkUrl('http://Figma.com/community/file/1')).toBe('http://figma.com/community/file/1');
  });
  it('rejects non-http schemes, credentials, relative and oversized URLs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://x.com/a', 'file:///etc/passwd',
      'https://user:pass@evil.com', '/relative/path', 'figma.com/file', '', 'https://' + 'a'.repeat(2050) + '.com', 42]) {
      expect(normalizeLinkUrl(bad)).toBeNull();
    }
  });
});

describe('POST /api/assets/links', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('stores an external link as a first-class asset without fetching it', async () => {
    await registerStudent('LK1');
    const ws = await createWorkspace('LK1', 'Design');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await createLink('LK1', { workspace_id: ws, name: 'Envato T-Shirt Mockup', url: 'https://elements.envato.com/t-shirt-mockup-ABC' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'link', filename: 'Envato T-Shirt Mockup', link_url: 'https://elements.envato.com/t-shirt-mockup-ABC',
      url: null, extension: null, collection_id: null, workspace_id: ws,
    });
    expect(res.body).not.toHaveProperty('storage_key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects unsafe or malformed URLs', async () => {
    await registerStudent('LK2');
    const ws = await createWorkspace('LK2', 'Design');
    for (const url of ['javascript:alert(1)', 'https://u:p@evil.com', 'not a url']) {
      const res = await createLink('LK2', { workspace_id: ws, name: 'x', url });
      expect(res.status).toBe(400);
    }
    const noName = await createLink('LK2', { workspace_id: ws, name: '   ', url: 'https://figma.com' });
    expect(noName.status).toBe(400);
  });

  it('rejects adding a link to a workspace the caller is not a member of', async () => {
    await registerStudent('LK3');
    await registerStudent('LK4');
    const ws = await createWorkspace('LK3', 'Private');
    const res = await createLink('LK4', { workspace_id: ws, name: 'x', url: 'https://figma.com' });
    expect(res.status).toBe(403);
    expect(await query('SELECT id FROM assets WHERE workspace_id = $1', [ws])).toHaveLength(0);
  });

  it('is listed under kind=link and deletes cleanly without touching storage', async () => {
    await registerStudent('LK5');
    const ws = await createWorkspace('LK5', 'Design');
    await insertAssetDirect('LK5', ws, 'photo.png');
    const link = await createLink('LK5', { workspace_id: ws, name: 'Figma Mobile UI Kit', url: 'https://www.figma.com/community/file/123' });
    const links = await request(app).get(`/api/assets?workspace_id=${ws}&kind=link`).set(auth('LK5'));
    expect(links.body.assets.map((a: { id: string }) => a.id)).toEqual([link.body.id]);

    const deleteSpy = vi.spyOn(storageModule.getStorage(), 'delete');
    const del = await request(app).delete(`/api/assets/${link.body.id}`).set(auth('LK5'));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ success: true });
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('asset collections', () => {
  it('creates collections per workspace with case-insensitive unique names', async () => {
    await registerStudent('CO1');
    const ws = await createWorkspace('CO1', 'Design');
    const other = await createWorkspace('CO1', 'Other');
    const res = await createCollection('CO1', ws, 'Branding Pack', 'Logos, mockups, type');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Branding Pack', description: 'Logos, mockups, type', workspace_id: ws, created_by_roll: 'CO1', asset_count: 0 });
    expect((await createCollection('CO1', ws, 'branding pack')).status).toBe(409);
    expect((await createCollection('CO1', other, 'Branding Pack')).status).toBe(201);
    expect((await createCollection('CO1', ws, '   ')).status).toBe(400);
  });

  it('lists only the requested workspace’s collections, with asset counts, to members only', async () => {
    await registerStudent('CO2');
    await registerStudent('CO3');
    const ws = await createWorkspace('CO2', 'Design');
    const foreign = await createWorkspace('CO3', 'Foreign');
    const branding = await createCollection('CO2', ws, 'Branding');
    await createCollection('CO2', ws, 'Assets A-Z');
    await createCollection('CO3', foreign, 'Secret Pack');
    const a1 = await insertAssetDirect('CO2', ws, 'logo.png');
    await patchAsset('CO2', a1, { collection_id: branding.body.id });

    const list = await request(app).get(`/api/asset-collections?workspace_id=${ws}`).set(auth('CO2'));
    expect(list.status).toBe(200);
    expect(list.body.collections.map((c: { name: string; asset_count: number }) => [c.name, c.asset_count])).toEqual([['Assets A-Z', 0], ['Branding', 1]]);

    const denied = await request(app).get(`/api/asset-collections?workspace_id=${foreign}`).set(auth('CO2'));
    expect(denied.status).toBe(403);
    const noAdd = await createCollection('CO2', foreign, 'Injected');
    expect(noAdd.status).toBe(403);
  });

  it('assigns assets to a collection on upload, on link creation, and via PATCH', async () => {
    await registerStudent('CO4');
    const ws = await createWorkspace('CO4', 'Design');
    const pack = (await createCollection('CO4', ws, 'Social Media')).body.id as string;

    const uploaded = await request(app).post('/api/assets').set(auth('CO4'))
      .field('workspace_id', ws).field('collection_id', pack)
      .attach('file', PNG_1PX, { filename: 'post.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.collection_id).toBe(pack);

    const link = await createLink('CO4', { workspace_id: ws, name: 'Pinterest board', url: 'https://pinterest.com/x', collection_id: pack });
    expect(link.body.collection_id).toBe(pack);

    const loose = await insertAssetDirect('CO4', ws, 'template.psd', 'file');
    const moved = await patchAsset('CO4', loose, { collection_id: pack });
    expect(moved.status).toBe(200);
    expect(moved.body.collection_id).toBe(pack);

    const inPack = await request(app).get(`/api/assets?workspace_id=${ws}&collection_id=${pack}`).set(auth('CO4'));
    expect(inPack.body.assets).toHaveLength(3);
    const ungrouped = await patchAsset('CO4', loose, { collection_id: null });
    expect(ungrouped.body.collection_id).toBeNull();
    const none = await request(app).get(`/api/assets?workspace_id=${ws}&collection_id=none`).set(auth('CO4'));
    expect(none.body.assets.map((a: { id: string }) => a.id)).toEqual([loose]);
  });

  it('never lets an asset join another workspace’s collection', async () => {
    await registerStudent('CO5');
    const ws = await createWorkspace('CO5', 'Mine');
    const other = await createWorkspace('CO5', 'Also mine');
    const foreignPack = (await createCollection('CO5', other, 'Other pack')).body.id as string;
    const asset = await insertAssetDirect('CO5', ws, 'a.png');

    expect((await patchAsset('CO5', asset, { collection_id: foreignPack })).status).toBe(400);
    expect((await createLink('CO5', { workspace_id: ws, name: 'x', url: 'https://x.com', collection_id: foreignPack })).status).toBe(400);
    const up = await request(app).post('/api/assets').set(auth('CO5'))
      .field('workspace_id', ws).field('collection_id', foreignPack)
      .attach('file', PNG_1PX, { filename: 'x.png', contentType: 'image/png' });
    expect(up.status).toBe(400);
    const rows = await query<{ collection_id: string | null }>('SELECT collection_id FROM assets WHERE workspace_id = $1', [ws]);
    expect(rows.every(r => r.collection_id === null)).toBe(true);
    // Filtering one workspace by another workspace's collection id matches nothing.
    await query('UPDATE assets SET collection_id = NULL');
    const leak = await request(app).get(`/api/assets?workspace_id=${ws}&collection_id=${foreignPack}`).set(auth('CO5'));
    expect(leak.body.assets).toHaveLength(0);
  });

  it('PATCH: any member can move an asset; only the uploader or an admin can rename; outsiders get 403', async () => {
    await registerStudent('CO6');
    const ws = await createWorkspace('CO6', 'Team');
    await addMember(ws, 'CO7');
    await addMember(ws, 'CO8', 'admin');
    await registerStudent('CO9');
    const pack = (await createCollection('CO6', ws, 'Refs')).body.id as string;
    const asset = await insertAssetDirect('CO6', ws, 'hero.png');

    expect((await patchAsset('CO7', asset, { collection_id: pack })).status).toBe(200);
    expect((await patchAsset('CO7', asset, { filename: 'renamed.png' })).status).toBe(403);
    expect((await patchAsset('CO8', asset, { filename: 'by-admin.png' })).body.filename).toBe('by-admin.png');
    expect((await patchAsset('CO6', asset, { filename: 'by-owner.png' })).body.filename).toBe('by-owner.png');
    expect((await patchAsset('CO9', asset, { collection_id: null })).status).toBe(403);
    expect((await patchAsset('CO6', asset, {})).status).toBe(400);
    expect((await patchAsset('CO6', 'missing-id', { collection_id: null })).status).toBe(404);
  });

  it('rename/delete of a collection is limited to its creator or a workspace admin; deletion ungroups assets', async () => {
    await registerStudent('CO10');
    const ws = await createWorkspace('CO10', 'Team');
    await addMember(ws, 'CO11');
    await addMember(ws, 'CO12', 'admin');
    await registerStudent('CO13');
    const pack = (await createCollection('CO10', ws, 'Branding')).body.id as string;
    const mine = (await createCollection('CO11', ws, 'Member pack')).body.id as string;
    const asset = await insertAssetDirect('CO10', ws, 'logo.png');
    await patchAsset('CO10', asset, { collection_id: pack });

    expect((await request(app).patch(`/api/asset-collections/${pack}`).set(auth('CO11')).send({ name: 'Nope' })).status).toBe(403);
    expect((await request(app).patch(`/api/asset-collections/${mine}`).set(auth('CO11')).send({ name: 'Member pack v2' })).body.name).toBe('Member pack v2');
    const renamed = await request(app).patch(`/api/asset-collections/${pack}`).set(auth('CO12')).send({ name: 'Branding 2026', description: 'Q1' });
    expect(renamed.body).toMatchObject({ name: 'Branding 2026', description: 'Q1', asset_count: 1 });
    expect((await request(app).patch(`/api/asset-collections/${pack}`).set(auth('CO10')).send({ name: 'member pack v2' })).status).toBe(409);

    // Outsiders can't even confirm the collection exists.
    expect((await request(app).delete(`/api/asset-collections/${pack}`).set(auth('CO13'))).status).toBe(404);
    expect((await request(app).delete(`/api/asset-collections/${pack}`).set(auth('CO11'))).status).toBe(403);

    const del = await request(app).delete(`/api/asset-collections/${pack}`).set(auth('CO10'));
    expect(del.body).toEqual({ success: true, ungroupedAssets: 1 });
    const still = await request(app).get(`/api/assets/${asset}`).set(auth('CO10'));
    expect(still.status).toBe(200);
    expect(still.body.collection_id).toBeNull();
  });
});

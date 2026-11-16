import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localRequest } from './localServer';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import {
  normalizeTags, urlDedupeKey, validateImageUrl, validateReferenceUrl, likePattern,
} from '../src/lib/inspiration';

// Inspiration Library (Milestone C): validation helpers + the real routes
// against the local test Postgres. Rows that only need to EXIST are inserted
// by SQL, as in asset-library.test.ts.

const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const get = (roll: string, path: string) => request(app).get(`/api/inspiration${path}`).set(auth(roll));
const post = (roll: string, path: string, body: unknown) => request(app).post(`/api/inspiration${path}`).set(auth(roll)).send(body as object);
const patch = (roll: string, path: string, body: unknown) => request(app).patch(`/api/inspiration${path}`).set(auth(roll)).send(body as object);
const del = (roll: string, path: string) => request(app).delete(`/api/inspiration${path}`).set(auth(roll));

async function registerStudent(roll: string) {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`],
  );
}
async function workspaceFor(roll: string): Promise<string> {
  const res = await request(app).post('/api/workspaces').set(auth(roll)).send({ name: `${roll} ws` });
  return res.body.id as string;
}
async function insertAsset(roll: string, ws: string, filename: string, visibility: 'personal' | 'workspace' | 'community' = 'personal'): Promise<string> {
  const id = uuidv4();
  await query(
    `INSERT INTO assets (id, workspace_id, owner_roll, kind, filename, storage_key, mime_type, size_bytes, created_at, visibility)
     VALUES ($1,$2,$3,'image',$4,$5,'image/png',10,$6,$7)`,
    [id, ws, roll, filename, `assets/${ws}/${id}.png`, new Date().toISOString(), visibility],
  );
  return id;
}

beforeEach(async () => {
  await query('TRUNCATE "inspiration_items", "inspiration_collections", "assets", "workspace_members", "workspaces", "boards" CASCADE');
  await registerStudent('ALICE');
  await registerStudent('BOB');
});
afterEach(() => vi.restoreAllMocks());

describe('external URL validation (no server-side fetching, so no SSRF surface)', () => {
  const bad = [
    'javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com',
    'https://user:pw@example.com/', 'http://localhost/admin', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/',
    'http://172.16.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://2130706433/', 'http://0x7f000001/',
    'http://0/', 'http://intranet/', 'https://printer.local/', 'https://db.internal/', '', 'not a url', 'https://', `https://example.com/${'a'.repeat(2100)}`,
  ];
  it.each(bad)('rejects %s', u => expect(validateReferenceUrl(u)).toBeNull());
  it('accepts normal public http(s) links', () => {
    expect(validateReferenceUrl('https://www.behance.net/gallery/123/Brand')).toBe('https://www.behance.net/gallery/123/Brand');
    expect(validateReferenceUrl('  http://example.com/a  ')).toBe('http://example.com/a');
  });
  it('requires image URLs to be https', () => {
    expect(validateImageUrl('https://cdn.example.com/a.jpg')).not.toBeNull();
    expect(validateImageUrl('http://cdn.example.com/a.jpg')).toBeNull();
    expect(validateImageUrl('https://127.0.0.1/a.jpg')).toBeNull();
  });
  it('de-duplicates tracking/fragment/trailing-slash/www variants but not different pages', () => {
    const k = urlDedupeKey('https://www.Example.com/work/1/?utm_source=x&fbclid=1#top');
    expect(k).toBe(urlDedupeKey('http://example.com/work/1'));
    expect(urlDedupeKey('https://example.com/work/2')).not.toBe(k);
    expect(urlDedupeKey('https://example.com/work/1?id=2')).not.toBe(k);
  });
  it('normalises tags and escapes LIKE wildcards', () => {
    expect(normalizeTags(['  #Retro ', 'retro', 'Hand Lettered', '', 'x'.repeat(40), '<b>', 7])).toEqual(['retro', 'hand-lettered']);
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
  });
});

describe('saving, listing and removing references', () => {
  it('requires a signed-in student', async () => {
    expect((await request(app).get('/api/inspiration/items')).status).toBe(401);
    expect((await request(app).post('/api/inspiration/items').send({})).status).toBe(401);
  });

  it('saves an asset by pointer, resolves it for the owner, rejects a duplicate, and never deletes the asset on removal', async () => {
    const ws = await workspaceFor('ALICE');
    const assetId = await insertAsset('ALICE', ws, 'poster.png');
    const res = await post('ALICE', '/items', { kind: 'asset', asset_id: assetId, tags: ['Poster', 'retro'], category: 'typography' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'asset', title: 'poster.png', tags: ['poster', 'retro'], category: 'typography', unavailable: false });
    expect(res.body.asset.id).toBe(assetId);
    expect(res.body.asset.url).toContain(assetId);
    expect(res.body.asset).not.toHaveProperty('storage_key');

    const dup = await post('ALICE', '/items', { kind: 'asset', asset_id: assetId });
    expect(dup.status).toBe(409);
    expect(dup.body.existing_id).toBe(res.body.id);

    expect((await del('ALICE', `/items/${res.body.id}`)).status).toBe(200);
    expect((await get('ALICE', '/items')).body.items).toHaveLength(0);
    expect(await query('SELECT 1 FROM assets WHERE id = $1', [assetId])).toHaveLength(1);
  });

  it("will not save someone else's private asset, and answers 404 as if it did not exist", async () => {
    const ws = await workspaceFor('ALICE');
    const priv = await insertAsset('ALICE', ws, 'secret.png', 'personal');
    const res = await post('BOB', '/items', { kind: 'asset', asset_id: priv });
    expect(res.status).toBe(404);
    expect((await post('BOB', '/items', { kind: 'asset', asset_id: 'no-such-id' })).status).toBe(404);
    expect((await get('BOB', '/items')).body.items).toHaveLength(0);
  });

  it('lets a student save a Community asset, and stops resolving it (without leaking its URL) once it is no longer visible', async () => {
    const ws = await workspaceFor('ALICE');
    const id = await insertAsset('ALICE', ws, 'shared.png', 'community');
    const saved = await post('BOB', '/items', { kind: 'asset', asset_id: id });
    expect(saved.status).toBe(201);
    expect(saved.body.asset.url).toContain(id);

    await query(`UPDATE assets SET visibility = 'personal' WHERE id = $1`, [id]);
    const after = await get('BOB', '/items');
    expect(after.body.items[0]).toMatchObject({ unavailable: true, asset: null });
    expect(JSON.stringify(after.body)).not.toContain(`assets/${ws}`);
    expect(JSON.stringify(after.body)).not.toContain(id + '.png');

    await query(`UPDATE assets SET status = 'hidden', visibility = 'community' WHERE id = $1`, [id]);
    expect((await get('BOB', '/items')).body.items[0].unavailable).toBe(true);
  });

  it('removes the reference when its asset is deleted', async () => {
    const ws = await workspaceFor('ALICE');
    const id = await insertAsset('ALICE', ws, 'gone.png');
    await post('ALICE', '/items', { kind: 'asset', asset_id: id });
    await query('DELETE FROM assets WHERE id = $1', [id]);
    expect((await get('ALICE', '/items')).body.items).toHaveLength(0);
  });

  it('saves an external link without ever fetching it, and de-duplicates variants of the same page', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await post('ALICE', '/items', {
      kind: 'link', url: 'https://www.behance.net/gallery/1/Brand?utm_source=tw', title: 'Brand case study',
      description: 'Great palette', image_url: 'https://cdn.example.com/cover.jpg', tags: ['branding'], category: 'branding',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'link', asset: null, unavailable: false, title: 'Brand case study', image_url: 'https://cdn.example.com/cover.jpg' });
    expect(fetchSpy).not.toHaveBeenCalled();

    const dup = await post('ALICE', '/items', { kind: 'link', url: 'http://behance.net/gallery/1/Brand/#x' });
    expect(dup.status).toBe(409);
    // another student may save the same page — duplicates are per owner
    expect((await post('BOB', '/items', { kind: 'link', url: 'https://www.behance.net/gallery/1/Brand' })).status).toBe(201);
  });

  it('defaults a missing title to the hostname and rejects unsafe links, images and categories', async () => {
    expect((await post('ALICE', '/items', { kind: 'link', url: 'https://www.dribbble.com/shots/9' })).body.title).toBe('dribbble.com');
    for (const url of ['javascript:alert(1)', 'http://localhost:4000/api/admin', 'http://169.254.169.254/', 'file:///etc/passwd']) {
      const r = await post('ALICE', '/items', { kind: 'link', url });
      expect(r.status).toBe(400);
    }
    expect((await post('ALICE', '/items', { kind: 'link', url: 'https://example.com/ok', image_url: 'http://example.com/a.jpg' })).status).toBe(400);
    expect((await post('ALICE', '/items', { kind: 'link', url: 'https://example.com/c', category: 'bogus' })).status).toBe(400);
    expect((await get('ALICE', '/items')).body.items).toHaveLength(1);
  });

  it('edits metadata (tags normalised, category clearable) but not the link target', async () => {
    const id = (await post('ALICE', '/items', { kind: 'link', url: 'https://example.com/one', category: 'color' })).body.id;
    const res = await patch('ALICE', `/items/${id}`, { title: 'Renamed', tags: ['#Warm', 'warm', 'Soft Pastel'], category: null, url: 'https://evil.example.org' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Renamed', tags: ['warm', 'soft-pastel'], category: null, url: 'https://example.com/one' });
    expect((await patch('ALICE', `/items/${id}`, { category: 'nope' })).status).toBe(400);
    expect((await patch('ALICE', `/items/${id}`, {})).status).toBe(400);
  });
});

describe('ownership and isolation', () => {
  it("never shows, edits, deletes or files another student's references", async () => {
    const item = (await post('ALICE', '/items', { kind: 'link', url: 'https://example.com/a', tags: ['mine'] })).body.id;
    const col = (await post('ALICE', '/collections', { name: 'Private' })).body.id;

    expect((await get('BOB', '/items')).body).toMatchObject({ items: [], total: 0 });
    expect((await get('BOB', '/collections')).body.collections).toHaveLength(0);
    expect((await get('BOB', '/facets')).body).toMatchObject({ tags: [], total: 0 });
    expect((await patch('BOB', `/items/${item}`, { title: 'x' })).status).toBe(404);
    expect((await del('BOB', `/items/${item}`)).status).toBe(404);
    expect((await patch('BOB', `/collections/${col}`, { name: 'x' })).status).toBe(404);
    expect((await del('BOB', `/collections/${col}`)).status).toBe(404);
    expect((await post('BOB', `/collections/${col}/items`, { item_id: item })).status).toBe(404);
    const bobCol = (await post('BOB', '/collections', { name: 'Bob' })).body.id;
    expect((await post('BOB', `/collections/${bobCol}/items`, { item_id: item })).status).toBe(404);
    expect((await post('BOB', '/items', { kind: 'link', url: 'https://example.com/b', collection_ids: [col] })).status).toBe(404);

    expect((await get('ALICE', '/items')).body.items).toHaveLength(1);
    expect((await get('ALICE', `/items?collection_id=${col}`)).body.total).toBe(0);
  });
});

describe('collections', () => {
  it('creates private collections, rejects duplicate names (any case), renames and deletes without deleting items', async () => {
    const c = await post('ALICE', '/collections', { name: 'Typography', description: 'Type refs', visibility: 'community' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: 'Typography', visibility: 'private', item_count: 0 });
    expect((await post('ALICE', '/collections', { name: 'typography' })).status).toBe(409);
    expect((await post('ALICE', '/collections', { name: '   ' })).status).toBe(400);
    expect((await post('BOB', '/collections', { name: 'Typography' })).status).toBe(201);

    const renamed = await patch('ALICE', `/collections/${c.body.id}`, { name: 'Type & Lettering' });
    expect(renamed.body.name).toBe('Type & Lettering');
    const other = (await post('ALICE', '/collections', { name: 'Color' })).body.id;
    expect((await patch('ALICE', `/collections/${other}`, { name: 'type & lettering' })).status).toBe(409);

    const item = (await post('ALICE', '/items', { kind: 'link', url: 'https://example.com/t', collection_ids: [c.body.id] })).body;
    expect(item.collection_ids).toEqual([c.body.id]);
    expect((await del('ALICE', `/collections/${c.body.id}`)).status).toBe(200);
    const left = (await get('ALICE', '/items')).body.items;
    expect(left).toHaveLength(1);
    expect(left[0].collection_ids).toEqual([]);
  });

  it('adds and removes references idempotently and filters by collection / unfiled', async () => {
    const a = (await post('ALICE', '/items', { kind: 'link', url: 'https://example.com/a' })).body.id;
    const b = (await post('ALICE', '/items', { kind: 'link', url: 'https://example.com/b' })).body.id;
    const col = (await post('ALICE', '/collections', { name: 'Set' })).body.id;
    expect((await post('ALICE', `/collections/${col}/items`, { item_id: a })).status).toBe(201);
    expect((await post('ALICE', `/collections/${col}/items`, { item_id: a })).status).toBe(201);
    expect((await get('ALICE', '/collections')).body.collections[0].item_count).toBe(1);
    expect((await get('ALICE', `/items?collection_id=${col}`)).body.items.map((i: { id: string }) => i.id)).toEqual([a]);
    expect((await get('ALICE', '/items?collection_id=none')).body.items.map((i: { id: string }) => i.id)).toEqual([b]);
    expect((await del('ALICE', `/collections/${col}/items/${a}`)).status).toBe(200);
    expect((await del('ALICE', `/collections/${col}/items/${a}`)).status).toBe(404);
    expect((await get('ALICE', '/items')).body.total).toBe(2);
  });
});

describe('search, filtering and sorting', () => {
  beforeEach(async () => {
    const seed = [
      { url: 'https://example.com/1', title: 'Neon poster', description: 'glowing colours', tags: ['neon', 'poster'], category: 'illustration' },
      { url: 'https://example.com/2', title: 'Serif specimen', description: 'classic type', tags: ['serif', 'poster'], category: 'typography' },
      { url: 'https://example.com/3', title: 'Brand guidelines', description: '100% usable', tags: ['brand'] },
    ];
    for (const s of seed) {
      await post('ALICE', '/items', { kind: 'link', ...s });
      await new Promise(r => setTimeout(r, 5));
    }
  });
  const titles = (r: { body: { items: Array<{ title: string }> } }) => r.body.items.map(i => i.title);

  it('searches title, description and tags, treating wildcards literally', async () => {
    expect(titles(await get('ALICE', '/items?q=neon'))).toEqual(['Neon poster']);
    expect(titles(await get('ALICE', '/items?q=classic'))).toEqual(['Serif specimen']);
    expect(titles(await get('ALICE', '/items?q=serif'))).toEqual(['Serif specimen']);
    expect(titles(await get('ALICE', '/items?q=100%25'))).toEqual(['Brand guidelines']);
    expect((await get('ALICE', '/items?q=%25')).body.total).toBe(1); // only the literal "%" description
    expect((await get('ALICE', '/items?q=zzz')).body.total).toBe(0);
  });

  it('filters by tag (all must match), category, uncategorised and kind', async () => {
    expect((await get('ALICE', '/items?tag=poster')).body.total).toBe(2);
    expect((await get('ALICE', '/items?tag=poster,neon')).body.total).toBe(1);
    expect(titles(await get('ALICE', '/items?category=typography'))).toEqual(['Serif specimen']);
    expect(titles(await get('ALICE', '/items?category=none'))).toEqual(['Brand guidelines']);
    expect((await get('ALICE', '/items?kind=asset')).body.total).toBe(0);
    expect((await get('ALICE', '/items?category=bogus')).status).toBe(400);
    expect((await get('ALICE', '/items?kind=bogus')).status).toBe(400);
  });

  it('sorts and paginates', async () => {
    expect(titles(await get('ALICE', '/items?sort=title'))).toEqual(['Brand guidelines', 'Neon poster', 'Serif specimen']);
    expect(titles(await get('ALICE', '/items?sort=newest'))[0]).toBe('Brand guidelines');
    expect(titles(await get('ALICE', '/items?sort=oldest'))[0]).toBe('Neon poster');
    expect((await get('ALICE', '/items?sort=random')).status).toBe(400);
    const page1 = await get('ALICE', '/items?sort=title&limit=2');
    expect(page1.body).toMatchObject({ total: 3, hasMore: true });
    const page2 = await get('ALICE', '/items?sort=title&limit=2&offset=2');
    expect(titles(page2)).toEqual(['Serif specimen']);
    expect(page2.body.hasMore).toBe(false);
  });

  it('reports tag and category counts', async () => {
    const f = (await get('ALICE', '/facets')).body;
    expect(f.total).toBe(3);
    expect(f.tags[0]).toEqual({ tag: 'poster', count: 2 });
    expect(f.categories).toEqual(expect.arrayContaining([{ category: 'typography', count: 1 }, { category: 'illustration', count: 1 }]));
  });
});

describe('moodboard integration contract', () => {
  it('an asset-backed reference can be added to a board through the existing, permission-checked items endpoint', async () => {
    const ws = await workspaceFor('ALICE');
    const assetId = await insertAsset('ALICE', ws, 'board.png');
    const board = (await request(app).post('/api/boards').set(auth('ALICE')).send({ name: 'B', workspace_id: ws })).body;
    await post('ALICE', '/items', { kind: 'asset', asset_id: assetId });
    const ok = await request(app).post(`/api/boards/${board.id}/items`).set(auth('ALICE')).send({ asset_id: assetId });
    expect([200, 201]).toContain(ok.status);
    // Bob cannot use Alice's private asset on his own board even via the same endpoint.
    const bws = await workspaceFor('BOB');
    const bboard = (await request(app).post('/api/boards').set(auth('BOB')).send({ name: 'BB', workspace_id: bws })).body;
    expect((await request(app).post(`/api/boards/${bboard.id}/items`).set(auth('BOB')).send({ asset_id: assetId })).status).toBe(404);
  });
});

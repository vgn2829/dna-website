import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import type { StorageProvider, StoredObject } from '../src/storage';
import { recordDerivative } from '../src/storage/derivatives';
import { collectCanvasImageSources, MAX_CANVAS_SOURCES } from '../src/lib/canvasImageSources';

// GET /api/boards/:id/canvas also returns a READ-TIME `image_thumbnails` map (original src →
// ready t512 URL) so the canvas can draw small images from small files. canvas_data itself is
// returned unchanged and never rewritten; anything without a ready derivative is simply absent.

const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const PUBLIC = 'http://storage.test/public/';
class MemoryStorage implements StorageProvider {
  async upload() {} async uploadFile() {} async download(): Promise<Buffer> { throw new Error('unused'); }
  getPublicUrl(p: string) { return PUBLIC + p; } async delete() {} async list(): Promise<StoredObject[]> { return []; }
}
const asset = (src: string, type = 'image') => ({ typeName: 'asset', type, id: `asset:${uuidv4()}`, props: { src, w: 1600, h: 1200, name: 'x', mimeType: 'image/jpeg', isAnimated: false }, meta: {} });
const editorSnapshot = (assets: unknown[]) => JSON.stringify({ document: { store: Object.fromEntries(assets.map((a, i) => [`k${i}`, a])), schema: {} } });
const roomSnapshot = (assets: unknown[]) => JSON.stringify({ documents: assets.map(state => ({ state, lastChangedClock: 1 })), clock: 1 });

describe('collectCanvasImageSources (pure)', () => {
  it('finds image assets in the editor snapshot layout and the realtime room layout', () => {
    const a = asset('https://x.test/a.jpg'), b = asset('https://x.test/b.png');
    expect(collectCanvasImageSources(editorSnapshot([a, b])).sort()).toEqual(['https://x.test/a.jpg', 'https://x.test/b.png']);
    expect(collectCanvasImageSources(roomSnapshot([a, b])).sort()).toEqual(['https://x.test/a.jpg', 'https://x.test/b.png']);
  });
  it('ignores video/bookmark assets, non-http sources (data:, javascript:, relative) and duplicates', () => {
    const out = collectCanvasImageSources(editorSnapshot([
      asset('https://x.test/a.jpg'), asset('https://x.test/a.jpg'), asset('data:image/png;base64,AAAA'), asset('javascript:alert(1)'), asset('/relative.png'), asset('https://x.test/v.mp4', 'video'),
    ]));
    expect(out).toEqual(['https://x.test/a.jpg']);
  });
  it('is safe on null, empty, malformed or non-object input', () => {
    for (const bad of [null, undefined, '', 'not json', '42', 'null', '"str"', '[]', '{}']) expect(collectCanvasImageSources(bad as string | null | undefined)).toEqual([]);
  });
  it('is bounded: a canvas with thousands of images yields at most the cap', () => {
    const many = Array.from({ length: 2000 }, (_, i) => asset(`https://x.test/${i}.jpg`));
    expect(collectCanvasImageSources(editorSnapshot(many)).length).toBe(MAX_CANVAS_SOURCES);
  });
});

async function board(roll: string, canvas: string | null, visibility = 'private') {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1,$2,'01 Jan 2026',$3,$4) ON CONFLICT (roll_number) DO NOTHING`, [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]);
  const ws = (await request(app).post('/api/workspaces').set(auth(roll)).send({ name: 'P' })).body.id as string;
  const id = uuidv4(); const now = new Date().toISOString();
  await query(`INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, workspace_id, canvas_data) VALUES ($1,'B',$2,'O',$3,'members_only',$4,$4,$5,$6,$7)`,
    [id, roll, visibility, now, `room-${id}`, ws, canvas]);
  return { id, ws };
}
const ready = (key: string) => recordDerivative(key, 't512', { status: 'ready', width: 683, height: 512, bytes: 1 });

beforeEach(async () => {
  await query('TRUNCATE "storage_derivatives", "board_items", "board_members", "board_favorites", "boards", "projects", "templates", "workspace_members", "workspaces" CASCADE');
  vi.spyOn(storageModule, 'getStorage').mockReturnValue(new MemoryStorage());
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/boards/:id/canvas image_thumbnails', () => {
  it('maps only images whose t512 derivative is READY; the canvas data is returned byte-for-byte unchanged', async () => {
    const ckReady = `canvas-files/${uuidv4()}/r.jpg`, ckPending = `canvas-files/${uuidv4()}/p.jpg`;
    await ready(ckReady);
    const data = editorSnapshot([asset(PUBLIC + ckReady), asset(PUBLIC + ckPending), asset('https://images.example.com/external.jpg')]);
    const { id } = await board('CT1', data);
    const res = await request(app).get(`/api/boards/${id}/canvas`).set(auth('CT1'));
    expect(res.status).toBe(200);
    expect(res.body.canvas_data).toBe(data);
    expect(res.body.image_thumbnails).toEqual({ [PUBLIC + ckReady]: PUBLIC + `derived/${ckReady}/t512.webp` });
    const stored = await query<{ canvas_data: string }>('SELECT canvas_data FROM boards WHERE id = $1', [id]);
    expect(stored[0].canvas_data).toBe(data);                                   // nothing rewritten
  });
  it('returns an empty map for an empty or image-less board', async () => {
    const { id } = await board('CT2', null);
    expect((await request(app).get(`/api/boards/${id}/canvas`).set(auth('CT2'))).body).toEqual({ canvas_data: null, image_thumbnails: {} });
  });
  it('never maps a derivative that belongs to a different source (spoofed/foreign URLs are not trusted)', async () => {
    const real = `canvas-files/${uuidv4()}/real.jpg`; await ready(real);
    const { id } = await board('CT3', editorSnapshot([asset(PUBLIC + real + '?x=1'), asset('http://evil.test/' + real)]));
    expect((await request(app).get(`/api/boards/${id}/canvas`).set(auth('CT3'))).body.image_thumbnails).toEqual({});
  });
  it('keeps the existing access rules: private boards need membership, and thumbnails are not exposed to outsiders', async () => {
    const key = `canvas-files/${uuidv4()}/k.jpg`; await ready(key);
    const { id } = await board('CT4', editorSnapshot([asset(PUBLIC + key)]));
    expect((await request(app).get(`/api/boards/${id}/canvas`)).status).toBe(403);
    expect((await request(app).get(`/api/boards/${id}/canvas`).set(auth('CT5'))).status).toBe(403);
    const shared = await board('CT6', editorSnapshot([asset(PUBLIC + key)]), 'shared');
    expect((await request(app).get(`/api/boards/${shared.id}/canvas`)).status).toBe(200);   // shared boards stay viewable
  });
  it('degrades to originals (still 200) if the thumbnail lookup fails', async () => {
    const key = `canvas-files/${uuidv4()}/k.jpg`;
    const data = editorSnapshot([asset(PUBLIC + key)]);
    const { id } = await board('CT7', data);
    vi.spyOn(storageModule, 'getStorage').mockImplementation(() => { throw new Error('storage down'); });
    const res = await request(app).get(`/api/boards/${id}/canvas`).set(auth('CT7'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ canvas_data: data, image_thumbnails: {} });
  });
});

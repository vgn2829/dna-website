import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query, pool } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import type { StorageProvider, StoredObject } from '../src/storage';
import {
  derivativeKey, parseDerivativeKey, parseSourceKey, renderVariant, recordDerivative, generateDerivative,
  settleDerivativeJobs, resolveDerivativeUrls, sourceKeyFromUrl, deleteDerivatives, DERIVATIVE_CACHE_CONTROL,
} from '../src/storage/derivatives';
import { runDerivativeBackfill } from '../src/storage/derivativeBackfill';
import { classifyStorageObjects } from '../src/storage/inventory';
import { findStorageReferences } from '../src/storage/references';

// ─────────────────────────────────────────────────────────────────────────
// V3.2.3 — image derivative infrastructure (storage/derivatives.ts,
// storage/derivativeBackfill.ts, inventory's derived/ namespace, upload
// and delete integration). Storage is an in-memory provider (swapped in
// through getStorage) so the backfill's full-bucket listing only ever sees
// this file's objects, never the shared backend/uploads directory.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const PUBLIC = 'http://storage.test/public/';

class MemoryStorage implements StorageProvider {
  objects = new Map<string, { buf: Buffer; mime: string; cacheControl?: string }>();
  failUploadsUnder: string | null = null;
  failDeletesUnder: string | null = null;
  writes: string[] = [];
  async upload(p: string, buf: Buffer, mime: string, opts?: { cacheControl?: string }) {
    if (this.failUploadsUnder && p.startsWith(this.failUploadsUnder)) throw new Error('simulated storage outage');
    this.writes.push(p);
    this.objects.set(p, { buf: Buffer.from(buf), mime, cacheControl: opts?.cacheControl });
  }
  async download(p: string) { const o = this.objects.get(p); if (!o) throw new Error(`not found: ${p}`); return Buffer.from(o.buf); }
  getPublicUrl(p: string) { return PUBLIC + p; }
  async delete(p: string) { if (this.failDeletesUnder && p.startsWith(this.failDeletesUnder)) throw new Error('simulated delete failure'); this.objects.delete(p); }
  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.entries()].filter(([p]) => p.startsWith(prefix)).map(([p, o]) => ({ path: p, size: o.buf.length })).sort((a, b) => (a.path < b.path ? -1 : 1));
  }
}
let mem: MemoryStorage;

// ── fixtures ───────────────────────────────────────────────────────────────
const solid = (w: number, h: number, bg = '#3a7') => sharp({ create: { width: w, height: h, channels: 3, background: bg } });
const jpeg = (w = 1600, h = 1200) => solid(w, h).jpeg().toBuffer();
const png = (w = 1200, h = 900) => solid(w, h, '#a37').png().toBuffer();
const webp = (w = 1000, h = 800) => solid(w, h, '#37a').webp().toBuffer();
const transparentPng = () => sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
const rotatedJpeg = () => solid(900, 600).jpeg().withMetadata({ orientation: 6 }).toBuffer(); // stored 900x600, displays 600x900
const singleGif = () => solid(700, 600).gif().toBuffer();
async function animatedGif() {
  const w = 40, h = 20, frames = 3; const raw = Buffer.alloc(w * h * frames * 4);
  for (let i = 0; i < raw.length; i += 4) { raw[i] = Math.floor(i / 4 / (w * h)) * 80; raw[i + 3] = 255; }
  return sharp(raw, { raw: { width: w, height: h * frames, channels: 4, pageHeight: h } }).gif({ delay: [100, 100, 100] }).toBuffer();
}
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>');

async function registerStudent(roll: string) {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]);
}
async function createWorkspace(roll: string) {
  const res = await request(app).post('/api/workspaces').set(auth(roll)).send({ name: 'Derivatives' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}
async function uploadAsset(roll: string, ws: string, buf: Buffer, mime: string, filename: string) {
  const res = await request(app).post('/api/assets').set(auth(roll)).field('workspace_id', ws).attach('file', buf, { filename, contentType: mime });
  return res;
}
const row = async (sourceKey: string) => (await query('SELECT * FROM storage_derivatives WHERE source_key = $1', [sourceKey]))[0] as Record<string, unknown> | undefined;
const rowCount = async () => Number((await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM storage_derivatives'))[0].n);
const dims = async (buf: Buffer) => { const m = await sharp(buf).metadata(); return { w: m.width, h: m.height, format: m.format }; };

beforeEach(async () => {
  await query('TRUNCATE "storage_derivatives", "board_items", "board_versions", "board_members", "board_favorites", "boards", "templates", "assets", "workspace_members", "workspaces" CASCADE');
  mem = new MemoryStorage();
  vi.spyOn(storageModule, 'getStorage').mockReturnValue(mem);
});
afterEach(async () => {
  await settleDerivativeJobs();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
describe('generation (renderVariant: t512 WebP, short edge 512, never enlarged)', () => {
  it('1-3: JPEG, PNG and WebP become a WebP whose short edge is 512', async () => {
    for (const [buf, w, h] of [[await jpeg(), 683, 512], [await png(), 683, 512], [await webp(), 640, 512]] as const) {
      const r = await renderVariant(buf);
      expect(r.kind).toBe('ready');
      if (r.kind !== 'ready') continue;
      expect([r.width, r.height]).toEqual([w, h]);
      expect(await dims(r.buffer)).toEqual({ w, h, format: 'webp' });
    }
  });
  it('4: a transparent image keeps its alpha channel', async () => {
    const r = await renderVariant(await transparentPng());
    expect(r.kind).toBe('ready');
    if (r.kind === 'ready') expect((await sharp(r.buffer).metadata()).hasAlpha).toBe(true);
  });
  it('5: EXIF orientation is applied (stored 900x600, orientation 6 → upright 512x768)', async () => {
    const r = await renderVariant(await rotatedJpeg());
    expect(r.kind === 'ready' && [r.width, r.height]).toEqual([512, 768]);
  });
  it('6: an image already smaller than 512 is not enlarged', async () => {
    const r = await renderVariant(await jpeg(300, 200));
    expect(r.kind === 'ready' && [r.width, r.height]).toEqual([300, 200]);
  });
  it('7: a panorama is sized by its SHORT edge (6000x800 → 3840x512)', async () => {
    const r = await renderVariant(await jpeg(6000, 800));
    expect(r.kind === 'ready' && [r.width, r.height]).toEqual([3840, 512]);
  });
  it('8: a single-frame GIF gets a derivative', async () => {
    const r = await renderVariant(await singleGif());
    expect(r.kind === 'ready' && [r.width, r.height]).toEqual([597, 512]);
  });
  it('9: a multi-frame (animated) GIF is skipped, and the skip is recorded (served as the original)', async () => {
    expect(await renderVariant(await animatedGif())).toMatchObject({ kind: 'skipped' });
    expect(await generateDerivative('assets/ws1/anim.gif', await animatedGif())).toBe('skipped');
    expect(await row('assets/ws1/anim.gif')).toMatchObject({ status: 'skipped', width: null });
    expect(mem.objects.has(derivativeKey('assets/ws1/anim.gif'))).toBe(false);
  });
  it('10: SVG is skipped (served as the original)', async () => {
    expect(await renderVariant(SVG)).toMatchObject({ kind: 'skipped' });
    expect(await generateDerivative('assets/ws1/vector.svg', SVG)).toBe('ineligible');
  });
  it('11: non-image sources are never derived', async () => {
    expect(await generateDerivative('assets/ws1/doc.pdf', Buffer.from('%PDF-1.4'))).toBe('ineligible');
    expect(await generateDerivative('assets/ws1/archive.zip', Buffer.from('PK'))).toBe('ineligible');
    await expect(renderVariant(Buffer.from('not an image at all'))).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });
});

describe('key safety', () => {
  it('12-13: keys are deterministic and round-trip through the parser', () => {
    const src = 'assets/ws-1/abc_123.jpg';
    expect(derivativeKey(src)).toBe('derived/assets/ws-1/abc_123.jpg/t512.webp');
    expect(derivativeKey(src)).toBe(derivativeKey(src, 't512'));
    expect(parseDerivativeKey(derivativeKey(src))).toEqual({ sourceKey: src, variant: 't512' });
    expect(parseDerivativeKey(derivativeKey('canvas-files/9b1c/file_1.png'))).toEqual({ sourceKey: 'canvas-files/9b1c/file_1.png', variant: 't512' });
  });
  it('14: malformed source and derivative keys are rejected', () => {
    for (const bad of ['', 'assets/ws/a.jpg/x', 'assets/a.jpg', 'thumbs/ws/a.jpg', 'gallery/ws/a.jpg', 'assets/../a.jpg', 'assets/ws/..jpg',
      'assets/ws/a%2e%2e.jpg', 'assets/ws/a.jpg?x=1', 'assets/ws /a.jpg', '/assets/ws/a.jpg', 'assets\\ws\\a.jpg']) {
      expect(parseSourceKey(bad), bad).toBeNull();
      expect(() => derivativeKey(bad), bad).toThrow();
    }
    for (const bad of ['derived/assets/ws/a.jpg', 'derived/assets/ws/a.jpg/t1024.webp', 'derived/assets/ws/a.jpg/t512.png', 'derived/thumbs/x/a.jpg/t512.webp',
      'derived/assets/ws/../t512.webp', 'derived/assets/ws/a.jpg/t512.webp/extra', 'assets/ws/a.jpg/t512.webp']) {
      expect(parseDerivativeKey(bad), bad).toBeNull();
    }
  });
  it('15: external URLs pass through unchanged', async () => {
    const urls = ['https://images.example.com/a.jpg', 'https://www.figma.com/file/x', 'data:image/png;base64,AAAA', 'not a url'];
    const map = await resolveDerivativeUrls(urls);
    for (const u of urls) expect(map.get(u)).toBe(u);
    for (const u of urls) expect(sourceKeyFromUrl(u)).toBeNull();
  });
  it('16: a crafted URL cannot escape the managed namespaces', async () => {
    for (const u of [`${PUBLIC}assets/ws/../../etc/passwd`, `${PUBLIC}derived/assets/ws/a.jpg/t512.webp`, `${PUBLIC}thumbs/x.webp`,
      `${PUBLIC}assets/ws/a.jpg/../../x.jpg`, `${PUBLIC}assets/ws/a%2F..%2Fb.jpg`, `${PUBLIC}../assets/ws/a.jpg`, `http://evil.test/public/assets/ws/a.jpg`]) {
      expect(sourceKeyFromUrl(u), u).toBeNull();
      expect((await resolveDerivativeUrls([u])).get(u), u).toBe(u);
    }
  });
});

describe('database state', () => {
  it('17-20: ready row, failed row, idempotent upsert, one deterministic key per source+variant', async () => {
    const src = 'assets/ws1/a.jpg';
    await recordDerivative(src, 't512', { status: 'failed', error: 'x'.repeat(900) });
    let r = await row(src);
    expect(r).toMatchObject({ status: 'failed', derivative_key: derivativeKey(src), width: null, bytes: null });
    expect((r!.error as string).length).toBe(500);
    await recordDerivative(src, 't512', { status: 'ready', width: 683, height: 512, bytes: 9000 });
    await recordDerivative(src, 't512', { status: 'ready', width: 683, height: 512, bytes: 9000 });
    r = await row(src);
    expect(r).toMatchObject({ status: 'ready', derivative_key: derivativeKey(src), width: 683, height: 512, bytes: 9000, error: null });
    expect(await rowCount()).toBe(1);
  });
});

describe('upload integration', () => {
  it('library image upload: original stored untouched, t512 generated after the response, row ready, immutable cache', async () => {
    await registerStudent('DV1'); const ws = await createWorkspace('DV1');
    const original = await jpeg();
    const res = await uploadAsset('DV1', ws, original, 'image/jpeg', 'photo.jpg');
    expect(res.status).toBe(201);
    expect(res.body.url).toBe(PUBLIC + `assets/${ws}/${res.body.id}.jpg`); // response still points at the original
    await settleDerivativeJobs();
    const src = `assets/${ws}/${res.body.id}.jpg`;
    expect(mem.objects.get(src)!.buf.equals(original)).toBe(true);
    expect(mem.objects.get(src)!.cacheControl).toBeUndefined(); // originals: caching unchanged
    const d = mem.objects.get(derivativeKey(src))!;
    expect(d.mime).toBe('image/webp');
    expect(d.cacheControl).toBe('31536000');
    expect(await row(src)).toMatchObject({ status: 'ready', width: 683, height: 512, bytes: d.buf.length });
  });

  it('SVG and general-file uploads get no derivative', async () => {
    await registerStudent('DV2'); const ws = await createWorkspace('DV2');
    expect((await uploadAsset('DV2', ws, SVG, 'image/svg+xml', 'v.svg')).status).toBe(201);
    const file = await request(app).post('/api/assets').set(auth('DV2')).field('workspace_id', ws).field('kind', 'file').attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(file.status).toBe(201);
    await settleDerivativeJobs();
    expect(await rowCount()).toBe(0);
    expect([...mem.objects.keys()].some(k => k.startsWith('derived/'))).toBe(false);
  });

  it('36-38: the upload succeeds when generation fails; the failure is recorded; the backfill recovers it', async () => {
    await registerStudent('DV3'); const ws = await createWorkspace('DV3');
    mem.failUploadsUnder = 'derived/';
    const res = await uploadAsset('DV3', ws, await png(), 'image/png', 'shot.png');
    expect(res.status).toBe(201);
    await settleDerivativeJobs();
    const src = `assets/${ws}/${res.body.id}.png`;
    expect(mem.objects.has(src)).toBe(true);
    expect(await row(src)).toMatchObject({ status: 'failed', error: 'simulated storage outage' });
    expect((await request(app).get(`/api/assets?workspace_id=${ws}`).set(auth('DV3'))).body.assets).toHaveLength(1);

    mem.failUploadsUnder = null;
    const result = await runDerivativeBackfill({ apply: true });
    expect(result.items).toEqual([{ sourceKey: src, reason: 'retry-failed', outcome: 'ready' }]);
    expect(await row(src)).toMatchObject({ status: 'ready', error: null });
  });

  it('a corrupt image still uploads; its derivative is recorded as failed', async () => {
    await registerStudent('DV4'); const ws = await createWorkspace('DV4');
    const res = await uploadAsset('DV4', ws, Buffer.from('definitely not a png'), 'image/png', 'broken.png');
    expect(res.status).toBe(201);
    await settleDerivativeJobs();
    expect(await row(`assets/${ws}/${res.body.id}.png`)).toMatchObject({ status: 'failed' });
  });

  it('39-40: canvas-file uploads get a derivative; the canvas source and its URL are untouched', async () => {
    await registerStudent('DV5');
    const ws = await createWorkspace('DV5');
    const boardId = uuidv4(); const now = new Date().toISOString();
    await query(`INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id)
                 VALUES ($1, 'B', 'DV5', 'O', 'private', 'members_only', $2, $2, $3, false, $4)`, [boardId, now, `room-${boardId}`, ws]);
    const original = await jpeg(2000, 1500);
    const res = await request(app).post(`/api/boards/${boardId}/canvas-files`).set(auth('DV5')).field('fileId', 'img_1').attach('file', original, { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    const src = `canvas-files/${boardId}/img_1.jpg`;
    expect(res.body.url).toBe(PUBLIC + src);
    await settleDerivativeJobs();
    expect(mem.objects.get(src)!.buf.equals(original)).toBe(true);
    expect(await row(src)).toMatchObject({ status: 'ready', width: 683, height: 512 });
    expect(mem.objects.has(derivativeKey(src))).toBe(true);
  });
});

describe('asset deletion', () => {
  async function readyAsset(roll: string) {
    await registerStudent(roll); const ws = await createWorkspace(roll);
    const res = await uploadAsset(roll, ws, await jpeg(), 'image/jpeg', 'p.jpg');
    await settleDerivativeJobs();
    const src = `assets/${ws}/${res.body.id}.jpg`;
    expect(await row(src)).toMatchObject({ status: 'ready' });
    return { ws, id: res.body.id as string, src };
  }

  it('21: source deleted (unreferenced) → its derivative object and row are deleted', async () => {
    const a = await readyAsset('DD1');
    const del = await request(app).delete(`/api/assets/${a.id}`).set(auth('DD1'));
    expect(del.body).toEqual({ success: true });
    expect(mem.objects.has(a.src)).toBe(false);
    expect(mem.objects.has(derivativeKey(a.src))).toBe(false);
    expect(await row(a.src)).toBeUndefined();
  });

  it('22: source retained (referenced by a board) → derivative object and row are kept', async () => {
    const a = await readyAsset('DD2');
    const boardId = uuidv4(); const now = new Date().toISOString();
    await query(`INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id, canvas_data)
                 VALUES ($1, 'B', 'DD2', 'O', 'private', 'members_only', $2, $2, $3, false, $4, $5)`, [boardId, now, `room-${boardId}`, a.ws, JSON.stringify({ src: PUBLIC + a.src })]);
    const del = await request(app).delete(`/api/assets/${a.id}`).set(auth('DD2'));
    expect(del.body).toEqual({ success: true, fileRetained: true });
    expect(mem.objects.has(a.src)).toBe(true);
    expect(mem.objects.has(derivativeKey(a.src))).toBe(true);
    expect(await row(a.src)).toMatchObject({ status: 'ready' });
  });

  it('23: a derivative delete failure does not make the asset deletion fail or keep the source', async () => {
    const a = await readyAsset('DD3');
    mem.failDeletesUnder = 'derived/';
    const del = await request(app).delete(`/api/assets/${a.id}`).set(auth('DD3'));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ success: true });
    expect(mem.objects.has(a.src)).toBe(false);
    expect(await row(a.src)).toBeUndefined();
    expect(mem.objects.has(derivativeKey(a.src))).toBe(true); // leftover → inventory ORPHAN (test 26)
    const [c] = await classifyStorageObjects(await mem.list('derived/'));
    expect(c.classification).toBe('ORPHAN');
  });

  it('24: a ready row whose derivative object is missing is repaired by the backfill', async () => {
    const a = await readyAsset('DD4');
    mem.objects.delete(derivativeKey(a.src));
    const dry = await runDerivativeBackfill();
    expect(dry.toProcess['repair-missing-object']).toBe(1);
    const result = await runDerivativeBackfill({ apply: true });
    expect(result.items).toEqual([{ sourceKey: a.src, reason: 'repair-missing-object', outcome: 'ready' }]);
    expect(mem.objects.has(derivativeKey(a.src))).toBe(true);
  });

  it('deleteDerivatives ignores anything that is not a managed source key', async () => {
    mem.objects.set('derived/other/t512.webp', { buf: Buffer.from('x'), mime: 'image/webp' });
    await deleteDerivatives('../../other');
    expect(mem.objects.has('derived/other/t512.webp')).toBe(true);
  });
});

describe('inventory', () => {
  it('25-27: live derivative, orphan derivative, malformed derived path', async () => {
    const live = 'assets/ws1/live.jpg', gone = 'canvas-files/b1/gone.png';
    mem.objects.set(live, { buf: await jpeg(), mime: 'image/jpeg' });
    for (const k of [derivativeKey(live), derivativeKey(gone), 'derived/assets/ws1/live.jpg/t999.webp', 'derived/nonsense.webp']) mem.objects.set(k, { buf: Buffer.from('x'), mime: 'image/webp' });
    const items = await classifyStorageObjects(await mem.list(''));
    const by = (p: string) => items.find(i => i.path === p)!;
    expect(by(derivativeKey(live))).toMatchObject({ namespace: 'derived', classification: 'LIVE_OWNER', owner: `source object ${live}`, referenceCount: 0 });
    expect(by(derivativeKey(gone))).toMatchObject({ namespace: 'derived', classification: 'ORPHAN' });
    expect(by('derived/assets/ws1/live.jpg/t999.webp').classification).toBe('UNKNOWN');
    expect(by('derived/nonsense.webp').classification).toBe('UNKNOWN');
  });

  it('a narrower listing uses the supplied source paths (live derivatives never look orphaned)', async () => {
    const live = 'assets/ws1/live.jpg';
    mem.objects.set(live, { buf: await jpeg(), mime: 'image/jpeg' });
    mem.objects.set(derivativeKey(live), { buf: Buffer.from('x'), mime: 'image/webp' });
    const [c] = await classifyStorageObjects(await mem.list('derived/'), pool, new Set((await mem.list('assets/')).map(o => o.path)));
    expect(c.classification).toBe('LIVE_OWNER');
  });

  it('28-29: a derivative neither owns its source nor counts as a reference to it', async () => {
    await registerStudent('DI1'); const ws = await createWorkspace('DI1');
    const res = await uploadAsset('DI1', ws, await jpeg(), 'image/jpeg', 'p.jpg');
    await settleDerivativeJobs();
    const src = `assets/${ws}/${res.body.id}.jpg`;
    expect(mem.objects.has(derivativeKey(src))).toBe(true);
    expect(await findStorageReferences(src)).toEqual([]);
    // Owner row gone (simulate a delete whose storage delete failed): the
    // source is an ORPHAN even though a live derivative of it exists.
    await query('DELETE FROM assets WHERE id = $1', [res.body.id]);
    const items = await classifyStorageObjects(await mem.list(''));
    expect(items.find(i => i.path === src)!.classification).toBe('ORPHAN');
    // And a normal delete still removes the source despite the derivative.
    const res2 = await uploadAsset('DI1', ws, await jpeg(), 'image/jpeg', 'q.jpg');
    await settleDerivativeJobs();
    await request(app).delete(`/api/assets/${res2.body.id}`).set(auth('DI1'));
    expect(mem.objects.has(`assets/${ws}/${res2.body.id}.jpg`)).toBe(false);
  });
});

describe('backfill', () => {
  async function seedOriginals() {
    const originals = new Map<string, Buffer>([
      ['assets/ws1/a.jpg', await jpeg()], ['assets/ws1/b.png', await png()], ['canvas-files/b1/c.webp', await webp()],
      ['assets/ws1/anim.gif', await animatedGif()], ['assets/ws1/v.svg', SVG], ['assets/ws1/doc.pdf', Buffer.from('%PDF')],
    ]);
    for (const [k, buf] of originals) mem.objects.set(k, { buf, mime: 'x' });
    return originals;
  }

  it('30: dry run lists work but writes nothing (no objects, no rows)', async () => {
    await seedOriginals();
    const before = [...mem.objects.keys()].sort();
    const r = await runDerivativeBackfill({ limit: 1 });
    expect(r.apply).toBe(false);
    expect(r).toMatchObject({ eligible: 4, alreadyReady: 0, processed: 0, toProcess: { missing: 4 } }); // svg + pdf never eligible
    expect(r.items).toHaveLength(1);
    expect([...mem.objects.keys()].sort()).toEqual(before);
    expect(mem.writes).toEqual([]);
    expect(await rowCount()).toBe(0);
  });

  it('31-35: apply, --limit, repeat-apply skips ready, failed retried, originals unchanged', async () => {
    const originals = await seedOriginals();
    // Sorted order: a.jpg, anim.gif, b.png, canvas-files/.../c.webp
    const first = await runDerivativeBackfill({ apply: true, limit: 2 });
    expect(first.processed).toBe(2);
    expect(first.outcomes).toEqual({ ready: 1, failed: 0, skipped: 1 }); // animated GIF examined, skip recorded
    expect(first.remaining).toBe(2);

    const second = await runDerivativeBackfill({ apply: true });
    expect(second).toMatchObject({ alreadyReady: 1, alreadySkipped: 1 }); // resumed; the GIF is not re-examined
    expect(second.outcomes).toEqual({ ready: 2, failed: 0, skipped: 0 });
    const writesAfterSecond = mem.writes.length;

    const third = await runDerivativeBackfill({ apply: true });
    expect(third).toMatchObject({ alreadyReady: 3, alreadySkipped: 1, processed: 0 });
    expect(mem.writes.length).toBe(writesAfterSecond); // no duplicate derivative objects
    expect(await rowCount()).toBe(4);

    // Failure recorded, processing continues, then retried
    mem.objects.set('assets/ws1/broken.jpg', { buf: Buffer.from('not a jpeg'), mime: 'x' });
    const failing = await runDerivativeBackfill({ apply: true });
    expect(failing.outcomes.failed).toBe(1);
    expect(await row('assets/ws1/broken.jpg')).toMatchObject({ status: 'failed' });
    mem.objects.set('assets/ws1/broken.jpg', { buf: await jpeg(), mime: 'x' });
    const retry = await runDerivativeBackfill({ apply: true });
    expect(retry.items.find(i => i.sourceKey === 'assets/ws1/broken.jpg')).toMatchObject({ reason: 'retry-failed', outcome: 'ready' });

    for (const [k, buf] of originals) expect(mem.objects.get(k)!.buf.equals(buf), k).toBe(true); // 35
    expect(mem.writes.every(p => p.startsWith('derived/'))).toBe(true);
  });
});

describe('read-time URL mapping', () => {
  it('maps OUR ready sources to derivative URLs and everything else to the original', async () => {
    const ready = 'assets/ws1/r.jpg', failed = 'assets/ws1/f.jpg', none = 'canvas-files/b1/n.png', svg = 'assets/ws1/v.svg';
    await recordDerivative(ready, 't512', { status: 'ready', width: 683, height: 512, bytes: 1 });
    await recordDerivative(failed, 't512', { status: 'failed', error: 'x' });
    const inputs = [PUBLIC + ready, PUBLIC + failed, PUBLIC + none, PUBLIC + svg, ready, 'https://ext.example/a.jpg'];
    const map = await resolveDerivativeUrls(inputs);
    expect(map.get(PUBLIC + ready)).toBe(PUBLIC + derivativeKey(ready));
    expect(map.get(ready)).toBe(PUBLIC + derivativeKey(ready)); // a bare managed key works too
    expect(map.get(PUBLIC + failed)).toBe(PUBLIC + failed);
    expect(map.get(PUBLIC + none)).toBe(PUBLIC + none);
    expect(map.get(PUBLIC + svg)).toBe(PUBLIC + svg);
    expect(map.get('https://ext.example/a.jpg')).toBe('https://ext.example/a.jpg');
  });

  it('a failed lookup falls back to originals', async () => {
    const src = 'assets/ws1/r.jpg';
    await recordDerivative(src, 't512', { status: 'ready', width: 1, height: 1, bytes: 1 });
    const broken = { query: async () => { throw new Error('db down'); } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await resolveDerivativeUrls([PUBLIC + src], 't512', broken)).get(PUBLIC + src)).toBe(PUBLIC + src);
  });

  it('derivative URLs are never persisted into saved content', async () => {
    await registerStudent('DP1'); const ws = await createWorkspace('DP1');
    const res = await uploadAsset('DP1', ws, await jpeg(), 'image/jpeg', 'p.jpg');
    await settleDerivativeJobs();
    const persisted = await query(`SELECT canvas_data, canvas_preview FROM boards UNION ALL SELECT canvas_data, NULL FROM templates UNION ALL SELECT snapshot, NULL FROM board_versions`);
    expect(JSON.stringify(persisted)).not.toContain('derived/');
    expect(JSON.stringify((await request(app).get(`/api/assets?workspace_id=${ws}`).set(auth('DP1'))).body)).not.toContain('derived/');
    expect(res.body.url).not.toContain('derived/');
  });
});

describe('local static serving cache headers', () => {
  it('derived/ objects are immutable for a year; originals keep their existing headers', async () => {
    vi.restoreAllMocks(); // real local provider for this one
    const UPLOADS = path.join(__dirname, '../uploads');
    const dKey = `derived/assets/cachetest/${uuidv4()}.jpg/t512.webp`;
    const oKey = `assets/cachetest/${uuidv4()}.jpg`;
    for (const k of [dKey, oKey]) { fs.mkdirSync(path.dirname(path.join(UPLOADS, k)), { recursive: true }); fs.writeFileSync(path.join(UPLOADS, k), Buffer.from('x')); }
    try {
      const d = await request(app).get(`/uploads/${dKey}`);
      const o = await request(app).get(`/uploads/${oKey}`);
      expect(d.status).toBe(200);
      expect(d.headers['cache-control']).toBe(DERIVATIVE_CACHE_CONTROL);
      expect(o.headers['cache-control']).toBe('public, max-age=0');
      expect(d.headers['content-disposition']).toBe('attachment');
    } finally {
      fs.rmSync(path.join(UPLOADS, 'derived/assets/cachetest'), { recursive: true, force: true });
      fs.rmSync(path.join(UPLOADS, 'assets/cachetest'), { recursive: true, force: true });
    }
  });
});

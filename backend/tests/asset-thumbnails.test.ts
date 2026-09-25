import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query, pool } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import type { StorageProvider, StoredObject } from '../src/storage';
import { derivativeKey, recordDerivative, settleDerivativeJobs } from '../src/storage/derivatives';

// ─────────────────────────────────────────────────────────────────────────
// V3.2.4 — asset API responses carry a READ-TIME `thumb_url`: the t512
// derivative's public URL when its storage_derivatives row is 'ready',
// null otherwise. `url` (the original) is unchanged. Nothing is stored.
// In-memory storage, same as storage-derivatives.test.ts.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const PUBLIC = 'http://storage.test/public/';

class MemoryStorage implements StorageProvider {
  objects = new Map<string, Buffer>();
  async upload(p: string, buf: Buffer) { this.objects.set(p, Buffer.from(buf)); }
  async download(p: string) { const b = this.objects.get(p); if (!b) throw new Error('not found'); return b; }
  getPublicUrl(p: string, opts?: { download?: string }) { return PUBLIC + p + (opts?.download ? `?download=${encodeURIComponent(opts.download)}` : ''); }
  async delete(p: string) { this.objects.delete(p); }
  async list(prefix: string): Promise<StoredObject[]> { return [...this.objects.keys()].filter(k => k.startsWith(prefix)).map(k => ({ path: k, size: this.objects.get(k)!.length })); }
}

const jpeg = () => sharp({ create: { width: 1200, height: 900, channels: 3, background: '#2a6' } }).jpeg().toBuffer();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="blue"/></svg>');

async function registerStudent(roll: string) {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]);
}
async function workspace(roll: string) {
  await registerStudent(roll);
  const res = await request(app).post('/api/workspaces').set(auth(roll)).send({ name: 'Thumbs' });
  return res.body.id as string;
}
// An image asset row whose original exists, WITHOUT going through upload
// (so no derivative is generated unless a test records one).
async function insertImageAsset(ws: string, roll: string, storageKey: string, kind = 'image') {
  const id = uuidv4();
  await query(`INSERT INTO assets (id, workspace_id, owner_roll, owner_name, kind, filename, storage_key, mime_type, size_bytes, width, height, created_at)
               VALUES ($1, $2, $3, 'O', $4, 'x.jpg', $5, 'image/jpeg', 100, 10, 10, $6)`, [id, ws, roll, kind, storageKey, new Date().toISOString()]);
  return id;
}
const list = async (roll: string, ws: string, extra = '') => (await request(app).get(`/api/assets?workspace_id=${ws}${extra}`).set(auth(roll))).body.assets as Array<Record<string, unknown>>;

let mem: MemoryStorage;
beforeEach(async () => {
  await query('TRUNCATE "storage_derivatives", "assets", "asset_collections", "workspace_members", "workspaces" CASCADE');
  mem = new MemoryStorage();
  vi.spyOn(storageModule, 'getStorage').mockReturnValue(mem);
});
afterEach(async () => { await settleDerivativeJobs(); vi.restoreAllMocks(); });

describe('asset API thumb_url', () => {
  it('1 + 7: an uploaded image gets thumb_url once its derivative is ready; url stays the original', async () => {
    const ws = await workspace('AT1');
    const up = await request(app).post('/api/assets').set(auth('AT1')).field('workspace_id', ws).attach('file', await jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(201);
    const key = `assets/${ws}/${up.body.id}.jpg`;
    expect(up.body.url).toBe(PUBLIC + key);
    expect(up.body).toHaveProperty('thumb_url'); // present on every response (null until generated)
    await settleDerivativeJobs();
    const [a] = await list('AT1', ws);
    expect(a.thumb_url).toBe(PUBLIC + derivativeKey(key));
    expect(a.url).toBe(PUBLIC + key);
    // single-asset routes carry it too
    expect((await request(app).get(`/api/assets/${up.body.id}`).set(auth('AT1'))).body).toMatchObject({ url: PUBLIC + key, thumb_url: PUBLIC + derivativeKey(key) });
    const renamed = await request(app).patch(`/api/assets/${up.body.id}`).set(auth('AT1')).send({ filename: 'renamed.jpg' });
    expect(renamed.body).toMatchObject({ filename: 'renamed.jpg', url: PUBLIC + key, thumb_url: PUBLIC + derivativeKey(key) });
  });

  it('2-4: thumb_url is null when the derivative is missing, failed or skipped', async () => {
    const ws = await workspace('AT2');
    const keys = { missing: `assets/${ws}/m.jpg`, failed: `assets/${ws}/f.jpg`, skipped: `assets/${ws}/s.gif` };
    const ids: Record<string, string> = {};
    for (const [k, key] of Object.entries(keys)) ids[k] = await insertImageAsset(ws, 'AT2', key);
    await recordDerivative(keys.failed, 't512', { status: 'failed', error: 'boom' });
    await recordDerivative(keys.skipped, 't512', { status: 'skipped', error: 'animated' });
    const rows = await list('AT2', ws);
    for (const [k, key] of Object.entries(keys)) {
      const a = rows.find(r => r.id === ids[k])!;
      expect(a.thumb_url, k).toBeNull();
      expect(a.url, k).toBe(PUBLIC + key);
    }
  });

  it('5: a malformed/untrusted storage key never yields a derivative URL', async () => {
    const ws = await workspace('AT3');
    const bad = ['legacy/uploads/x.jpg', `assets/${ws}/../../etc/x.jpg`, `assets/${ws}/sub/x.jpg`];
    for (const key of bad) await insertImageAsset(ws, 'AT3', key);
    // Even a 'ready' row recorded directly for a bad key must not surface.
    await query(`INSERT INTO storage_derivatives (source_key, variant, derivative_key, status) VALUES ($1, 't512', 'derived/legacy/uploads/x.jpg/t512.webp', 'ready')`, [bad[0]]);
    for (const a of await list('AT3', ws)) expect(a.thumb_url).toBeNull();
  });

  it('6: link assets keep their external URL untouched and get no thumbnail', async () => {
    const ws = await workspace('AT4');
    const ext = 'https://www.figma.com/file/AbC123/Moodboard?node-id=1-2';
    const res = await request(app).post('/api/assets/links').set(auth('AT4')).send({ workspace_id: ws, url: ext, name: 'Figma' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ url: null, thumb_url: null });
    expect(res.body.link_url).toContain('figma.com/file/AbC123');
    const [a] = await list('AT4', ws);
    expect(a).toMatchObject({ link_url: res.body.link_url, url: null, thumb_url: null }); // external URL passed through as stored
  });

  it('14: SVG images and general files keep their original / download URLs and get no thumbnail', async () => {
    const ws = await workspace('AT5');
    const svg = await request(app).post('/api/assets').set(auth('AT5')).field('workspace_id', ws).attach('file', SVG, { filename: 'v.svg', contentType: 'image/svg+xml' });
    const pdf = await request(app).post('/api/assets').set(auth('AT5')).field('workspace_id', ws).field('kind', 'file').attach('file', Buffer.from('%PDF-1.4'), { filename: 'brief.pdf', contentType: 'application/pdf' });
    await settleDerivativeJobs();
    const rows = await list('AT5', ws);
    expect(rows.find(r => r.id === svg.body.id)).toMatchObject({ url: PUBLIC + `assets/${ws}/${svg.body.id}.svg`, thumb_url: null });
    expect(rows.find(r => r.id === pdf.body.id)).toMatchObject({ url: PUBLIC + `assets/${ws}/${pdf.body.id}.pdf?download=brief.pdf`, thumb_url: null });
  });

  it('8: thumb_url is never persisted', async () => {
    const ws = await workspace('AT6');
    await request(app).post('/api/assets').set(auth('AT6')).field('workspace_id', ws).attach('file', await jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' });
    await settleDerivativeJobs();
    expect((await list('AT6', ws))[0].thumb_url).toBeTruthy();
    const cols = (await query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'assets'`)).map(r => r.column_name);
    expect(cols).not.toContain('thumb_url');
    const stored = await query(`SELECT * FROM assets`);
    expect(JSON.stringify(stored)).not.toContain('derived/');
  });

  it('9: a page of many assets makes ONE derivative lookup (no N+1)', async () => {
    const ws = await workspace('AT7');
    for (let i = 0; i < 12; i++) {
      const key = `assets/${ws}/img${i}.jpg`;
      await insertImageAsset(ws, 'AT7', key);
      if (i % 2) await recordDerivative(key, 't512', { status: 'ready', width: 683, height: 512, bytes: 1 });
    }
    const original = pool.query.bind(pool);
    let derivativeQueries = 0;
    vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
      if (typeof args[0] === 'string' && /FROM storage_derivatives/.test(args[0])) derivativeQueries++;
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as never);
    const rows = await list('AT7', ws, '&limit=40');
    expect(rows).toHaveLength(12);
    expect(rows.filter(r => r.thumb_url)).toHaveLength(6);
    expect(derivativeQueries).toBe(1);
  });
});

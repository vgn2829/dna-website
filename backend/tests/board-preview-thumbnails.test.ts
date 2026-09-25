import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query, pool } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import type { StorageProvider, StoredObject } from '../src/storage';
import { derivativeKey, recordDerivative } from '../src/storage/derivatives';
import { withPreviewThumbnails } from '../src/lib/boardPreviewThumbnails';

// ─────────────────────────────────────────────────────────────────────────
// V3.2.5 — board LIST responses carry a read-time `preview_thumbnails`
// map (original preview image src → ready t512 thumbnail URL) built with
// one batched derivative lookup. canvas_preview itself is returned and
// stored unchanged.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const PUBLIC = 'http://storage.test/public/';

class MemoryStorage implements StorageProvider {
  async upload() {}
  async download(): Promise<Buffer> { throw new Error('unused'); }
  getPublicUrl(p: string) { return PUBLIC + p; }
  async delete() {}
  async list(): Promise<StoredObject[]> { return []; }
}

const img = (src: string, x = 0) => ({ k: 'image', x, y: 0, r: 0, w: 100, h: 80, src });
const geo = { k: 'geo', x: 0, y: 0, r: 0, w: 10, h: 10, c: 'blue', g: 'rectangle' };
const preview = (items: unknown[]) => ({ v: 1, x: 0, y: 0, w: 500, h: 300, items });

async function registerStudent(roll: string) {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]);
}
async function setup(roll: string) {
  await registerStudent(roll);
  const ws = (await request(app).post('/api/workspaces').set(auth(roll)).send({ name: 'P' })).body.id as string;
  return ws;
}
async function board(roll: string, ws: string, items: unknown[], opts: { visibility?: string; archived?: boolean; projectId?: string } = {}) {
  const id = uuidv4(); const now = new Date().toISOString();
  await query(`INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id, project_id, canvas_item_count, canvas_preview)
               VALUES ($1, 'B', $2, 'O', $3, 'members_only', $4, $4, $5, $6, $7, $8, $9, $10)`,
    [id, roll, opts.visibility ?? 'private', now, `room-${id}`, opts.archived ?? false, ws, opts.projectId ?? null, items.length, JSON.stringify(preview(items))]);
  return id;
}
const ready = (key: string) => recordDerivative(key, 't512', { status: 'ready', width: 683, height: 512, bytes: 1 });
const listMine = async (roll: string) => (await request(app).get('/api/boards').set(auth(roll))).body as Array<Record<string, any>>;

beforeEach(async () => {
  await query('TRUNCATE "storage_derivatives", "board_items", "board_members", "board_favorites", "boards", "projects", "templates", "workspace_members", "workspaces" CASCADE');
  vi.spyOn(storageModule, 'getStorage').mockReturnValue(new MemoryStorage());
});
afterEach(() => { vi.restoreAllMocks(); });

describe('board list preview_thumbnails', () => {
  it('1-4, 11, 17: maps ready managed asset + canvas-file sources; external and unready sources are absent (mixed board)', async () => {
    const ws = await setup('BP1');
    const assetKey = `assets/${ws}/a1.jpg`, canvasKey = `canvas-files/${uuidv4()}/c1.png`, unreadyKey = `assets/${ws}/u1.jpg`;
    await ready(assetKey); await ready(canvasKey);
    const EXT = 'https://images.example.com/photo.jpg';
    const items = [img(PUBLIC + assetKey), geo, img(EXT, 50), img(PUBLIC + canvasKey, 100), img(PUBLIC + unreadyKey, 150)];
    const id = await board('BP1', ws, items);
    const [b] = await listMine('BP1');
    expect(b.id).toBe(id);
    expect(b.preview_thumbnails).toEqual({
      [PUBLIC + assetKey]: PUBLIC + derivativeKey(assetKey),
      [PUBLIC + canvasKey]: PUBLIC + derivativeKey(canvasKey),
    });
    expect(b.canvas_preview).toEqual(preview(items)); // 15: returned unchanged
  });

  it('5-10: SVG, malformed managed URLs and missing / failed / skipped derivatives are never mapped', async () => {
    const ws = await setup('BP2');
    const svgKey = `assets/${ws}/v.svg`, failedKey = `assets/${ws}/f.jpg`, skippedKey = `assets/${ws}/s.gif`, missingKey = `assets/${ws}/m.jpg`;
    await recordDerivative(failedKey, 't512', { status: 'failed', error: 'x' });
    await recordDerivative(skippedKey, 't512', { status: 'skipped', error: 'animated' });
    const malformed = [`${PUBLIC}assets/${ws}/../../etc/x.jpg`, `${PUBLIC}assets/${ws}/sub/x.jpg`, `${PUBLIC}thumbs/x.jpg`, `${PUBLIC}derived/assets/${ws}/f.jpg/t512.webp`];
    const items = [img(PUBLIC + svgKey), img(PUBLIC + failedKey), img(PUBLIC + skippedKey), img(PUBLIC + missingKey), ...malformed.map(u => img(u))];
    await board('BP2', ws, items);
    const [b] = await listMine('BP2');
    expect(b.preview_thumbnails).toEqual({});
    expect(b.canvas_preview.items.map((i: { src: string }) => i.src)).toEqual(items.map(i => i.src));
  });

  it('6: data/base64 and non-http sources are ignored by the mapper', async () => {
    const [out] = await withPreviewThumbnails([{ canvas_preview: preview([img('data:image/png;base64,AAAA'), img('blob:http://x/1'), img('')]) }]);
    expect(out.preview_thumbnails).toEqual({});
  });

  it('12: a ready derivative only maps its EXACT source key', async () => {
    const ws = await setup('BP3');
    await ready(`assets/${ws}/real.jpg`);
    await board('BP3', ws, [img(`${PUBLIC}assets/${ws}/real.jpeg`), img(`${PUBLIC}assets/${ws}/REAL.jpg`), img(`${PUBLIC}assets/other/real.jpg`), img(`${PUBLIC}assets/${ws}/real.jpg?v=2`)]);
    const [b] = await listMine('BP3');
    expect(b.preview_thumbnails).toEqual({});
  });

  it('13-14: duplicate sources across boards are deduplicated into ONE derivative lookup for the whole response', async () => {
    const ws = await setup('BP4');
    const shared = `assets/${ws}/shared.jpg`;
    await ready(shared);
    for (let i = 0; i < 10; i++) {
      const key = `assets/${ws}/b${i}.jpg`;
      if (i % 2) await ready(key);
      await board('BP4', ws, [img(PUBLIC + shared), img(PUBLIC + key, 60), img(PUBLIC + shared, 120)]);
    }
    const original = pool.query.bind(pool);
    const lookups: unknown[][] = [];
    vi.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
      if (typeof args[0] === 'string' && /FROM storage_derivatives/.test(args[0])) lookups.push(args[1] as unknown[]);
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as never);
    const boards = await listMine('BP4');
    expect(boards).toHaveLength(10);
    expect(lookups).toHaveLength(1);
    expect((lookups[0][1] as string[]).filter(k => k === shared)).toHaveLength(1); // deduplicated
    for (const b of boards) expect(b.preview_thumbnails[PUBLIC + shared]).toBe(PUBLIC + derivativeKey(shared));
    expect(boards.filter(b => Object.keys(b.preview_thumbnails).length === 2)).toHaveLength(5);
  });

  it('15-16: the stored canvas_preview is unchanged and no thumbnail URL is persisted', async () => {
    const ws = await setup('BP5');
    const key = `assets/${ws}/p.jpg`; await ready(key);
    const id = await board('BP5', ws, [img(PUBLIC + key)]);
    const before = (await query<{ canvas_preview: string }>('SELECT canvas_preview FROM boards WHERE id = $1', [id]))[0].canvas_preview;
    const [b] = await listMine('BP5');
    expect(b.preview_thumbnails[PUBLIC + key]).toContain('derived/');
    const after = (await query<{ canvas_preview: string }>('SELECT canvas_preview FROM boards WHERE id = $1', [id]))[0].canvas_preview;
    expect(after).toBe(before);
    expect(after).not.toContain('derived/');
    const cols = (await query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'boards'`)).map(r => r.column_name);
    expect(cols).not.toContain('preview_thumbnails');
    expect(JSON.stringify(await query('SELECT canvas_data, canvas_preview FROM boards UNION ALL SELECT canvas_data, NULL FROM templates'))).not.toContain('derived/');
  });

  it('every board LIST endpoint carries preview_thumbnails (mine, workspace, shared, archived, project)', async () => {
    const ws = await setup('BP6');
    const key = `assets/${ws}/l.jpg`; await ready(key);
    const project = await request(app).post('/api/projects').set(auth('BP6')).send({ name: 'P', workspace_id: ws });
    await board('BP6', ws, [img(PUBLIC + key)], { visibility: 'shared', projectId: project.body.id });
    await board('BP6', ws, [img(PUBLIC + key)], { archived: true });
    const expected = { [PUBLIC + key]: PUBLIC + derivativeKey(key) };
    for (const path of ['/api/boards', `/api/boards?workspace_id=${ws}`, '/api/boards/shared', `/api/boards/shared?workspace_id=${ws}`, '/api/boards/archived', `/api/projects/${project.body.id}/boards`]) {
      const res = await request(app).get(path).set(auth('BP6'));
      expect(res.status, path).toBe(200);
      expect(res.body.length, path).toBeGreaterThan(0);
      for (const b of res.body) expect(b.preview_thumbnails, path).toEqual(expected);
    }
  });

  it('boards without images or previews get an empty map', async () => {
    const [a, b] = await withPreviewThumbnails([{ canvas_preview: null }, { canvas_preview: preview([geo]) }]);
    expect(a.preview_thumbnails).toEqual({});
    expect(b.preview_thumbnails).toEqual({});
  });
});

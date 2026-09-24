import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { summarizeCanvas, canvasSummaryColumns } from '../src/lib/canvasSummary';
import { BoardCanvasPersistence } from '../src/realtime/roomPersistence';
import { backfillCanvasSummaries } from '../src/db/schema';

// ─────────────────────────────────────────────────────────────────────────
// Moodboard card item count + preview (lib/canvasSummary.ts): unit tests
// over every snapshot shape this repo persists, then integration through
// the real routes / realtime persistence against the local test Postgres.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
const PAGE = 'page:page1';

type R = Record<string, unknown>;
const doc = (): R => ({ typeName: 'document', id: 'document:document', gridSize: 10, name: '' });
const page = (id = PAGE, index = 'a1'): R => ({ typeName: 'page', id, name: 'Page', index });
const geo = (id: string, x: number, y: number, extra: R = {}, parentId = PAGE, index = 'a1'): R => ({
  typeName: 'shape', type: 'geo', id: `shape:${id}`, x, y, rotation: 0, parentId, index,
  props: { w: 100, h: 50, geo: 'rectangle', color: 'blue', fill: 'solid', text: '', growY: 0, ...extra },
});

const room = (records: R[], tombstones: R = {}) => ({ clock: 5, tombstones, schema: {}, documents: records.map(state => ({ state, lastChangedClock: 1 })) });
const editorWrapper = (records: R[]) => ({ document: { store: Object.fromEntries(records.map(r => [r.id, r])), schema: {} }, session: {} });
const flatStore = (records: R[]) => ({ store: Object.fromEntries(records.map(r => [r.id, r])), schema: {} });

describe('summarizeCanvas — formats and counting', () => {
  it('treats empty / unrecognized snapshots as an empty board', () => {
    for (const snap of [null, {}, 'x', { documents: [] }, room([doc(), page()])]) {
      expect(summarizeCanvas(snap)).toEqual({ count: 0, placedItemIds: [], preview: null });
    }
  });

  it('counts shapes identically across RoomSnapshot, TLEditorSnapshot and flat TLStoreSnapshot', () => {
    const records = [doc(), page(), geo('a', 0, 0), geo('b', 200, 0, {}, PAGE, 'a2'), geo('c', 400, 100, {}, PAGE, 'a3')];
    for (const snap of [room(records), editorWrapper(records), flatStore(records)]) {
      const s = summarizeCanvas(snap);
      expect(s.count).toBe(3);
      expect(s.preview?.items).toHaveLength(3);
      expect(s.preview).toMatchObject({ x: 0, y: 0, w: 500, h: 150 });
    }
  });

  it('never counts non-visible records (document, page, camera, instance, presence, pointer, assets, bindings)', () => {
    const records = [
      doc(), page(),
      { typeName: 'camera', id: 'camera:1', x: 0, y: 0, z: 1 },
      { typeName: 'instance', id: 'instance:instance' },
      { typeName: 'instance_page_state', id: 'instance_page_state:1' },
      { typeName: 'instance_presence', id: 'instance_presence:1' },
      { typeName: 'pointer', id: 'pointer:pointer' },
      { typeName: 'asset', id: 'asset:1', type: 'image', props: { src: 'https://x/y.png' } },
      { typeName: 'binding', id: 'binding:1', type: 'arrow' },
      geo('only', 0, 0),
    ];
    expect(summarizeCanvas(room(records)).count).toBe(1);
  });

  it('does not count a deleted shape (present only as a tombstone)', () => {
    const s = summarizeCanvas(room([doc(), page(), geo('kept', 0, 0)], { 'shape:deleted': 4 }));
    expect(s.count).toBe(1);
  });

  it('excludes group containers but counts their children, across all pages', () => {
    const group: R = { typeName: 'shape', type: 'group', id: 'shape:g', x: 10, y: 10, rotation: 0, parentId: PAGE, index: 'a1', props: {} };
    const records = [doc(), page(), page('page:two', 'a2'), group, geo('c1', 0, 0, {}, 'shape:g', 'a1'), geo('c2', 50, 0, {}, 'shape:g', 'a2'), geo('p2', 0, 0, {}, 'page:two')];
    expect(summarizeCanvas(room(records)).count).toBe(3);
  });

  it('previews the page with the most content and resolves nested frame coordinates + rotation', () => {
    const frame: R = { typeName: 'shape', type: 'frame', id: 'shape:f', x: 1000, y: 500, rotation: 0, parentId: 'page:two', index: 'a1', props: { w: 400, h: 300, name: 'Frame' } };
    const rotated = geo('rot', 0, 0, {}, 'page:two', 'a3');
    rotated.rotation = Math.PI / 2;
    const records = [doc(), page(), page('page:two', 'a2'), geo('lonely', 0, 0), frame, geo('child', 20, 30, {}, 'shape:f', 'a1'), rotated];
    const s = summarizeCanvas(room(records));
    const items = s.preview!.items;
    expect(items.map(i => i.k)).toEqual(['frame', 'geo', 'geo']); // page:two, z-ordered, frame child after frame
    const child = items.find(i => i.x === 1020)!;
    expect(child).toMatchObject({ x: 1020, y: 530, w: 100, h: 50 });
    expect(items.find(i => i.r !== 0)!.r).toBeCloseTo(Math.PI / 2, 2);
  });

  it('describes images, text, notes, pen strokes and arrows for the preview', () => {
    const records = [
      doc(), page(),
      { typeName: 'asset', id: 'asset:img', type: 'image', props: { src: 'https://cdn.example.com/a.png', w: 10, h: 10 } },
      { typeName: 'asset', id: 'asset:legacy', type: 'image', props: { src: 'data:image/png;base64,AAAA', w: 10, h: 10 } },
      { typeName: 'shape', type: 'image', id: 'shape:i1', x: 0, y: 0, rotation: 0, parentId: PAGE, index: 'a1', props: { w: 300, h: 200, assetId: 'asset:img' } },
      { typeName: 'shape', type: 'image', id: 'shape:i2', x: 400, y: 0, rotation: 0, parentId: PAGE, index: 'a2', props: { w: 100, h: 100, assetId: 'asset:legacy' } },
      { typeName: 'shape', type: 'text', id: 'shape:t', x: 0, y: 300, rotation: 0, parentId: PAGE, index: 'a3', props: { w: 200, text: 'Hello\nmoodboard', size: 'm', color: 'black', scale: 1 } },
      { typeName: 'shape', type: 'note', id: 'shape:n', x: 300, y: 300, rotation: 0, parentId: PAGE, index: 'a4', props: { color: 'yellow', text: 'idea', growY: 0, scale: 1 } },
      { typeName: 'shape', type: 'draw', id: 'shape:d', x: 0, y: 600, rotation: 0, parentId: PAGE, index: 'a5', props: { color: 'red', size: 'm', segments: [{ type: 'free', points: Array.from({ length: 200 }, (_, i) => ({ x: i, y: i % 7, z: 0.5 })) }] } },
      { typeName: 'shape', type: 'arrow', id: 'shape:ar', x: 500, y: 600, rotation: 0, parentId: PAGE, index: 'a6', props: { color: 'black', size: 'm', start: { x: 0, y: 0 }, end: { x: 120, y: 40 } } },
    ];
    const s = summarizeCanvas(room(records));
    expect(s.count).toBe(6);
    const byKind = Object.fromEntries(s.preview!.items.map(i => [i.k + (i.src ? ':src' : ''), i]));
    expect(byKind['image:src'].src).toBe('https://cdn.example.com/a.png');
    expect(s.preview!.items.filter(i => i.k === 'image' && !i.src)).toHaveLength(1); // data: URI never embedded
    expect(byKind.text).toMatchObject({ t: 'Hello\nmoodboard', fs: 24 });
    expect(byKind.note).toMatchObject({ w: 200, h: 200, c: 'yellow', t: 'idea' });
    const paths = s.preview!.items.filter(i => i.k === 'path');
    expect(paths).toHaveLength(2);
    expect(paths[0].p!.length / 2).toBeLessThanOrEqual(41);
    expect(paths[1].p).toEqual([0, 0, 120, 40]);
    expect(JSON.stringify(s.preview).length).toBeLessThan(4000);
  });

  it('caps the preview at 80 primitives while still counting everything', () => {
    const records = [doc(), page(), ...Array.from({ length: 150 }, (_, i) => geo(`s${i}`, i * 10, 0, { w: 5 + i }, PAGE, `a${String(i).padStart(4, '0')}`))];
    const s = summarizeCanvas(room(records));
    expect(s.count).toBe(150);
    expect(s.preview!.items).toHaveLength(80);
  });

  it('records placed legacy board_items (shape:<uuid>) but not tldraw-generated ids', () => {
    const itemId = uuidv4();
    const s = summarizeCanvas(room([doc(), page(), geo('CLahdVR6RSyHO8FtlUb1g', 0, 0), geo(itemId, 50, 0)]));
    expect(s.placedItemIds).toEqual([`shape:${itemId}`]);
    expect(s.count).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration
// ─────────────────────────────────────────────────────────────────────────

async function registerStudent(roll: string) {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

async function createBoard(roll: string, workspaceId?: string) {
  const id = `board-${uuidv4()}`;
  const now = new Date().toISOString();
  let ws = workspaceId;
  if (!ws) {
    ws = `ws-${uuidv4()}`;
    await query(`INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, 'WS', true, $2, $3)`, [ws, roll, now]);
    await query(`INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'owner', 'Owner', $3)`, [ws, roll, now]);
  }
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id)
     VALUES ($1, 'Board', $2, 'Owner', 'private', 'members_only', $3, $3, $4, false, $5)`,
    [id, roll, now, `room-${id}`, ws]
  );
  return { id, ws, roomId: `room-${id}` };
}

const saveCanvas = (roll: string, id: string, snapshot: unknown) =>
  request(app).put(`/api/boards/${id}/canvas`).set(auth(roll)).send({ canvas_data: JSON.stringify(snapshot) });
const listBoards = async (roll: string, ws: string) =>
  (await request(app).get(`/api/boards?workspace_id=${ws}`).set(auth(roll))).body as Array<Record<string, unknown>>;

beforeEach(async () => {
  await query('TRUNCATE "board_items", "board_members", "board_favorites", "boards", "templates", "workspace_members", "workspaces" CASCADE');
});

describe('board list item_count + canvas_preview', () => {
  it('reflects manually saved canvas content, including deletions, and never ships canvas_data', async () => {
    await registerStudent('CS1');
    const { id, ws } = await createBoard('CS1');
    expect((await listBoards('CS1', ws))[0]).toMatchObject({ item_count: 0, canvas_preview: null });

    expect((await saveCanvas('CS1', id, editorWrapper([doc(), page(), geo('a', 0, 0), geo('b', 200, 0, {}, PAGE, 'a2')]))).status).toBe(200);
    let row = (await listBoards('CS1', ws))[0];
    expect(row.item_count).toBe(2);
    expect((row.canvas_preview as { items: unknown[] }).items).toHaveLength(2);
    expect(row).not.toHaveProperty('canvas_data');
    expect(row).not.toHaveProperty('canvas_placed_item_ids');

    await saveCanvas('CS1', id, editorWrapper([doc(), page(), geo('a', 0, 0)])); // one deleted
    row = (await listBoards('CS1', ws))[0];
    expect(row.item_count).toBe(1);

    await saveCanvas('CS1', id, editorWrapper([doc(), page()])); // emptied
    row = (await listBoards('CS1', ws))[0];
    expect(row).toMatchObject({ item_count: 0, canvas_preview: null });
  });

  it('updates from the realtime persistence path (RoomSnapshot)', async () => {
    await registerStudent('CS2');
    const { ws, roomId } = await createBoard('CS2');
    await new BoardCanvasPersistence().save(roomId, room([doc(), page(), geo('r1', 0, 0), geo('r2', 100, 100, {}, PAGE, 'a2'), geo('r3', 200, 200, {}, PAGE, 'a3')]) as never);
    const row = (await listBoards('CS2', ws))[0];
    expect(row.item_count).toBe(3);
    expect((row.canvas_preview as { items: unknown[] }).items).toHaveLength(3);
  });

  it('counts not-yet-placed gallery board_items, without double-counting once placed on the canvas', async () => {
    await registerStudent('CS3');
    const { id, ws } = await createBoard('CS3');
    const itemA = uuidv4();
    const itemB = uuidv4();
    for (const itemId of [itemA, itemB]) {
      await query(
        `INSERT INTO board_items (id, board_id, image_url, added_by_roll, created_at) VALUES ($1, $2, 'https://x/y.png', 'CS3', $3)`,
        [itemId, id, new Date().toISOString()]
      );
    }
    expect((await listBoards('CS3', ws))[0].item_count).toBe(2); // pending only

    // Opening the board places them as shape:<item id>, alongside one drawn shape.
    await saveCanvas('CS3', id, editorWrapper([doc(), page(), geo(itemA, 0, 0), geo(itemB, 100, 0, {}, PAGE, 'a2'), geo('drawn', 300, 0, {}, PAGE, 'a3')]));
    expect((await listBoards('CS3', ws))[0].item_count).toBe(3);
  });

  it('board detail no longer ships canvas_data; the canvas endpoint still serves it', async () => {
    await registerStudent('CS4');
    const { id } = await createBoard('CS4');
    const snapshot = editorWrapper([doc(), page(), geo('a', 0, 0)]);
    await saveCanvas('CS4', id, snapshot);
    const detail = await request(app).get(`/api/boards/${id}`).set(auth('CS4'));
    expect(detail.status).toBe(200);
    expect(detail.body).not.toHaveProperty('canvas_data');
    expect(detail.body.canvas_preview.items).toHaveLength(1);
    const canvas = await request(app).get(`/api/boards/${id}/canvas`).set(auth('CS4'));
    expect(JSON.parse(canvas.body.canvas_data)).toEqual(snapshot);
  });

  it('duplicates carry the copied content count/preview', async () => {
    await registerStudent('CS5');
    const { id, ws } = await createBoard('CS5');
    await saveCanvas('CS5', id, editorWrapper([doc(), page(), geo('a', 0, 0), geo('b', 100, 0, {}, PAGE, 'a2')]));
    const dup = await request(app).post(`/api/boards/${id}/duplicate`).set(auth('CS5'));
    expect(dup.status).toBe(201);
    expect(dup.body.item_count).toBe(2);
    expect(dup.body).not.toHaveProperty('canvas_data');
    const personal = (await request(app).get('/api/workspaces').set(auth('CS5'))).body as Array<{ id: string; is_personal: boolean }>;
    const lists = [...await listBoards('CS5', ws), ...await listBoards('CS5', personal.find(w => w.is_personal)!.id)];
    expect(lists.find(b => b.id === dup.body.id)!.item_count).toBe(2);
  });

  it('boards created from a template get the template content count', async () => {
    await registerStudent('CS6');
    const { id, ws } = await createBoard('CS6');
    await saveCanvas('CS6', id, editorWrapper([doc(), page(), geo('a', 0, 0), geo('b', 100, 0, {}, PAGE, 'a2'), geo('c', 200, 0, {}, PAGE, 'a3')]));
    const tpl = await request(app).post('/api/templates').set(auth('CS6')).send({ source_board_id: id, name: 'Tpl' });
    expect(tpl.status).toBe(201);
    const used = await request(app).post(`/api/templates/${tpl.body.id}/use`).set(auth('CS6')).send({});
    expect(used.status).toBe(201);
    expect(used.body.item_count).toBe(3);
    expect((await listBoards('CS6', ws)).find(b => b.id === used.body.id)!.item_count).toBe(3);
  });

  it('backfills boards written before the summary columns existed (idempotently)', async () => {
    await registerStudent('CS7');
    const { id, ws } = await createBoard('CS7');
    await query(`UPDATE boards SET canvas_data = $1, canvas_item_count = NULL, canvas_preview = NULL WHERE id = $2`,
      [JSON.stringify(room([doc(), page(), geo('old1', 0, 0), geo('old2', 50, 50, {}, PAGE, 'a2')])), id]);
    expect(await backfillCanvasSummaries()).toBeGreaterThanOrEqual(1);
    expect((await listBoards('CS7', ws))[0].item_count).toBe(2);
    expect(await backfillCanvasSummaries()).toBe(0);
  });

  it('only lists boards (and previews) the caller can access', async () => {
    await registerStudent('CS8');
    await registerStudent('CS9');
    const { id, ws } = await createBoard('CS8');
    await saveCanvas('CS8', id, editorWrapper([doc(), page(), geo('secret', 0, 0)]));
    const other = await request(app).get(`/api/boards?workspace_id=${ws}`).set(auth('CS9'));
    const rows = Array.isArray(other.body) ? other.body : [];
    expect(rows.find((b: { id: string }) => b.id === id)).toBeUndefined();
  });

  it('canvasSummaryColumns tolerates invalid JSON', () => {
    expect(canvasSummaryColumns('{not json')).toEqual({ canvas_item_count: 0, canvas_preview: null, canvas_placed_item_ids: [] });
  });
});

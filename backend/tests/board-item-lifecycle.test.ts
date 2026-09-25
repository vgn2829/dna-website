import { describe, it, expect, beforeEach } from 'vitest';
import { localRequest } from './localServer';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { BoardCanvasPersistence } from '../src/realtime/roomPersistence';
import { backfillBoardItemPlacement } from '../src/db/schema';

// ─────────────────────────────────────────────────────────────────────────
// Gallery item lifecycle (V3.1.1): board_items.placed_at goes NULL →
// timestamp the first time a SAVED canvas contains the item's shape
// (`shape:<board_items.id>`), through either the manual PUT /:id/canvas
// path or realtime persistence, and is never cleared. Only never-placed
// rows are pending (returned by the board endpoints, counted on cards),
// so a placed item whose shape the user later deletes stays deleted.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);
const PAGE = 'page:page1';
const PAGE2 = 'page:page2';

type R = Record<string, unknown>;
const doc = (): R => ({ typeName: 'document', id: 'document:document', gridSize: 10, name: '' });
const page = (id = PAGE, index = 'a1'): R => ({ typeName: 'page', id, name: 'Page', index });
const image = (itemId: string, parentId = PAGE, index = 'a1'): R => ({
  typeName: 'shape', type: 'image', id: `shape:${itemId}`, x: 0, y: 0, rotation: 0, parentId, index,
  props: { w: 100, h: 100, assetId: `asset:${itemId}`, url: '' },
});
const geo = (id: string, index = 'a9'): R => ({
  typeName: 'shape', type: 'geo', id: `shape:${id}`, x: 300, y: 0, rotation: 0, parentId: PAGE, index,
  props: { w: 100, h: 50, geo: 'rectangle', color: 'blue', fill: 'solid', text: '', growY: 0 },
});
// Manual path persists tldraw's TLEditorSnapshot; realtime persists a RoomSnapshot.
const editorSnapshot = (records: R[]) => ({ document: { store: Object.fromEntries(records.map(r => [r.id, r])), schema: {} }, session: {} });
const roomSnapshot = (records: R[], tombstones: R = {}) => ({ clock: 5, tombstones, schema: {}, documents: records.map(state => ({ state, lastChangedClock: 1 })) });

async function registerStudent(roll: string) {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

async function createBoard(roll: string) {
  await registerStudent(roll);
  const id = `board-${uuidv4()}`;
  const ws = `ws-${uuidv4()}`;
  const now = new Date().toISOString();
  await query(`INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, 'WS', true, $2, $3)`, [ws, roll, now]);
  await query(`INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'owner', 'Owner', $3)`, [ws, roll, now]);
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id)
     VALUES ($1, 'Board', $2, 'Owner', 'private', 'members_only', $3, $3, $4, false, $5)`,
    [id, roll, now, `room-${id}`, ws]
  );
  return { id, ws, roomId: `room-${id}` };
}

// The real Gallery "Save to Moodboard" path.
async function saveToMoodboard(roll: string, boardId: string): Promise<string> {
  const res = await request(app).post(`/api/boards/${boardId}/items`).set(auth(roll)).send({ image_url: 'https://example.com/art.png', note: 'from gallery' });
  expect(res.status).toBe(201);
  expect(res.body.placed_at).toBeNull();
  return res.body.id as string;
}

const saveCanvas = async (roll: string, id: string, records: R[]) => {
  const res = await request(app).put(`/api/boards/${id}/canvas`).set(auth(roll)).send({ canvas_data: JSON.stringify(editorSnapshot(records)) });
  expect(res.status).toBe(200);
};
const placedAt = async (itemId: string) =>
  ((await query('SELECT placed_at FROM board_items WHERE id = $1', [itemId]))[0] as { placed_at: Date | null }).placed_at;
const pendingIds = async (roll: string, boardId: string) => {
  const res = await request(app).get(`/api/boards/${boardId}`).set(auth(roll));
  expect(res.status).toBe(200);
  return (res.body.items as Array<{ id: string }>).map(i => i.id).sort();
};
const cardCount = async (roll: string, ws: string, boardId: string) => {
  const rows = (await request(app).get(`/api/boards?workspace_id=${ws}`).set(auth(roll))).body as Array<{ id: string; item_count: number }>;
  return rows.find(b => b.id === boardId)!.item_count;
};
const itemRowCount = async (boardId: string) =>
  Number(((await query('SELECT COUNT(*)::int AS n FROM board_items WHERE board_id = $1', [boardId]))[0] as { n: number }).n);

beforeEach(async () => {
  await query('TRUNCATE "board_items", "board_members", "board_favorites", "boards", "templates", "workspace_members", "workspaces" CASCADE');
});

describe('Gallery item lifecycle — board_items.placed_at', () => {
  it('manual save marks a placed item (and only on a save that contains its shape)', async () => {
    const { id } = await createBoard('BL1');
    const item = await saveToMoodboard('BL1', id);

    await saveCanvas('BL1', id, [doc(), page(), geo('drawn')]); // item not on this canvas
    expect(await placedAt(item)).toBeNull();

    await saveCanvas('BL1', id, [doc(), page(), image(item), geo('drawn')]);
    expect(await placedAt(item)).toBeInstanceOf(Date);
  });

  it('realtime persistence marks a placed item', async () => {
    const { id, roomId } = await createBoard('BL2');
    const item = await saveToMoodboard('BL2', id);
    await new BoardCanvasPersistence().save(roomId, roomSnapshot([doc(), page(), image(item)]) as never);
    expect(await placedAt(item)).toBeInstanceOf(Date);
  });

  it('deleting a placed shape does not reset placement — manual and realtime', async () => {
    const manual = await createBoard('BL3');
    const m = await saveToMoodboard('BL3', manual.id);
    await saveCanvas('BL3', manual.id, [doc(), page(), image(m)]);
    const firstPlacedAt = await placedAt(m);
    expect(firstPlacedAt).toBeInstanceOf(Date);
    await saveCanvas('BL3', manual.id, [doc(), page()]); // user deleted the shape
    expect(await placedAt(m)).toEqual(firstPlacedAt);
    expect(await pendingIds('BL3', manual.id)).toEqual([]);

    const rt = await createBoard('BL3');
    const r = await saveToMoodboard('BL3', rt.id);
    const persistence = new BoardCanvasPersistence();
    await persistence.save(rt.roomId, roomSnapshot([doc(), page(), image(r)]) as never);
    const rtPlacedAt = await placedAt(r);
    await persistence.save(rt.roomId, roomSnapshot([doc(), page()], { [`shape:${r}`]: 5 }) as never);
    expect(await placedAt(r)).toEqual(rtPlacedAt);
    expect(await pendingIds('BL3', rt.id)).toEqual([]);
  });

  it('GET /boards/:id and /boards/:id/items exclude placed items and keep unplaced ones pending', async () => {
    const { id } = await createBoard('BL4');
    const placed = await saveToMoodboard('BL4', id);
    const unplaced = await saveToMoodboard('BL4', id);
    expect(await pendingIds('BL4', id)).toEqual([placed, unplaced].sort());

    await saveCanvas('BL4', id, [doc(), page(), image(placed)]);
    expect(await pendingIds('BL4', id)).toEqual([unplaced]);
    const items = await request(app).get(`/api/boards/${id}/items`).set(auth('BL4'));
    expect(items.status).toBe(200);
    expect((items.body as Array<{ id: string }>).map(i => i.id)).toEqual([unplaced]);
    expect(await placedAt(unplaced)).toBeNull();
    expect(await itemRowCount(id)).toBe(2); // never deleted
  });

  it('card item_count counts only never-placed items, and a deleted placed shape does not count again', async () => {
    const { id, ws } = await createBoard('BL5');
    const item = await saveToMoodboard('BL5', id);
    expect(await cardCount('BL5', ws, id)).toBe(1); // pending

    await saveCanvas('BL5', id, [doc(), page(), image(item), geo('drawn')]);
    expect(await cardCount('BL5', ws, id)).toBe(2); // two canvas shapes, nothing pending

    await saveCanvas('BL5', id, [doc(), page(), geo('drawn')]); // item's shape deleted
    expect(await cardCount('BL5', ws, id)).toBe(1); // only the drawn shape — previously 2
  });

  it('multiple items: placing A leaves only B pending and countable', async () => {
    const { id, ws } = await createBoard('BL6');
    const a = await saveToMoodboard('BL6', id);
    const b = await saveToMoodboard('BL6', id);
    await saveCanvas('BL6', id, [doc(), page(), image(a)]);
    await saveCanvas('BL6', id, [doc(), page()]); // A deleted afterwards
    expect(await pendingIds('BL6', id)).toEqual([b]);
    expect(await cardCount('BL6', ws, id)).toBe(1);
    expect(await placedAt(a)).toBeInstanceOf(Date);
    expect(await placedAt(b)).toBeNull();
  });

  it('multiple pages: an item moved to another page stays placed and is not pending', async () => {
    const { id, ws } = await createBoard('BL7');
    const item = await saveToMoodboard('BL7', id);
    await saveCanvas('BL7', id, [doc(), page(), page(PAGE2, 'a2'), image(item, PAGE)]);
    const first = await placedAt(item);
    await saveCanvas('BL7', id, [doc(), page(), page(PAGE2, 'a2'), image(item, PAGE2)]);
    expect(await placedAt(item)).toEqual(first);
    expect(await pendingIds('BL7', id)).toEqual([]);
    expect(await cardCount('BL7', ws, id)).toBe(1); // the one shape, counted once

    // Placement on a non-first page counts as placement too.
    const other = await createBoard('BL7');
    const onPage2 = await saveToMoodboard('BL7', other.id);
    await saveCanvas('BL7', other.id, [doc(), page(), page(PAGE2, 'a2'), image(onPage2, PAGE2)]);
    expect(await placedAt(onPage2)).toBeInstanceOf(Date);
  });

  it('backfill marks rows already on the saved canvas, leaves the rest NULL, and is idempotent', async () => {
    const { id, ws } = await createBoard('BL8');
    const onCanvas = await saveToMoodboard('BL8', id);
    const notOnCanvas = await saveToMoodboard('BL8', id);
    await saveCanvas('BL8', id, [doc(), page(), page(PAGE2, 'a2'), image(onCanvas, PAGE2)]);
    // Simulate rows written before placed_at existed.
    await query('UPDATE board_items SET placed_at = NULL WHERE board_id = $1', [id]);
    const canvasBefore = ((await query('SELECT canvas_data FROM boards WHERE id = $1', [id]))[0] as { canvas_data: string }).canvas_data;

    expect(await backfillBoardItemPlacement()).toBe(1);
    const firstPlacedAt = await placedAt(onCanvas);
    expect(firstPlacedAt).toBeInstanceOf(Date);
    expect(await placedAt(notOnCanvas)).toBeNull();

    expect(await backfillBoardItemPlacement()).toBe(0);
    expect(await placedAt(onCanvas)).toEqual(firstPlacedAt);
    expect(await placedAt(notOnCanvas)).toBeNull();
    expect(await itemRowCount(id)).toBe(2);
    expect(((await query('SELECT canvas_data FROM boards WHERE id = $1', [id]))[0] as { canvas_data: string }).canvas_data).toBe(canvasBefore);
    expect(await pendingIds('BL8', id)).toEqual([notOnCanvas]);
    expect(await cardCount('BL8', ws, id)).toBe(2);
  });

  it('duplicate: copies the canvas (incl. placed item shapes) but no board_items; source lifecycle unchanged', async () => {
    const { id } = await createBoard('BL9');
    const placed = await saveToMoodboard('BL9', id);
    const unplaced = await saveToMoodboard('BL9', id);
    await saveCanvas('BL9', id, [doc(), page(), image(placed)]);

    const dup = await request(app).post(`/api/boards/${id}/duplicate`).set(auth('BL9'));
    expect(dup.status).toBe(201);
    expect(dup.body.item_count).toBe(1);
    expect(await itemRowCount(dup.body.id)).toBe(0);
    expect(await pendingIds('BL9', dup.body.id)).toEqual([]);
    expect(await pendingIds('BL9', id)).toEqual([unplaced]);
    expect(await placedAt(placed)).toBeInstanceOf(Date);
  });

  it('template-created board: copies template content, no board_items', async () => {
    const { id } = await createBoard('BL10');
    const placed = await saveToMoodboard('BL10', id);
    await saveToMoodboard('BL10', id); // unplaced, must not leak into the template board
    await saveCanvas('BL10', id, [doc(), page(), image(placed), geo('drawn')]);

    const tpl = await request(app).post('/api/templates').set(auth('BL10')).send({ source_board_id: id, name: 'Tpl' });
    expect(tpl.status).toBe(201);
    const used = await request(app).post(`/api/templates/${tpl.body.id}/use`).set(auth('BL10')).send({});
    expect(used.status).toBe(201);
    expect(used.body.item_count).toBe(2);
    expect(await itemRowCount(used.body.id)).toBe(0);
    expect(await pendingIds('BL10', used.body.id)).toEqual([]);
  });
});

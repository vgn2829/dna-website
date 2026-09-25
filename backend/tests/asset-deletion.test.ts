import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { BoardCanvasPersistence } from '../src/realtime/roomPersistence';
import { createVersion } from '../src/realtime/history/versionStorage';

// ─────────────────────────────────────────────────────────────────────────
// Asset deletion vs. the shared-file model (V3.0).
//
// Inserting a library image onto a board stores the asset's public URL as
// the tldraw image src (plus meta.sourceAssetId) — no file copy — and that
// URL is carried into versions, templates, template-created boards and
// duplicates. Deleting the library asset must therefore remove its
// DATABASE ROW but keep its STORAGE OBJECT while any persisted content
// still references it, and delete the object only when nothing does.
//
// Three separate states are asserted independently: the assets row, the
// object on disk (the real LocalStorageProvider — SUPABASE_* is unset in
// tests), and the persisted canvas reference. Every step goes through the
// real routes / persistence functions.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

async function createWorkspace(roll: string, name: string): Promise<string> {
  const res = await request(app).post('/api/workspaces').set(auth(roll)).send({ name });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function addWorkspaceMember(workspaceId: string, roll: string): Promise<void> {
  await registerStudent(roll);
  await query(
    `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'member', $3, $4)`,
    [workspaceId, roll, `Student ${roll}`, new Date().toISOString()]
  );
}

interface UploadedAsset { id: string; url: string; storageKey: string }

async function uploadImage(roll: string, workspaceId: string, filename = 'logo.png'): Promise<UploadedAsset> {
  const res = await request(app).post('/api/assets').set(auth(roll))
    .field('workspace_id', workspaceId)
    .attach('file', PNG_1PX, { filename, contentType: 'image/png' });
  expect(res.status).toBe(201);
  const row = (await query<{ storage_key: string }>('SELECT storage_key FROM assets WHERE id = $1', [res.body.id]))[0];
  return { id: res.body.id, url: res.body.url, storageKey: row.storage_key };
}

async function createBoard(roll: string, workspaceId: string, name = 'Board'): Promise<{ id: string; roomId: string }> {
  const res = await request(app).post('/api/boards').set(auth(roll)).send({ name, workspace_id: workspaceId });
  expect(res.status).toBe(201);
  return { id: res.body.id, roomId: res.body.room_id };
}

const objectExists = (key: string) => fs.existsSync(path.join(UPLOADS_DIR, key));
const assetRowExists = async (id: string) => (await query('SELECT 1 FROM assets WHERE id = $1', [id])).length > 0;

// The records insertImageAsset (src/app/pages/tldrawCanvasShared.ts)
// creates: an image TLAsset whose props.src is the library URL and whose
// meta carries sourceAssetId, plus the image shape.
function imageRecords(asset: UploadedAsset) {
  const uid = uuidv4().replace(/-/g, '').slice(0, 21);
  return [
    { typeName: 'asset', id: `asset:${uid}`, type: 'image', meta: { sourceAssetId: asset.id },
      props: { w: 1, h: 1, name: 'logo.png', src: asset.url, mimeType: null, isAnimated: false } },
    { typeName: 'shape', type: 'image', id: `shape:${uid}`, x: 0, y: 0, rotation: 0, parentId: 'page:page', index: 'a1',
      props: { w: 1, h: 1, assetId: `asset:${uid}`, url: '' } },
  ];
}
const baseRecords = () => [
  { typeName: 'document', id: 'document:document', gridSize: 10, name: '' },
  { typeName: 'page', id: 'page:page', name: 'Page 1', index: 'a1' },
];
// Manual-save format (TldrawCanvas.tsx → getSnapshot → PUT /:id/canvas).
const editorSnapshot = (records: object[]) => ({
  document: { store: Object.fromEntries((records as Array<{ id: string }>).map(r => [r.id, r])), schema: {} },
  session: {},
});
// Realtime format (TLSocketRoom → BoardCanvasPersistence.save).
const roomSnapshot = (records: object[]) => ({
  clock: 3, tombstones: {}, schema: {}, documents: records.map(state => ({ state, lastChangedClock: 1 })),
});

async function saveCanvas(roll: string, boardId: string, snapshot: object) {
  const res = await request(app).put(`/api/boards/${boardId}/canvas`).set(auth(roll)).send({ canvas_data: JSON.stringify(snapshot) });
  expect(res.status).toBe(200);
}
const deleteAsset = (roll: string, id: string) => request(app).delete(`/api/assets/${id}`).set(auth(roll));
const canvasOf = async (roll: string, boardId: string) =>
  ((await request(app).get(`/api/boards/${boardId}/canvas`).set(auth(roll))).body.canvas_data as string) ?? '';

beforeEach(async () => {
  await query('TRUNCATE "board_items", "board_versions", "board_members", "board_favorites", "boards", "templates", "assets", "workspace_members", "workspaces" CASCADE');
});

describe('asset deletion respects persisted references (shared-file model)', () => {
  it('TEST 1 — an unused asset: row and storage object are both deleted', async () => {
    await registerStudent('AD1');
    const ws = await createWorkspace('AD1', 'Design');
    const asset = await uploadImage('AD1', ws);
    expect(objectExists(asset.storageKey)).toBe(true);

    const res = await deleteAsset('AD1', asset.id);
    expect(res.status).toBe(200);
    expect(await assetRowExists(asset.id)).toBe(false);
    expect(objectExists(asset.storageKey)).toBe(false);
  });

  it('TEST 2 — used by one live board (manual save): row deleted, object kept, canvas URL unchanged', async () => {
    await registerStudent('AD2');
    const ws = await createWorkspace('AD2', 'Design');
    const asset = await uploadImage('AD2', ws);
    const board = await createBoard('AD2', ws);
    await saveCanvas('AD2', board.id, editorSnapshot([...baseRecords(), ...imageRecords(asset)]));
    const before = await canvasOf('AD2', board.id);
    expect(before).toContain(asset.url);
    expect(before).toContain(asset.id); // meta.sourceAssetId

    const res = await deleteAsset('AD2', asset.id);
    expect(res.status).toBe(200);
    expect(await assetRowExists(asset.id)).toBe(false);
    expect(objectExists(asset.storageKey)).toBe(true);
    expect(await canvasOf('AD2', board.id)).toBe(before); // not rewritten
  });

  it('TEST 2b — used by a realtime board (RoomSnapshot persistence): object kept', async () => {
    await registerStudent('AD2R');
    const ws = await createWorkspace('AD2R', 'Design');
    const asset = await uploadImage('AD2R', ws);
    const board = await createBoard('AD2R', ws);
    await new BoardCanvasPersistence().save(board.roomId, roomSnapshot([...baseRecords(), ...imageRecords(asset)]) as never);

    expect((await deleteAsset('AD2R', asset.id)).status).toBe(200);
    expect(await assetRowExists(asset.id)).toBe(false);
    expect(objectExists(asset.storageKey)).toBe(true);
    expect(await canvasOf('AD2R', board.id)).toContain(asset.url);
  });

  it('TEST 3 — used by two boards: object kept', async () => {
    await registerStudent('AD3');
    const ws = await createWorkspace('AD3', 'Design');
    const asset = await uploadImage('AD3', ws);
    for (const name of ['One', 'Two']) {
      const board = await createBoard('AD3', ws, name);
      await saveCanvas('AD3', board.id, editorSnapshot([...baseRecords(), ...imageRecords(asset)]));
    }
    expect((await deleteAsset('AD3', asset.id)).status).toBe(200);
    expect(await assetRowExists(asset.id)).toBe(false);
    expect(objectExists(asset.storageKey)).toBe(true);
  });

  it('TEST 4 — referenced only by a template (its source board deleted): object kept', async () => {
    await registerStudent('AD4');
    const ws = await createWorkspace('AD4', 'Design');
    const asset = await uploadImage('AD4', ws);
    const board = await createBoard('AD4', ws);
    await saveCanvas('AD4', board.id, editorSnapshot([...baseRecords(), ...imageRecords(asset)]));
    const tpl = await request(app).post('/api/templates').set(auth('AD4')).send({ source_board_id: board.id, name: 'Kit' });
    expect(tpl.status).toBe(201);
    expect((await request(app).delete(`/api/boards/${board.id}`).set(auth('AD4'))).status).toBe(200);

    expect((await deleteAsset('AD4', asset.id)).status).toBe(200);
    expect(objectExists(asset.storageKey)).toBe(true);
    // …and a board created from that template afterwards still points at a live file.
    const used = await request(app).post(`/api/templates/${tpl.body.id}/use`).set(auth('AD4')).send({});
    expect(used.status).toBe(201);
    expect(await canvasOf('AD4', used.body.id)).toContain(asset.url);
    expect(objectExists(asset.storageKey)).toBe(true);
  });

  it('TEST 5 — referenced only by a version snapshot (image later removed from the live canvas): object kept', async () => {
    await registerStudent('AD5');
    const ws = await createWorkspace('AD5', 'Design');
    const asset = await uploadImage('AD5', ws);
    const board = await createBoard('AD5', ws);
    await createVersion({
      boardId: board.id, snapshot: roomSnapshot([...baseRecords(), ...imageRecords(asset)]) as never,
      createdByRoll: 'AD5', createdByName: 'Student AD5', trigger: 'explicit',
    });
    await saveCanvas('AD5', board.id, editorSnapshot(baseRecords())); // image removed live

    expect((await deleteAsset('AD5', asset.id)).status).toBe(200);
    expect(await assetRowExists(asset.id)).toBe(false);
    expect(objectExists(asset.storageKey)).toBe(true);
  });

  it('TEST 6 + 9 — a duplicate in another workspace keeps the object alive after the original board is gone', async () => {
    await registerStudent('AD6');
    const team = await createWorkspace('AD6', 'Team');
    await addWorkspaceMember(team, 'AD6M');
    const asset = await uploadImage('AD6', team);
    const board = await createBoard('AD6', team);
    await saveCanvas('AD6', board.id, editorSnapshot([...baseRecords(), ...imageRecords(asset)]));
    await query(`INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1, 'AD6M', 'Student AD6M', $2)`, [board.id, new Date().toISOString()]);

    // The real duplicate route places the copy in the DUPLICATOR's personal workspace.
    const dup = await request(app).post(`/api/boards/${board.id}/duplicate`).set(auth('AD6M'));
    expect(dup.status).toBe(201);
    expect(dup.body.workspace_id).not.toBe(team);
    expect(await canvasOf('AD6M', dup.body.id)).toContain(asset.url);

    expect((await request(app).delete(`/api/boards/${board.id}`).set(auth('AD6'))).status).toBe(200);
    expect((await deleteAsset('AD6', asset.id)).status).toBe(200);
    expect(await assetRowExists(asset.id)).toBe(false);
    expect(objectExists(asset.storageKey)).toBe(true);
    expect(await canvasOf('AD6M', dup.body.id)).toContain(asset.url);
  });

  it('archived boards still count as references', async () => {
    await registerStudent('ADA');
    const ws = await createWorkspace('ADA', 'Design');
    const asset = await uploadImage('ADA', ws);
    const board = await createBoard('ADA', ws);
    await saveCanvas('ADA', board.id, editorSnapshot([...baseRecords(), ...imageRecords(asset)]));
    expect((await request(app).put(`/api/boards/${board.id}`).set(auth('ADA')).send({ is_archived: true })).status).toBe(200);

    expect((await deleteAsset('ADA', asset.id)).status).toBe(200);
    expect(objectExists(asset.storageKey)).toBe(true);
  });

  it('TEST 7 — once the only reference is removed through the app, deleting the asset deletes the object', async () => {
    await registerStudent('AD7');
    const ws = await createWorkspace('AD7', 'Design');
    const removedFromCanvas = await uploadImage('AD7', ws, 'a.png');
    const onDeletedBoard = await uploadImage('AD7', ws, 'b.png');
    const b1 = await createBoard('AD7', ws, 'Removed');
    const b2 = await createBoard('AD7', ws, 'Deleted');
    await saveCanvas('AD7', b1.id, editorSnapshot([...baseRecords(), ...imageRecords(removedFromCanvas)]));
    await saveCanvas('AD7', b2.id, editorSnapshot([...baseRecords(), ...imageRecords(onDeletedBoard)]));

    await saveCanvas('AD7', b1.id, editorSnapshot(baseRecords()));                          // image removed
    expect((await request(app).delete(`/api/boards/${b2.id}`).set(auth('AD7'))).status).toBe(200); // board deleted

    for (const asset of [removedFromCanvas, onDeletedBoard]) {
      expect((await deleteAsset('AD7', asset.id)).status).toBe(200);
      expect(await assetRowExists(asset.id)).toBe(false);
      expect(objectExists(asset.storageKey)).toBe(false);
    }
  });

  it('TEST 8 — an unrelated asset is never affected', async () => {
    await registerStudent('AD8');
    const ws = await createWorkspace('AD8', 'Design');
    const used = await uploadImage('AD8', ws, 'used.png');
    const other = await uploadImage('AD8', ws, 'other.png');
    const board = await createBoard('AD8', ws);
    await saveCanvas('AD8', board.id, editorSnapshot([...baseRecords(), ...imageRecords(used)]));

    expect((await deleteAsset('AD8', used.id)).status).toBe(200);
    expect(objectExists(used.storageKey)).toBe(true);
    expect(await assetRowExists(other.id)).toBe(true);
    expect(objectExists(other.storageKey)).toBe(true);
    const list = await request(app).get(`/api/assets?workspace_id=${ws}`).set(auth('AD8'));
    expect(list.body.assets.map((a: { id: string }) => a.id)).toEqual([other.id]);
  });
});

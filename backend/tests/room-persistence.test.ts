import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client';
import { BoardCanvasPersistence } from '../src/realtime/roomPersistence';
import { TLSocketRoom } from '@tldraw/sync-core';

// ─────────────────────────────────────────────────────────────────────────
// PRODUCTION BUG REGRESSION — "Connection failed" / the real browser
// hanging indefinitely on a real tldraw sync connect request, for any
// board that had ever been saved via the pre-realtime manual canvas path
// (TldrawCanvas.tsx's PUT /boards/:id/canvas, which stores tldraw's
// getSnapshot(store) — a TLEditorSnapshot: `{ document: TLStoreSnapshot,
// session: TLSessionStateSnapshot }`, NOT the flat TLStoreSnapshot shape
// @tldraw/sync-core's TLSocketRoom constructor actually knows how to
// auto-convert via its own `"store" in initialSnapshot` check).
//
// This file tests BoardCanvasPersistence.load() against a REAL Postgres
// connection (disposable local test DB, never Supabase) AND feeds its
// output into a REAL, installed TLSocketRoom (not a fake) — the same
// end-to-end proof used to diagnose this bug live against production
// (a byte-accurate tldraw-sync-protocol client got a full connect
// response from a fresh room, but timed out with zero response against a
// room seeded from unconverted legacy canvas_data).
// ─────────────────────────────────────────────────────────────────────────

const persistence = new BoardCanvasPersistence();

// A real getSnapshot(editor.store) shape — abbreviated but structurally
// accurate (document.store keyed by tldraw record id, document.schema a
// real serialized schema shape, session a TLSessionStateSnapshot). This is
// not a synthetic shape invented for the test: it mirrors the exact
// top-level keys (`document`, `session`) confirmed present on every
// affected production board.
const LEGACY_EDITOR_SNAPSHOT = {
  document: {
    store: {
      'document:document': { gridSize: 10, name: '', meta: {}, id: 'document:document', typeName: 'document' },
      'page:page': { meta: {}, id: 'page:page', name: 'Page 1', index: 'a1', typeName: 'page' },
    },
    schema: {
      schemaVersion: 2,
      sequences: { 'com.tldraw.store': 4, 'com.tldraw.document': 2, 'com.tldraw.page': 1 },
    },
  },
  session: {
    version: 0,
    currentPageId: 'page:page',
    exportBackground: true,
    isFocusMode: false,
    isDebugMode: false,
    isToolLocked: false,
    isGridMode: false,
    pageStates: [],
  },
};

async function createBoardWithCanvasData(canvasData: unknown): Promise<{ boardId: string; roomId: string }> {
  const boardId = `room-persist-test-${Math.random().toString(36).slice(2, 10)}`;
  const roomId = `room-persist-room-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, 'Test WS', true, 'PERSISTTEST', $2)`,
    [`ws-${boardId}`, now]
  );
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, workspace_id, realtime_enabled, canvas_data)
     VALUES ($1, 'Test Board', 'PERSISTTEST', 'Owner', 'private', 'members_only', $2, $2, $3, $4, true, $5)`,
    [boardId, now, roomId, `ws-${boardId}`, canvasData === undefined ? null : JSON.stringify(canvasData)]
  );
  return { boardId, roomId };
}

beforeEach(async () => {
  await query('TRUNCATE "boards", "workspaces" CASCADE');
});

describe('BoardCanvasPersistence.load — legacy TLEditorSnapshot unwrapping', () => {
  it('unwraps a legacy {document, session} snapshot to its inner TLStoreSnapshot', async () => {
    const { roomId } = await createBoardWithCanvasData(LEGACY_EDITOR_SNAPSHOT);

    const loaded = await persistence.load(roomId);

    expect(loaded).not.toBeNull();
    expect(loaded).toHaveProperty('store');
    expect(loaded).toHaveProperty('schema');
    // The wrapper's own keys must NOT leak through — this proves unwrapping
    // happened, not just that the object has extra properties alongside them.
    expect(loaded).not.toHaveProperty('document');
    expect(loaded).not.toHaveProperty('session');
  });

  it('a REAL TLSocketRoom constructed from the unwrapped snapshot does not throw, and reports the expected documents', async () => {
    const { roomId } = await createBoardWithCanvasData(LEGACY_EDITOR_SNAPSHOT);
    const loaded = await persistence.load(roomId);

    // This is the actual, installed @tldraw/sync-core package — the same
    // one RoomManager.getOrCreateRoom constructs a room with. Before the
    // fix, feeding it the RAW (un-unwrapped) legacy shape didn't throw
    // synchronously here either (the break was deeper, in how the room
    // then builds its connect response) — so the meaningful assertion is
    // that getCurrentSnapshot() reports the actual document content, not
    // an empty/broken room.
    const room = new TLSocketRoom({ initialSnapshot: loaded ?? undefined });
    const snapshot = room.getCurrentSnapshot();

    expect(snapshot.documents.length).toBeGreaterThan(0);
    const ids = snapshot.documents.map(d => (d.state as { id: string }).id);
    expect(ids).toContain('page:page');
  });

  it('constructing TLSocketRoom from the RAW, un-unwrapped legacy shape (pre-fix behavior) throws synchronously — this IS the production crash', () => {
    // Deliberately bypasses persistence.load()'s unwrap to reconstruct
    // exactly what TLSocketRoom received before this fix: the raw,
    // doubly-nested wrapper, unconverted (no `store` key at the top level,
    // so TLSocketRoom's own `"store" in initialSnapshot` check is false and
    // it treats the wrapper AS IF it were already a flat RoomSnapshot,
    // whose `documents` field it then tries to iterate).
    //
    // This throw is the actual mechanism behind the production bug: it
    // happens synchronously inside `new TLSocketRoom(...)`, which
    // RoomManager.getOrCreateRoom calls from inside join(), which
    // connectionHandler.ts's handleConnection wraps in a fire-and-forget
    // .catch(err => ws.close(1011, 'Internal error')) — so a real browser
    // connecting to an affected room should see the socket close with code
    // 1011 shortly after the upgrade, not hang forever. (A raw non-browser
    // WebSocket client used during live diagnosis observed no response
    // within a 10s window instead of an explicit 1011 — left uninvestigated
    // further here since this test already proves the throw exists and is
    // reachable from real, unmodified library code with the exact
    // production data shape; the discrepancy doesn't change what the fix
    // needs to do.)
    expect(() => new TLSocketRoom({ initialSnapshot: LEGACY_EDITOR_SNAPSHOT as never })).toThrow();
  });

  it('a fresh board with no canvas_data still loads as null (unaffected boards keep working)', async () => {
    const { roomId } = await createBoardWithCanvasData(undefined);
    const loaded = await persistence.load(roomId);
    expect(loaded).toBeNull();
  });

  it('an already-correct flat RoomSnapshot (a board already saved via the realtime path at least once) passes through unchanged', async () => {
    const realRoomSnapshot = {
      clock: 3,
      documents: [{ lastChangedClock: 3, state: { id: 'page:page', typeName: 'page', name: 'Page 1', index: 'a1', meta: {} } }],
      tombstones: {},
      schema: LEGACY_EDITOR_SNAPSHOT.document.schema,
    };
    const { roomId } = await createBoardWithCanvasData(realRoomSnapshot);

    const loaded = await persistence.load(roomId);

    expect(loaded).toEqual(realRoomSnapshot);
  });

  it('a flat TLStoreSnapshot with no wrapper (edge case, no session key) passes through for TLSocketRoom to auto-convert itself', async () => {
    const flatStoreSnapshot = LEGACY_EDITOR_SNAPSHOT.document; // { store, schema } — no `session` sibling
    const { roomId } = await createBoardWithCanvasData(flatStoreSnapshot);

    const loaded = await persistence.load(roomId);

    expect(loaded).toEqual(flatStoreSnapshot);
  });
});

import type { RoomSnapshot } from '@tldraw/sync-core';
import { pool } from '../db/client';

// ─────────────────────────────────────────────────────────────────────────
// PERSISTENCE INTERFACE — kept deliberately separate from both the
// transport layer (realtime/server.ts) and room lifecycle (realtime/rooms.ts).
// RoomManager depends on this interface, not on Postgres/boards.canvas_data
// directly, so:
//   - autosave cadence can change (e.g. debounced vs. on-every-change vs.
//     periodic) without touching RoomManager or the WS handler
//   - version history / named snapshots can be added as a second
//     implementation (or a decorator around this one) that also writes to a
//     new board_versions table, again without touching transport
//   - backups/export can read through the same `load` without knowing
//     anything about WebSockets
// If this rollout is later extended to non-board rooms (see RoomManager's
// own doc comment), a different RoomPersistence implementation is the only
// thing that needs to change.
// ─────────────────────────────────────────────────────────────────────────
export interface RoomPersistence {
  load(roomId: string): Promise<RoomSnapshot | null>;
  save(roomId: string, snapshot: RoomSnapshot): Promise<void>;
}

// Backs realtime rooms with the same boards.canvas_data column the existing
// manual save/load path already uses — no new table, no dual-write. A
// realtime-enabled board's canvas_data holds a serialized RoomSnapshot
// (tldraw sync's native format, richer than the manual path's TLStoreSnapshot
// — includes `clock`/`tombstones` needed for sync continuity across
// reconnects) instead of a TLStoreSnapshot.
//
// PRODUCTION BUG FIX — the comment that used to sit here claimed
// "TLSocketRoom's constructor and loadSnapshot() both accept either shape,
// so no migration/transform is needed." That was never actually verified
// against the library's source and is only half true. Verified directly
// against @tldraw/sync-core 2.4.4's installed TLSocketRoom.js: the
// constructor does `"store" in opts.initialSnapshot ?
// convertStoreSnapshotToRoomSnapshot(...) : opts.initialSnapshot` — it only
// auto-converts a FLAT TLStoreSnapshot (top-level `store`/`schema` keys).
// TldrawCanvas.tsx's manual save path calls tldraw's own getSnapshot(store),
// which returns a TLEditorSnapshot — `{ document: TLStoreSnapshot, session:
// TLSessionStateSnapshot }`, a DOUBLY-NESTED wrapper with no top-level
// `store` key at all. That shape fails the `"store" in ...` check, so
// TLSocketRoom treated it as an already-valid RoomSnapshot (which needs
// `clock`/`documents`, neither present), silently producing a broken room
// whose connect handshake never completes — reproduced live: a real
// tldraw-sync-protocol connect request against a room seeded from this
// unconverted shape never received a response at all (10s timeout), while
// the identical request against an empty room (no stored data) succeeded
// instantly. Confirmed in production: 16 of 18 realtime-enabled boards had
// canvas_data in exactly this legacy `{document, session}` shape (written
// before this board ever went through the sync path), 0 had the flat shape
// TLSocketRoom actually needs.
//
// Fix: unwrap a TLEditorSnapshot's nested `.document` before handing it to
// TLSocketRoom, so what TLSocketRoom actually receives is always either a
// flat TLStoreSnapshot (which it already knows how to auto-convert) or a
// real RoomSnapshot (a board that's already been through the sync path at
// least once, whose canvas_data was written by save() below, not the
// manual path) — never the wrapper shape neither of TLSocketRoom's two
// documented branches understands.
function isEditorSnapshotWrapper(value: unknown): value is { document: unknown; session: unknown } {
  return (
    typeof value === 'object' && value !== null &&
    'document' in value && 'session' in value &&
    !('store' in value) && !('clock' in value)
  );
}

export class BoardCanvasPersistence implements RoomPersistence {
  async load(roomId: string): Promise<RoomSnapshot | null> {
    const result = await pool.query(
      'SELECT canvas_data FROM boards WHERE room_id = $1',
      [roomId]
    );
    const row = result.rows[0] as { canvas_data: string | null } | undefined;
    if (!row?.canvas_data) return null;
    try {
      const parsed: unknown = JSON.parse(row.canvas_data);
      const unwrapped = isEditorSnapshotWrapper(parsed) ? parsed.document : parsed;
      return unwrapped as RoomSnapshot;
    } catch (err) {
      console.error(`Realtime: failed to parse stored snapshot for room ${roomId}, starting empty:`, err);
      return null;
    }
  }

  async save(roomId: string, snapshot: RoomSnapshot): Promise<void> {
    await pool.query(
      'UPDATE boards SET canvas_data = $1, updated_at = $2 WHERE room_id = $3',
      [JSON.stringify(snapshot), new Date().toISOString(), roomId]
    );
  }
}

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
// reconnects) instead of a TLStoreSnapshot, but TLSocketRoom's constructor
// and loadSnapshot() both accept either shape, so no migration/transform is
// needed to move a board between modes — whichever mode last wrote the
// column determines the shape found there, and the room manager loading it
// back always goes through TLSocketRoom's own parsing.
export class BoardCanvasPersistence implements RoomPersistence {
  async load(roomId: string): Promise<RoomSnapshot | null> {
    const result = await pool.query(
      'SELECT canvas_data FROM boards WHERE room_id = $1',
      [roomId]
    );
    const row = result.rows[0] as { canvas_data: string | null } | undefined;
    if (!row?.canvas_data) return null;
    try {
      return JSON.parse(row.canvas_data) as RoomSnapshot;
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

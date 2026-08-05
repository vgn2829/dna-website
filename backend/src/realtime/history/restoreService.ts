import type { RoomManager } from '../rooms';
import * as defaultVersionStorage from './versionStorage';
import type { BoardVersion } from './versionStorage';
import * as defaultVersionTimeline from './versionTimeline';

// ─────────────────────────────────────────────────────────────────────────
// RESTORE SERVICE — orchestrates restoring a board to an earlier version.
// Kept separate from VersionHistoryService (which decides when automatic
// checkpoints happen) because restore is a deliberate, user-initiated,
// permission-gated action with a fundamentally different shape: it reads
// one specific past version, writes it as the board's new live state, AND
// records that as a new version of its own (see the safety guarantees
// below) — none of which overlaps with "should we auto-checkpoint right now."
//
// SAFETY GUARANTEES (per spec — "restoring must never overwrite history,
// must always be reversible"):
//   - The restored version's row is NEVER deleted or modified. Restoring
//     FROM version V never touches V's row at all — it only reads it.
//   - The restore creates a brand NEW version (trigger: 'restore',
//     restoredFromVersionId: V.id) capturing the state that resulted from
//     restoring — so restoring is itself always undoable by restoring to
//     the version that existed immediately before the restore (which is
//     never deleted either). History only ever grows from a restore, it
//     never shrinks or rewrites.
//   - restoreSnapshot never bypasses persistence — RoomManager.restoreSnapshot
//     (see rooms.ts) explicitly triggers a save even though loadSnapshot
//     itself doesn't fire onDataChange, so a restore is never left
//     unpersisted (which would silently revert on the next server restart).
// ─────────────────────────────────────────────────────────────────────────

// Generic over SessionMeta for the same reason VersionHistoryService is —
// see that file's own comment on RoomManager<SessionMeta> assignability.
export interface RestoreServiceOptions<SessionMeta = unknown> {
  roomManager: RoomManager<SessionMeta>;
  // Same fallback shape as VersionHistoryServiceOptions — writes directly
  // through persistence when no live room exists for this board right now.
  persistCanvasSnapshot: (roomId: string, snapshot: import('@tldraw/sync-core').RoomSnapshot) => Promise<void>;
  // Same overridable-for-tests-only shape as VersionHistoryServiceOptions —
  // see that file's own comment. Defaults to the real Postgres-backed modules.
  versionStorage?: Pick<typeof defaultVersionStorage, 'getVersionWithSnapshot' | 'createVersion'>;
  versionTimeline?: Pick<typeof defaultVersionTimeline, 'enforceRetention'>;
}

export type RestoreResult =
  | { ok: true; version: BoardVersion; hadLiveRoom: boolean }
  | { ok: false; reason: 'version_not_found' };

export class RestoreService<SessionMeta = unknown> {
  private storage: Pick<typeof defaultVersionStorage, 'getVersionWithSnapshot' | 'createVersion'>;
  private timeline: Pick<typeof defaultVersionTimeline, 'enforceRetention'>;

  constructor(private opts: RestoreServiceOptions<SessionMeta>) {
    this.storage = opts.versionStorage ?? defaultVersionStorage;
    this.timeline = opts.versionTimeline ?? defaultVersionTimeline;
  }

  async restore(
    boardId: string,
    roomId: string,
    versionId: string,
    actorRoll: string,
    actorName: string | null
  ): Promise<RestoreResult> {
    const target = await this.storage.getVersionWithSnapshot(boardId, versionId);
    if (!target) return { ok: false, reason: 'version_not_found' };

    // Prefer hot-swapping a live room (see rooms.ts's restoreSnapshot doc
    // comment for exactly what this does to connected clients: closes their
    // sockets, each one's own ReconnectManager brings them back within
    // seconds and resyncs to the restored content — one clean, deliberate
    // reconnect cycle, not custom protocol code, not a "storm"). Falls back
    // to writing straight through persistence when nobody's connected —
    // there's no live room to hot-swap, so there's nothing to disconnect
    // either; the next person to open the board loads the restored content
    // fresh via the normal getOrCreateRoom path, same as any other board.
    const hadLiveRoom = this.opts.roomManager.restoreSnapshot(roomId, target.snapshot);
    if (!hadLiveRoom) {
      await this.opts.persistCanvasSnapshot(roomId, target.snapshot);
    }

    // The restore itself becomes a new version — see this file's own header
    // comment on why this is the reversibility guarantee. Not routed through
    // VersionHistoryService's writeCheckpoint (which has a dedup/rate-limit
    // guard meant for automatic triggers) — a restore is always an explicit,
    // deliberate action and must always produce a real new row, never be
    // silently coalesced with a recent auto-checkpoint.
    const newVersion = await this.storage.createVersion({
      boardId,
      snapshot: target.snapshot,
      createdByRoll: actorRoll,
      createdByName: actorName,
      trigger: 'restore',
      restoredFromVersionId: target.version.id,
    });

    await this.timeline.enforceRetention(boardId);

    return { ok: true, version: newVersion, hadLiveRoom };
  }
}

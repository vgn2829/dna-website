import { v4 as uuidv4 } from 'uuid';
import type { RoomSnapshot } from '@tldraw/sync-core';
import { pool } from '../../db/client';

// ─────────────────────────────────────────────────────────────────────────
// VERSION STORAGE — pure database access for board_versions. No decisions
// live here: not when to checkpoint, not what counts as a "major change",
// not retention policy. Those all belong to VersionHistoryService/
// VersionTimeline, which call this module the same way boards.ts calls
// `pool` directly — this is the persistence primitive, not the policy.
//
// Deliberately does NOT know about RoomManager, TLSocketRoom, or the WS
// transport at all — a version's snapshot is just a RoomSnapshot value by
// the time it reaches here, sourced by the caller from wherever (a live
// room via RoomManager.getCurrentSnapshot, or RoomPersistence.load for a
// board with no live room). This mirrors roomPersistence.ts's own
// database-only, transport-agnostic shape.
// ─────────────────────────────────────────────────────────────────────────

export type VersionTrigger =
  | 'explicit'   // user clicked "save a version" / manual checkpoint
  | 'inactivity' // auto-checkpoint after an editing session goes quiet
  | 'major_change' // auto-checkpoint after a large enough diff since the last version
  | 'restore'    // this version's content was produced by restoring an earlier one
  | 'rename'     // board renamed
  | 'archive';   // board archived

export interface BoardVersion {
  id: string;
  boardId: string;
  createdByRoll: string | null;
  createdByName: string | null;
  createdAt: string;
  trigger: VersionTrigger;
  description: string | null;
  restoredFromVersionId: string | null;
}

// Snapshot is deliberately excluded from BoardVersion/VersionSummary — the
// timeline list (VersionTimeline) never needs it, and it can be large.
// Only getSnapshot(versionId) below returns it, so the UI's "browse
// versions" list stays cheap regardless of history length or board size
// (see the PERFORMANCE requirement: never download all snapshots on open).
export interface CreateVersionInput {
  boardId: string;
  snapshot: RoomSnapshot;
  createdByRoll: string | null;
  createdByName: string | null;
  trigger: VersionTrigger;
  description?: string | null;
  restoredFromVersionId?: string | null;
}

function rowToVersion(row: Record<string, unknown>): BoardVersion {
  return {
    id: row.id as string,
    boardId: row.board_id as string,
    createdByRoll: (row.created_by_roll as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
    createdAt: row.created_at as string,
    trigger: row.trigger as VersionTrigger,
    description: (row.description as string | null) ?? null,
    restoredFromVersionId: (row.restored_from_version_id as string | null) ?? null,
  };
}

export async function createVersion(input: CreateVersionInput): Promise<BoardVersion> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const result = await pool.query(
    `INSERT INTO board_versions
       (id, board_id, snapshot, created_by_roll, created_by_name,
        created_at, trigger, description, restored_from_version_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, board_id, created_by_roll, created_by_name,
               created_at, trigger, description, restored_from_version_id`,
    [
      id, input.boardId, JSON.stringify(input.snapshot),
      input.createdByRoll, input.createdByName,
      now, input.trigger, input.description ?? null,
      input.restoredFromVersionId ?? null,
    ]
  );
  return rowToVersion(result.rows[0] as Record<string, unknown>);
}

// Metadata only (no snapshot column selected) — this is what the timeline
// list endpoint returns. See CreateVersionInput's own comment for why the
// snapshot is never fetched here.
export async function listVersions(boardId: string, opts: { limit: number; before?: string }): Promise<BoardVersion[]> {
  const params: unknown[] = [boardId];
  let cursorClause = '';
  if (opts.before) {
    params.push(opts.before);
    cursorClause = `AND created_at < $${params.length}`;
  }
  params.push(opts.limit);

  const result = await pool.query(
    `SELECT id, board_id, created_by_roll, created_by_name,
            created_at, trigger, description, restored_from_version_id
     FROM board_versions
     WHERE board_id = $1 ${cursorClause}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(row => rowToVersion(row as Record<string, unknown>));
}

export async function getMostRecentVersion(boardId: string): Promise<BoardVersion | null> {
  const result = await pool.query(
    `SELECT id, board_id, created_by_roll, created_by_name,
            created_at, trigger, description, restored_from_version_id
     FROM board_versions
     WHERE board_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [boardId]
  );
  return result.rows.length > 0 ? rowToVersion(result.rows[0] as Record<string, unknown>) : null;
}

// Returns both the metadata AND the snapshot — used only when actually
// restoring or inspecting one specific version's content, never for a list.
export async function getVersionWithSnapshot(
  boardId: string,
  versionId: string
): Promise<{ version: BoardVersion; snapshot: RoomSnapshot } | null> {
  const result = await pool.query(
    `SELECT id, board_id, snapshot, created_by_roll, created_by_name,
            created_at, trigger, description, restored_from_version_id
     FROM board_versions
     WHERE id = $1 AND board_id = $2`,
    [versionId, boardId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return {
    version: rowToVersion(row),
    snapshot: JSON.parse(row.snapshot as string) as RoomSnapshot,
  };
}

export async function countVersions(boardId: string): Promise<number> {
  const result = await pool.query(
    'SELECT COUNT(*)::int as count FROM board_versions WHERE board_id = $1',
    [boardId]
  );
  return (result.rows[0] as { count: number }).count;
}

// Retention primitive — deletes everything for a board OLDER than the Nth
// most recent version, keeping exactly `keep` rows. VersionTimeline decides
// if/when to call this (see its own doc comment on retention policy); this
// function has no opinion about when pruning should happen, only how.
export async function deleteVersionsOlderThanNth(boardId: string, keep: number): Promise<number> {
  const result = await pool.query(
    `DELETE FROM board_versions
     WHERE board_id = $1
       AND id NOT IN (
         SELECT id FROM board_versions
         WHERE board_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       )`,
    [boardId, keep]
  );
  return result.rowCount ?? 0;
}

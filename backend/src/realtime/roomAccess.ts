import { pool } from '../db/client';
import { verifyStudentToken } from '../middleware/studentAuth';
import { isRealtimeGloballyEnabled } from './server';

// ─────────────────────────────────────────────────────────────────────────
// AUTHORIZATION SERVICE — the single hook for "can this identity access this
// room, and with what role". This is the seam the rest of the realtime
// module is built around: RoomManager and the WS upgrade handler both call
// checkRoomAccess() exactly once, before a session is allowed to exist, and
// never re-derive or duplicate permission logic themselves. Any future
// collaboration feature (comments, presence, notifications, sticky notes)
// that needs to gate access to a room should call this same function rather
// than re-implementing board-permission checks — it already mirrors
// boards.ts's canEdit/isMember rules exactly, so realtime and REST can never
// disagree about who can do what to a given board.
//
// KNOWN LIMITATION — server-side write enforcement (read this before
// building on top of `role`):
//
// `role: 'viewer'` here is currently ADVISORY ONLY. @tldraw/sync-core
// 2.4.4's TLSocketRoom has no per-session permission gating in its wire
// protocol — once a socket is connected via handleSocketConnect, it can
// send write operations regardless of role. This module still computes and
// returns the correct role (mirroring the existing manual-save path's own
// enforcement point, `readOnly` on the client's <Tldraw> component in
// TldrawCanvas.tsx — same trust model as today, not a regression), but nothing
// server-side currently rejects a write from a 'viewer' session.
//
// Deliberately NOT fixed by hand-parsing/filtering TLSocketRoom's message
// protocol here — that would mean reimplementing part of tldraw's own sync
// wire format, exactly the "custom synchronization engine" this
// architecture was chosen to avoid (see the Phase 0 discovery report).
// The correct fix, when needed, is either (a) upstream tldraw adding
// server-side permission support to TLSocketRoom, or (b) a deliberate,
// reviewed decision to add message-level filtering as its own scoped
// change — not something to bolt on ad hoc.
//
// This MUST be resolved with real server-side enforcement before any of:
//   - Comments (a resolve/delete action from a viewer must be rejected server-side)
//   - Sticky Notes (same — viewer edits must not be able to persist)
//   - Version History (a restore is a write; must be permission-checked)
//   - Public sharing (anonymous/unauthenticated read access raises the stakes
//     of a write leaking through)
//   - Organization/team workspaces (more roles than editor/viewer, and cross-
//     board permission boundaries that need real enforcement, not convention)
//
// Because every caller already goes through checkRoomAccess()'s single
// `role` result, adding real enforcement later is a change to WHERE `role`
// is consulted (e.g. inside RoomManager before forwarding a message to
// TLSocketRoom), not a change to this function's contract or to the
// transport layer — the abstraction boundary is already in the right place.
// ─────────────────────────────────────────────────────────────────────────

export type RoomRole = 'editor' | 'viewer';

export interface RoomAccessResult {
  ok: true;
  roll: string;
  role: RoomRole;
}

export interface RoomAccessDenied {
  ok: false;
  reason: string;
  // WS close codes: 1008 = generic policy violation (auth/permission
  // failures). 4099 = tldraw sync's OWN "room not found" convention
  // (TLCloseEventCode.NOT_FOUND in @tldraw/sync-core's TLSyncClient) — using
  // their exact code, not an invented one, matters because useSync's client
  // explicitly branches on this value to distinguish "room doesn't exist"
  // from a generic connection error.
  code: 1008 | 4099;
}

export async function checkRoomAccess(boardId: string, token: string | null): Promise<RoomAccessResult | RoomAccessDenied> {
  if (!isRealtimeGloballyEnabled()) {
    return { ok: false, reason: 'Realtime collaboration is disabled', code: 1008 };
  }

  const roll = token ? verifyStudentToken(token) : null;
  if (!roll) {
    return { ok: false, reason: 'Sign in required', code: 1008 };
  }

  const result = await pool.query(
    `SELECT owner_roll, visibility, edit_mode, realtime_enabled FROM boards WHERE id = $1`,
    [boardId]
  );
  if (result.rows.length === 0) {
    return { ok: false, reason: 'Board not found', code: 4099 };
  }
  const board = result.rows[0] as {
    owner_roll: string; visibility: string; edit_mode: string; realtime_enabled: boolean;
  };

  if (!board.realtime_enabled) {
    return { ok: false, reason: 'Realtime is not enabled for this board', code: 1008 };
  }

  const isOwner = board.owner_roll === roll;
  const memberResult = isOwner
    ? { rows: [] }
    : await pool.query('SELECT 1 FROM board_members WHERE board_id = $1 AND roll_number = $2', [boardId, roll]);
  const isMember = isOwner || memberResult.rows.length > 0;

  const canRead = isMember || board.visibility === 'shared';
  if (!canRead) {
    return { ok: false, reason: 'Access denied', code: 1008 };
  }

  // Same edit_mode semantics as boards.ts's canEdit: owner/member can always
  // write; a shared board with edit_mode='anyone' lets any signed-in student
  // write even without an explicit membership row.
  const canWrite = isOwner || isMember || (board.edit_mode === 'anyone' && board.visibility === 'shared');

  return { ok: true, roll, role: canWrite ? 'editor' : 'viewer' };
}

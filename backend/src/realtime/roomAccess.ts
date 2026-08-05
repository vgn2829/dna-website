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
// FOUR-TIER ROLE MODEL (Commit 7) — Owner / Editor / Commenter / Viewer,
// the single source of truth every other permission check in the realtime
// module now derives from (RoomManager's write gate, the comments REST
// router, RestoreService). There is still no separate "role" column on
// board_members — these four tiers are a classification of the SAME
// underlying facts boards.ts's own canEdit/isMember/canRead already
// compute (ownership, membership, visibility, edit_mode), not a new
// permission store. See RoomRole's own doc comment for the exact mapping.
//
// COMMIT 7 — REAL SERVER-SIDE WRITE ENFORCEMENT (supersedes the "known
// limitation" this comment used to document): `role` is no longer
// advisory. See roomSocketGate.ts for the mechanism — @tldraw/sync-core
// 2.4.4's TLSocketRoom has no built-in per-session write permission (this
// was re-verified by reading its source directly for this commit, not
// assumed from the earlier note), so RoomManager now wraps every socket
// in a thin proxy that classifies each incoming client message by type
// (`connect`/`ping` vs `push`) BEFORE TLSocketRoom ever sees it, and drops
// any `push` (the only write-carrying message type) from a session whose
// role doesn't permit writes. A rejected push never reaches
// TLSocketRoom.handleSocketMessage, so it can never mutate `this.room`,
// never broadcast to other sessions, and never trigger onDataChange (so
// it can never affect version history either) — see roomSocketGate.ts's
// own header comment for the full mechanism and why this is the thinnest
// wrapper possible given the library's actual (verified) extension
// surface, not a fork of tldraw internals.
// ─────────────────────────────────────────────────────────────────────────

// Owner: created the board. Editor: member, or anyone on a shared board
// with edit_mode='anyone'. Commenter: can read the board and use
// comments, but cannot write to the canvas — this is exactly the "read
// access but not board-edit access" tier Commit 6's comments permission
// model already computed (canReadBoard true, canEditBoard false); Commit
// 7 gives it a first-class name and, new in this commit, enforces the
// canvas-write restriction at the transport layer too (Commit 6 already
// enforced it for comments via REST). Viewer: reserved for a caller that
// can read a board but must not be able to comment either — no code path
// produces this today (comments' own permission model in
// routes/comments.ts grants comment rights to anyone with read access,
// matching Figma/FigJam's own behavior — see that file's own doc
// comment), but the type exists so a future, stricter sharing mode (e.g.
// "view only, no comments") has a role to express without inventing a
// fifth tier later.
//
// IMPORTANT — RoomRole is IDENTITY, not CAPABILITY. It answers "what is
// this person's relationship to the board" (its own value: still shown
// in the UI, still meaningful for "you are the owner" messaging even on
// an archived board), NOT "can they write right now." Write capability
// additionally depends on board.is_archived, which is NOT encoded in
// RoomRole at all — an owner of an archived board is still, correctly,
// 'owner' (they didn't stop owning it), but cannot write. This is why
// roleCanWriteCanvas below takes an explicit isArchived flag rather than
// being a pure function of role alone.
//
// A REAL BUG this design fixes, caught during this commit's own manual
// QA (not by any test — every existing unit test for this file asserted
// against `role` alone, never against the actual computed write
// capability, which is exactly how this slipped through): an earlier
// version of classifyBoardAccess computed `canWrite` correctly
// (incorporating is_archived), but then did
// `return isOwner ? 'owner' : canWrite ? 'editor' : 'commenter'` —
// discarding `canWrite` entirely for the owner branch. Combined with the
// old roleCanWriteCanvas(role) being `role === 'owner' || role ===
// 'editor'` (a pure function of role with no is_archived awareness at
// all), an OWNER of an ARCHIVED board could still write to the canvas
// in production — the exact "Board archived" write-freeze this whole
// commit exists to guarantee, silently broken for the one role (owner)
// most likely to be testing/reviewing the archived state. Reproduced
// live against a real server before fixing, not assumed.
export type RoomRole = 'owner' | 'editor' | 'commenter' | 'viewer';

// isArchived is REQUIRED (not optional) specifically so a caller can
// never accidentally omit it and get a silently-wrong true — see the bug
// this signature change fixes, above.
export function roleCanWriteCanvas(role: RoomRole, isArchived: boolean): boolean {
  if (isArchived) return false;
  return role === 'owner' || role === 'editor';
}

// Commenting is not restricted by is_archived — Figma/FigJam allow
// commenting on read-only/archived content (discussion doesn't require
// the canvas to be editable), and nothing in the spec asked for comments
// to freeze on archive, only canvas writes.
export function roleCanComment(role: RoomRole): boolean {
  return role !== 'viewer';
}

// Specific, client-actionable denial reasons — see roomSocketGate.ts and
// TldrawCanvasSync.tsx for how each maps to a distinct user-facing
// message, per this commit's "meaningful errors, never silently ignored
// writes" requirement.
export type RoomAccessDenialReason =
  | 'realtime_disabled'  // global REALTIME_ENABLED kill switch is off
  | 'session_expired'    // missing/invalid/expired JWT
  | 'board_not_found'    // no board has this room_id (never existed, or was deleted — see boardExistsForRoom)
  | 'board_archived'     // board.is_archived — read-only by policy, not a permission failure
  | 'permission_denied'; // signed in, board exists, but this identity has no read access

export interface RoomAccessResult {
  ok: true;
  roll: string;
  role: RoomRole;
  // Carried alongside `role` specifically so every caller passes the SAME
  // isArchived value into roleCanWriteCanvas that this result was
  // actually computed from — see roleCanWriteCanvas's own doc comment on
  // why isArchived is a required, not optional, parameter there.
  isArchived: boolean;
}

export interface RoomAccessDenied {
  ok: false;
  reason: RoomAccessDenialReason;
  // WS close codes: 1008 = generic policy violation (realtime_disabled,
  // session_expired, permission_denied, board_archived — none of these
  // are "the room doesn't exist", so none should use tldraw's own
  // NOT_FOUND convention). 4099 = tldraw sync's OWN "room not found"
  // convention (TLCloseEventCode.NOT_FOUND in @tldraw/sync-core's
  // TLSyncClient) — using their exact code, not an invented one, matters
  // because useSync's client explicitly branches on this value. Reserved
  // for board_not_found only.
  code: 1008 | 4099;
}

interface BoardAccessRow {
  id: string; owner_roll: string; visibility: string; edit_mode: string;
  realtime_enabled: boolean; is_archived: boolean;
}

// The actual role classification, factored out to accept an
// ALREADY-FETCHED board row — this is the one place ownership/membership/
// visibility/edit_mode/archive facts turn into a RoomRole, reused by
// every caller below regardless of whether they looked the board up by
// room_id (the realtime WS path) or by id (routes/comments.ts,
// routes/versions.ts — REST endpoints that only ever see board.id from
// their URL param, never room_id). Splitting the LOOKUP (by room_id vs by
// id) from the CLASSIFICATION (this function) is what makes "one source
// of truth" true for both callers without forcing REST endpoints to
// either duplicate the room_id join or pretend they have a roomId they
// don't.
function classifyBoardAccess(board: BoardAccessRow, roll: string, isMember: boolean): RoomRole {
  const isOwner = board.owner_roll === roll;
  // Same edit_mode semantics as boards.ts's canEdit: owner/member can always
  // write; a shared board with edit_mode='anyone' lets any signed-in student
  // write even without an explicit membership row. An archived board is
  // read-only regardless of what edit_mode/membership would otherwise
  // allow — archiving is a deliberate "stop changing this" action (see
  // boards.ts's PUT /:id), and every permission check honoring anything
  // less would silently let a collaborator keep editing a board its owner
  // just told the rest of the app to freeze.
  const canWrite = !board.is_archived
    && (isOwner || isMember || (board.edit_mode === 'anyone' && board.visibility === 'shared'));
  return isOwner ? 'owner' : canWrite ? 'editor' : 'commenter';
}

async function isBoardMember(boardId: string, roll: string, isOwner: boolean): Promise<boolean> {
  if (isOwner) return true;
  const result = await pool.query(
    'SELECT 1 FROM board_members WHERE board_id = $1 AND roll_number = $2', [boardId, roll]
  );
  return result.rows.length > 0;
}

// The board-permission computation, factored out from checkRoomAccess so
// it can be reused by anything that already has a KNOWN, trusted roll —
// specifically the periodic re-validator in connectionHandler.ts, which
// re-checks an already-connected session's access using the roll it
// captured at connect time (there is no repeated JWT verification on an
// open WebSocket's data channel — a JWT is checked once, at connect;
// re-validation is about board state changing, e.g. removed as a member
// or the board being archived, not about the token expiring mid-session).
// checkRoomAccess (below) is the only caller that also needs the
// token→roll step; both funnel through here for the actual board logic.
async function checkBoardAccessForRoll(roomId: string, roll: string): Promise<RoomAccessResult | RoomAccessDenied> {
  // PRE-EXISTING BUG FIX (found during Commit 6 manual QA, unrelated to
  // Comments itself): every caller of checkRoomAccess — the document-sync
  // WS path in connectionHandler.ts (Commit 3) and the new comments WS
  // path added in Commit 6 — passes board.room_id here, not board.id (see
  // getRealtimeUrl/getCommentsRealtimeUrl in api.ts, both keyed by
  // room_id). This function's parameter was misleadingly named `boardId`
  // and queried `WHERE id = $1`, which only matches when a board's `id`
  // and `room_id` happen to be equal — never true in practice, since
  // room_id is a separately generated UUID (see schema.ts's backfill:
  // `SET room_id = gen_random_uuid()::text`). The practical effect: every
  // realtime WebSocket connection has been closing immediately with 4099
  // "Board not found" in production since Commit 3 shipped — confirmed by
  // reproducing it live against a real board row with a real (Commit-3-era)
  // client URL, not assumed. Fixed by querying on the column that's
  // actually being looked up by.
  const result = await pool.query(
    `SELECT id, owner_roll, visibility, edit_mode, realtime_enabled, is_archived FROM boards WHERE room_id = $1`,
    [roomId]
  );
  if (result.rows.length === 0) {
    // Covers both "never existed" and "was deleted" — boards.ts's DELETE
    // /:id is a hard delete with no tombstone, so this query can't tell
    // them apart (see getRoomBoardStatus below, and the REST pre-check
    // endpoint in routes/realtime.ts, which CAN distinguish them because
    // the frontend already holds the board it fetched before attempting
    // to connect).
    return { ok: false, reason: 'board_not_found', code: 4099 };
  }
  const board = result.rows[0] as BoardAccessRow;

  if (!board.realtime_enabled) {
    return { ok: false, reason: 'realtime_disabled', code: 1008 };
  }

  const isOwner = board.owner_roll === roll;
  // board_members.board_id is the board's real `id`, not its `room_id` —
  // must use board.id (just selected above), not the roomId parameter this
  // function received. This is the second half of the same room_id/id mix-up
  // (see the bug-fix comment above): a non-owner member would otherwise
  // never be recognized as a member on the realtime path, even once the
  // "Board not found" bug above is fixed.
  const isMember = await isBoardMember(board.id, roll, isOwner);

  const canRead = isMember || board.visibility === 'shared';
  if (!canRead) {
    return { ok: false, reason: 'permission_denied', code: 1008 };
  }

  return { ok: true, roll, role: classifyBoardAccess(board, roll, isMember), isArchived: board.is_archived };
}

export async function checkRoomAccess(roomId: string, token: string | null): Promise<RoomAccessResult | RoomAccessDenied> {
  if (!isRealtimeGloballyEnabled()) {
    return { ok: false, reason: 'realtime_disabled', code: 1008 };
  }

  const roll = token ? verifyStudentToken(token) : null;
  if (!roll) {
    return { ok: false, reason: 'session_expired', code: 1008 };
  }

  return checkBoardAccessForRoll(roomId, roll);
}

// Re-validates an ALREADY-AUTHENTICATED session's board access — used only
// by the periodic re-validator (connectionHandler.ts's
// startPeriodicRevalidation), which already knows the connected session's
// roll (captured at connect time, in StudentSessionMeta) and is not
// re-verifying a JWT (see checkBoardAccessForRoll's own comment on why
// that's correct, not a shortcut). Still checks the global kill switch
// first, same as checkRoomAccess, so flipping REALTIME_ENABLED off
// disconnects existing sessions too, not just new connection attempts.
export async function checkRoomAccessForRoll(roomId: string, roll: string): Promise<RoomAccessResult | RoomAccessDenied> {
  if (!isRealtimeGloballyEnabled()) {
    return { ok: false, reason: 'realtime_disabled', code: 1008 };
  }
  return checkBoardAccessForRoll(roomId, roll);
}

export interface BoardRoleResult {
  role: RoomRole;
  isArchived: boolean;
}

// The board.id-keyed equivalent of checkRoomAccess, for REST endpoints
// that only ever have board.id from their URL param (routes/comments.ts,
// routes/versions.ts) — NOT the realtime global kill switch, and NOT
// board_not_found/session_expired reasons, since a REST endpoint reaching
// this function has already gone through requireStudent (real JWT
// verification) and already knows the board exists (it's usually the
// caller's OWN lookup, e.g. to also fetch room_id). This is deliberately
// the SAME classification (classifyBoardAccess) checkRoomAccess itself
// uses — the one thing routes/comments.ts and routes/versions.ts used to
// each hand-roll their own (slightly divergent) canEditBoard/canReadBoard
// for, which this replaces (see comments.ts's own comment on why that was
// a duplication this commit closes, not a rewrite for its own sake).
//
// Returns isArchived alongside role — NOT just role — because
// roleCanWriteCanvas requires both (see its own doc comment on the real
// bug that resulted from treating write capability as a pure function of
// role alone). Every caller MUST pass result.isArchived into
// roleCanWriteCanvas, never assume/omit it.
export async function getBoardRole(boardId: string, roll: string): Promise<BoardRoleResult | null> {
  const result = await pool.query(
    `SELECT id, owner_roll, visibility, edit_mode, realtime_enabled, is_archived FROM boards WHERE id = $1`,
    [boardId]
  );
  if (result.rows.length === 0) return null;
  const board = result.rows[0] as BoardAccessRow;

  const isOwner = board.owner_roll === roll;
  const isMember = await isBoardMember(board.id, roll, isOwner);
  const canRead = isMember || board.visibility === 'shared';
  if (!canRead) return null;

  return { role: classifyBoardAccess(board, roll, isMember), isArchived: board.is_archived };
}

// Used only by the REST pre-check endpoint (routes/realtime.ts) to give
// the frontend an accurate reason BEFORE it attempts to open a WebSocket
// at all — see that route's own comment on why this matters (a WS close
// code alone can't reliably distinguish "permanently denied" from
// "transient network drop" once it reaches @tldraw/sync's own
// ReconnectManager, which retries almost everything except its one
// recognized special code). Deliberately a separate, smaller query than
// checkRoomAccess's (no auth/role computation) — this only answers "does
// a board still exist for this room, and is it archived", which is all
// the REST pre-check needs to distinguish board_not_found from
// board_archived before the identity/read-access checks even run.
export async function getRoomBoardStatus(roomId: string): Promise<{ exists: false } | { exists: true; isArchived: boolean }> {
  const result = await pool.query('SELECT is_archived FROM boards WHERE room_id = $1', [roomId]);
  if (result.rows.length === 0) return { exists: false };
  return { exists: true, isArchived: (result.rows[0] as { is_archived: boolean }).is_archived };
}

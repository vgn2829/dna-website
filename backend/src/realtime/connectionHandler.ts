import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { checkRoomAccess, checkRoomAccessForRoll, roleCanWriteCanvas, type RoomRole } from './roomAccess';
import { bufferMessagesDuringInit, type ConnectionBuffer } from './connectionBuffer';
import { RoomManager } from './rooms';
import type { CommentBroadcaster } from './comments/commentBroadcaster';
import type { RealtimeUpgradeHandler } from './server';

export interface StudentSessionMeta {
  roll: string;
  role: RoomRole;
}

// PERIODIC RE-VALIDATION (Commit 7) — the "permission changes live" /
// "board archived while connected" / "board deleted while connected"
// requirements. checkRoomAccess is only ever consulted at connect time by
// default (same as every REST endpoint only checks permissions per
// request) — a session that's been open for an hour doesn't re-run it on
// its own. This interval re-runs checkRoomAccessForRoll (the same board-
// permission logic checkRoomAccess itself uses, minus the token step —
// see roomAccess.ts's own comment on why re-verifying a token isn't part
// of this) for every currently connected session in every room with at
// least one session, and applies the result via RoomManager's
// updateSessionWriteAccess/disconnectSession:
//   - access still ok, write capability unchanged → no-op.
//   - access still ok, write capability changed (e.g. removed as a
//     member, board archived, edit_mode/visibility changed) →
//     updateSessionWriteAccess, takes effect on the session's very next
//     push (see roomSocketGate.ts) — no reconnect needed for a mere
//     downgrade to read-only.
//   - access no longer ok at all (removed from a private board, board
//     deleted, realtime disabled) → disconnectSession, forcing a clean
//     close; the client's own reconnect logic then hits checkRoomAccess
//     again on the new connection attempt and gets the real, current
//     denial reason.
//
// 15s balances "permission changes live" against not hammering Postgres
// with a query per connected session every few seconds — acceptable
// latency for a revocation to take effect (the REST endpoints that
// actually change board_members/is_archived/etc. are themselves already
// the source of truth the instant they commit; this interval only
// affects how quickly an ALREADY-OPEN realtime session notices).
export const REVALIDATION_INTERVAL_MS = 15_000;

export function startPeriodicRevalidation(
  roomManager: RoomManager<StudentSessionMeta>,
  getActiveRoomIds: () => string[],
  // Overridable only for tests — real callers always get the module
  // constant above. Mixing vi.useFakeTimers() with this function's real
  // Postgres I/O (checkRoomAccessForRoll) doesn't reliably flush via
  // vi.advanceTimersByTimeAsync (fake timers advance the clock, not
  // actual socket I/O completion), so tests use REAL timers with a very
  // short interval here instead — see periodic-revalidation.test.ts's own
  // comment on why.
  intervalMs: number = REVALIDATION_INTERVAL_MS
): () => void {
  const tick = async (): Promise<void> => {
    for (const roomId of getActiveRoomIds()) {
      for (const { sessionId, meta } of roomManager.getSessionMetas(roomId)) {
        try {
          const access = await checkRoomAccessForRoll(roomId, meta.roll);
          if (!access.ok) {
            roomManager.disconnectSession(roomId, sessionId);
            continue;
          }
          roomManager.updateSessionWriteAccess(roomId, sessionId, roleCanWriteCanvas(access.role, access.isArchived));
        } catch (err) {
          // A single failed re-check (e.g. a transient DB error) must
          // never disconnect a session on a false negative, and must
          // never crash the interval for every other session — this
          // matches the existing "a listener throwing must not break
          // anything else" philosophy already used for
          // onSnapshotChanged listeners in rooms.ts.
          console.error(`Realtime: permission re-validation failed for session ${sessionId} in room ${roomId}:`, err);
        }
      }
    }
  };

  const timer = setInterval(() => { void tick(); }, intervalMs);
  return () => clearInterval(timer);
}

// Board rooms are keyed by board.room_id, not board.id — room_id is the
// value already used to segment realtime state from the board's primary
// key (see backend/src/db/schema.ts's long-standing room_id column, unused
// until this rollout). The upgrade path is /api/realtime/boards/<roomId>.
const BOARD_ROOM_PATH_RE = /^boards\/([0-9a-fA-F-]{36})$/;

// Comments (Commit 6) — a second, sibling path under the same
// /api/realtime/boards/<roomId>/ prefix, deliberately NOT routed into
// RoomManager/TLSocketRoom. See commentBroadcaster.ts's own header comment
// for why comment events need a separate socket rather than piggy-backing
// on the document sync connection above.
const COMMENTS_ROOM_PATH_RE = /^boards\/([0-9a-fA-F-]{36})\/comments$/;

// Composes checkRoomAccess (authorization) and RoomManager (lifecycle) into
// the single onUpgrade callback attachRealtimeServer expects. This is the
// only place those two modules meet — RoomManager itself never calls
// checkRoomAccess, and checkRoomAccess never touches TLSocketRoom, so each
// stays independently testable and reusable (see their own doc comments).
export function createConnectionHandler(
  roomManager: RoomManager<StudentSessionMeta>,
  commentBroadcaster: CommentBroadcaster
): RealtimeUpgradeHandler {
  return (req: IncomingMessage, ws: WebSocket, roomPath: string) => {
    // INSTALLED FIRST, SYNCHRONOUSLY, BEFORE ANY AWAIT — this is the fix
    // for the handshake race described in connectionBuffer.ts's header
    // comment. The socket is already live by the time this callback runs
    // (server.ts's wss.handleUpgrade made it so), and a real tldraw client
    // sends `connect` immediately on open, so a 'message' listener has to
    // exist right now or that frame is discarded by EventEmitter and the
    // handshake never completes. Buffering is NOT authorization: nothing
    // is parsed, classified or forwarded here, and every failure path
    // below discards the buffer without replaying it.
    const buffer = bufferMessagesDuringInit(ws);

    // handleConnection is async and called fire-and-forget (attachRealtimeServer's
    // onUpgrade callback is synchronous) — an unhandled rejection here (a DB
    // error from checkRoomAccess, a persistence failure from roomManager.join)
    // would otherwise be a process-crashing unhandled rejection, not just a
    // failed connection. One bad connection attempt must never take down
    // every other room's live sessions.
    handleConnection(req, ws, roomPath, roomManager, commentBroadcaster, buffer).catch(err => {
      console.error('Realtime: unhandled error during connection setup:', err);
      // Room load/join threw (persistence failure, TLSocketRoom
      // construction error). The session is not usable, so the buffered
      // frames must never be replayed — dropping them is the only safe
      // outcome, and leaves no dangling listener behind.
      buffer.discard();
      try {
        ws.close(1011, 'Internal error');
      } catch {
        // socket may already be closed/closing — nothing more to do
      }
    });
  };
}

async function handleConnection(
  req: IncomingMessage,
  ws: WebSocket,
  roomPath: string,
  roomManager: RoomManager<StudentSessionMeta>,
  commentBroadcaster: CommentBroadcaster,
  buffer: ConnectionBuffer
): Promise<void> {
  const [pathOnly, query] = roomPath.split('?');
  const params = new URLSearchParams(query ?? '');
  const token = params.get('token');

  // Comments path checked FIRST — its regex is a strict superset suffix of
  // BOARD_ROOM_PATH_RE's shape (same UUID, plus /comments), so it must be
  // tried before the plain board-room match or it would never be reached.
  const commentsMatch = COMMENTS_ROOM_PATH_RE.exec(pathOnly);
  if (commentsMatch) {
    const roomId = commentsMatch[1];
    // Same authorization function, same board-permission rules as the
    // document-sync socket — anyone who can read the board (owner,
    // editor, or commenter — everyone except the reserved 'viewer' tier;
    // see roleCanComment) can also receive live comment events, matching
    // routes/comments.ts's own permission model exactly (comments'
    // mutation endpoints are the actual enforcement point for WRITING a
    // comment; this WS channel only ever delivers already-persisted
    // events, so read access is the only bar to clear here). Note this
    // channel carries no client→server messages that mutate anything at
    // all (see commentBroadcaster.ts's own comment) — there is no write
    // gate to apply here the way roomSocketGate.ts applies one to the
    // document-sync socket below.
    const access = await checkRoomAccess(roomId, token);
    if (!access.ok) {
      buffer.discard();
      ws.close(access.code, access.reason);
      return;
    }
    // The comments channel is broadcast-only — it carries no client→server
    // messages that mutate anything (see commentBroadcaster.ts's own
    // comment), so there is nothing meaningful to replay into it. Anything
    // a client sent during initialization on this path is dropped, which
    // is exactly what happened before this buffer existed. Discarding
    // still detaches the temporary listener, leaving no dangling handler.
    buffer.discard();
    commentBroadcaster.join(roomId, ws);
    return;
  }

  const match = BOARD_ROOM_PATH_RE.exec(pathOnly);
  if (!match) {
    buffer.discard();
    ws.close(1008, 'Unknown room path');
    return;
  }
  const roomId = match[1];

  // useSync's client (see @tldraw/sync's useSync.js) always appends its own
  // sessionId — tab-scoped via tldraw's TAB_ID — as a query param on every
  // connection attempt, specifically so the SAME browser tab reconnecting
  // (network blip, laptop sleep/wake) presents the SAME sessionId and can
  // resume its prior session rather than starting a brand new one. Two tabs
  // on the same board get two different TAB_IDs, hence two sessions — which
  // is also what lets per-tab presence (Phase 2) tell them apart. Generating
  // our own id here instead of reading the client's would silently break
  // that reconnect continuity, so this must come from the client, not be
  // minted server-side.
  const sessionId = params.get('sessionId');
  if (!sessionId) {
    buffer.discard();
    ws.close(1008, 'Missing sessionId');
    return;
  }

  const access = await checkRoomAccess(roomId, token);
  if (!access.ok) {
    // AUTHORIZATION FAILED — buffered frames are dropped, never replayed.
    // An unauthorized client may have sent arbitrary frames during the
    // initialization window; none of them have been parsed, classified or
    // forwarded, and none of them ever reach TLSocketRoom. The close
    // code/reason are unchanged from before this buffer existed, so the
    // client observes exactly the same denial behavior as it always did.
    buffer.discard();
    ws.close(access.code, access.reason);
    return;
  }

  // The socket may have closed (or overflowed the buffer and been closed)
  // while the access check was in flight. Joining now would register a
  // session for a dead socket and leave dangling room membership behind,
  // so abandon instead — discard() is still called so no listener leaks.
  if (buffer.isAborted()) {
    buffer.discard();
    return;
  }

  await roomManager.join(
    roomId, sessionId, ws,
    { roll: access.roll, role: access.role },
    roleCanWriteCanvas(access.role, access.isArchived)
  );

  // Authorization succeeded, the room is loaded and joined, and
  // RoomManager has installed the real room socket gate (which is what
  // attaches the production 'message' listener to this same socket — see
  // roomSocketGate.ts). Only now is it safe to release the buffered
  // frames, and they are re-emitted through the socket's own emitter so
  // they travel the identical path a frame arriving one millisecond later
  // would: gate -> classification -> write check -> TLSocketRoom. This is
  // what makes the client's immediately-sent `connect` survive.
  buffer.replayAndDetach();
}

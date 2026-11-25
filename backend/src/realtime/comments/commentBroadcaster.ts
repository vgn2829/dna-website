import type { WebSocket } from 'ws';
import type { BoardComment } from './commentsStorage';

// ─────────────────────────────────────────────────────────────────────────
// COMMENT BROADCASTER — realtime fan-out for comment events, deliberately
// NOT built on TLSocketRoom/RoomManager. Read this before changing how
// comments reach connected clients.
//
// Why a second, separate WS channel instead of piggy-backing on the
// existing board room:
//
//   - TLSocketRoom's wire protocol is tldraw's own binary sync format for
//     TLRecord documents (shapes, assets, pages, presence). Comments are
//     NOT tldraw records — they must never appear in a document snapshot
//     (see board_comments' own schema comment: this is what makes "comment
//     actions never create board versions" true by construction, not a
//     rule to remember). There is no supported way to send an
//     out-of-band, non-document message over a TLSocketRoom's socket
//     without hand-rolling part of tldraw's sync wire format — exactly the
//     "custom synchronization engine" this whole rollout has consistently
//     avoided (see roomAccess.ts's own note reaching the same conclusion
//     for permission enforcement).
//
//   - This is still "reusing the existing websocket infrastructure," not
//     building another one: it shares the exact same upgrade entry point
//     (attachRealtimeServer / REALTIME_PATH_PREFIX in realtime/server.ts),
//     the same WebSocketServer instance, and the same authorization
//     function (checkRoomAccess) as the board room's own connection path —
//     see connectionHandler.ts, which now dispatches to either this or
//     RoomManager based on the upgrade path suffix. The only new thing is
//     a plain Set<WebSocket> per room and a JSON broadcast, not a second
//     transport, not a second auth model, not polling.
//
// This class holds NO comment data and makes NO database calls — it is
// pure fan-out, the same division of responsibility RoomManager keeps from
// roomPersistence.ts. routes/comments.ts calls commentsStorage for the
// write, then calls broadcast() here to tell already-connected clients
// what changed; a client that (re)connects later just calls the normal
// GET /comments REST endpoint to catch up, the same "REST for initial
// state, WS for live deltas" split @tldraw/sync itself uses (snapshot on
// connect, then a stream of ops).
// ─────────────────────────────────────────────────────────────────────────

export type CommentEventType = 'create' | 'edit' | 'delete' | 'resolve' | 'reopen';

export interface CommentEvent {
  type: CommentEventType;
  comment: BoardComment;
}

// LIVE REVOCATION (V2.6 Phase A) — the reason a connected socket now
// carries its owner's roll.
//
// Previously `rooms` was a plain Map<string, Set<WebSocket>>: the roll was
// computed by checkRoomAccess at connect time and then DISCARDED, so a
// connected comment socket had no identity and there was nothing any
// revocation mechanism could re-check. A user removed from a private board
// kept receiving every subsequent comment event on it — reproduced
// directly against this class (the revoked socket stayed open and received
// the post-revocation payload). Storing the roll is the minimum needed to
// make the existing periodic re-validation applicable to this channel too,
// exactly as it already applies to the canvas socket.
interface CommentSession {
  socket: WebSocket;
  roll: string;
  // When this session's read access was last confirmed against the
  // database, for the broadcast-time freshness check below.
  checkedAt: number;
  // De-duplicates concurrent re-checks for the same session.
  inFlight?: Promise<boolean>;
}

// How stale a comment-read authorization may be before a broadcast forces
// a fresh database check (V2.6 Phase A).
//
// The periodic re-validator (REVALIDATION_INTERVAL_MS, 15s) is what
// eventually CLOSES a revoked socket. On its own that left a window: a
// revoked user kept receiving comment events until the next tick —
// measured directly, a post-revocation comment containing private content
// was delivered before the socket closed. This TTL bounds that window to
// ~1s without adding a second timer.
//
// Cost is per comment EVENT, not per cursor/presence frame — comment
// events are rare (a person typing a comment produces one event on
// submit, not one per keystroke), so this is orders of magnitude cheaper
// than the canvas equivalent and deliberately mirrors the same TTL +
// in-flight de-duplication shape already proven in rooms.ts
// (WRITE_DECISION_TTL_MS).
export const COMMENT_READ_TTL_MS = 1000;

export class CommentBroadcaster {
  private rooms = new Map<string, Set<CommentSession>>();

  // Injected, not imported — the broadcaster stays unaware of what board
  // access means, exactly as it already was. Omitting it (as existing
  // tests and any non-board use do) disables the broadcast-time re-check
  // and leaves delivery behaviour unchanged.
  constructor(private checkReadAccess?: (roomId: string, roll: string) => Promise<boolean>) {}

  join(roomId: string, socket: WebSocket, roll: string): void {
    let sessions = this.rooms.get(roomId);
    if (!sessions) {
      sessions = new Set();
      this.rooms.set(roomId, sessions);
    }
    // checkedAt starts at "now": connectionHandler just ran a live
    // checkRoomAccess for this socket, so the decision is genuinely fresh.
    const session: CommentSession = { socket, roll, checkedAt: Date.now() };
    sessions.add(session);

    socket.on('close', () => {
      const current = this.rooms.get(roomId);
      if (!current) return;
      // Idempotent: Set.delete on an already-removed entry is a no-op, so
      // a double close (or a close arriving after disconnectRoll already
      // removed this session) cannot corrupt the map.
      current.delete(session);
      if (current.size === 0) this.rooms.delete(roomId);
    });

    // Comments is a receive-only channel for clients today (no client->
    // server messages are defined — every mutation goes through REST, per
    // the "do NOT trust the client" requirement: an attacker with an open
    // socket cannot write a comment by sending a crafted WS message,
    // because nothing here ever reads incoming frames as a command). A
    // stray incoming message is ignored, not an error, in case a future
    // client version sends a heartbeat/ping payload of its own.
    socket.on('message', () => {});
  }

  broadcast(roomId: string, event: CommentEvent): void {
    const sessions = this.rooms.get(roomId);
    if (!sessions || sessions.size === 0) return;
    const payload = JSON.stringify(event);

    for (const session of [...sessions]) {
      if (session.socket.readyState !== session.socket.OPEN) continue;

      // No checker configured — preserve the original immediate-delivery
      // behaviour exactly (the path existing tests take).
      if (!this.checkReadAccess) {
        this.send(roomId, session, payload);
        continue;
      }

      // Fresh enough to trust — deliver synchronously, as before. This is
      // the common case: a burst of comment activity on a board shares a
      // single check per session per TTL.
      if (Date.now() - session.checkedAt < COMMENT_READ_TTL_MS) {
        this.send(roomId, session, payload);
        continue;
      }

      // Stale — confirm CURRENT access before delivering. Delivery is
      // deferred, not skipped: a still-authorized session gets the event
      // a moment later. A revoked one gets nothing and is disconnected.
      void this.confirmThenSend(roomId, session, payload);
    }
  }

  private send(roomId: string, session: CommentSession, payload: string): void {
    try {
      if (session.socket.readyState === session.socket.OPEN) session.socket.send(payload);
    } catch (err) {
      console.error(`Realtime: failed to send comment event to a socket in room ${roomId}:`, err);
    }
  }

  private async confirmThenSend(roomId: string, session: CommentSession, payload: string): Promise<void> {
    let allowed: boolean;
    try {
      allowed = await this.recheck(roomId, session);
    } catch {
      // FAIL CLOSED — a transient DB error must never become an implicit
      // grant of continued read access to a private board's comments.
      allowed = false;
    }

    if (!allowed) {
      // Drop the event AND disconnect, rather than waiting for the
      // periodic tick to get around to it.
      this.disconnectRoll(roomId, session.roll);
      return;
    }
    // Re-check the room membership: the session may have been removed
    // (closed, or revoked by the periodic tick) while the check was in
    // flight.
    if (!this.rooms.get(roomId)?.has(session)) return;
    this.send(roomId, session, payload);
  }

  private recheck(roomId: string, session: CommentSession): Promise<boolean> {
    if (session.inFlight) return session.inFlight;
    const check = (async (): Promise<boolean> => {
      try {
        const allowed = await this.checkReadAccess!(roomId, session.roll);
        session.checkedAt = Date.now();
        return allowed;
      } finally {
        session.inFlight = undefined;
      }
    })();
    session.inFlight = check;
    return check;
  }

  // Every distinct roll currently connected to a room's comment channel.
  // Used by the periodic re-validator to know who to re-check, without
  // this class knowing what "access" means — the same division of
  // responsibility RoomManager.getSessionMetas already uses for the canvas
  // channel. Deduplicated: one person with three tabs is re-checked once.
  getConnectedRolls(roomId: string): string[] {
    const sessions = this.rooms.get(roomId);
    if (!sessions) return [];
    return [...new Set([...sessions].map(s => s.roll))];
  }

  // Every room with at least one connected comment socket. Mirrors
  // RoomManager.getActiveRoomIds so the re-validator can iterate both
  // channels the same way.
  getActiveRoomIds(): string[] {
    return [...this.rooms.keys()];
  }

  // Forcibly disconnects every socket a roll holds in a room — the comment
  // channel's equivalent of RoomManager.disconnectSession, and the whole
  // point of retaining the roll above. Closing is the correct action here
  // (rather than silently muting): this channel is receive-only, so there
  // is no "read-only" degradation to fall back to — either you may receive
  // the board's comments or you may not. The client's own reconnect logic
  // then re-attempts and is rejected by checkRoomAccess on the new
  // connection, which is what makes revocation stick.
  //
  // 1008 (Policy Violation) matches what checkRoomAccess itself returns for
  // permission_denied on the connect path, so a revoked user sees the same
  // close code whether they were denied at connect or disconnected later.
  disconnectRoll(roomId: string, roll: string): number {
    const sessions = this.rooms.get(roomId);
    if (!sessions) return 0;
    let closed = 0;
    for (const session of [...sessions]) {
      if (session.roll !== roll) continue;
      // Remove from the room BEFORE closing, so a broadcast racing with
      // this close can never reach a socket we have already decided is
      // unauthorized — the 'close' handler's own delete is then a no-op.
      sessions.delete(session);
      try {
        session.socket.close(1008, 'permission_denied');
      } catch {
        // Already closing/closed — the entry is gone either way.
      }
      closed++;
    }
    if (sessions.size === 0) this.rooms.delete(roomId);
    return closed;
  }

  // Diagnostic accessor, mirroring RoomManager.getActiveSessionCount's own
  // reasoning — not read anywhere yet, present for a future health check.
  getActiveSocketCount(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }
}

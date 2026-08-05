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

export class CommentBroadcaster {
  private rooms = new Map<string, Set<WebSocket>>();

  join(roomId: string, socket: WebSocket): void {
    let sockets = this.rooms.get(roomId);
    if (!sockets) {
      sockets = new Set();
      this.rooms.set(roomId, sockets);
    }
    sockets.add(socket);

    socket.on('close', () => {
      const current = this.rooms.get(roomId);
      if (!current) return;
      current.delete(socket);
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
    const sockets = this.rooms.get(roomId);
    if (!sockets || sockets.size === 0) return;
    const payload = JSON.stringify(event);
    for (const socket of sockets) {
      try {
        if (socket.readyState === socket.OPEN) socket.send(payload);
      } catch (err) {
        console.error(`Realtime: failed to send comment event to a socket in room ${roomId}:`, err);
      }
    }
  }

  // Diagnostic accessor, mirroring RoomManager.getActiveSessionCount's own
  // reasoning — not read anywhere yet, present for a future health check.
  getActiveSocketCount(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }
}

import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import { checkRoomAccess, type RoomRole } from './roomAccess';
import { RoomManager } from './rooms';
import type { RealtimeUpgradeHandler } from './server';

export interface StudentSessionMeta {
  roll: string;
  role: RoomRole;
}

// Board rooms are keyed by board.room_id, not board.id — room_id is the
// value already used to segment realtime state from the board's primary
// key (see backend/src/db/schema.ts's long-standing room_id column, unused
// until this rollout). The upgrade path is /api/realtime/boards/<roomId>.
const BOARD_ROOM_PATH_RE = /^boards\/([0-9a-fA-F-]{36})$/;

// Composes checkRoomAccess (authorization) and RoomManager (lifecycle) into
// the single onUpgrade callback attachRealtimeServer expects. This is the
// only place those two modules meet — RoomManager itself never calls
// checkRoomAccess, and checkRoomAccess never touches TLSocketRoom, so each
// stays independently testable and reusable (see their own doc comments).
export function createConnectionHandler(roomManager: RoomManager<StudentSessionMeta>): RealtimeUpgradeHandler {
  return (req: IncomingMessage, ws: WebSocket, roomPath: string) => {
    // handleConnection is async and called fire-and-forget (attachRealtimeServer's
    // onUpgrade callback is synchronous) — an unhandled rejection here (a DB
    // error from checkRoomAccess, a persistence failure from roomManager.join)
    // would otherwise be a process-crashing unhandled rejection, not just a
    // failed connection. One bad connection attempt must never take down
    // every other room's live sessions.
    handleConnection(req, ws, roomPath, roomManager).catch(err => {
      console.error('Realtime: unhandled error during connection setup:', err);
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
  roomManager: RoomManager<StudentSessionMeta>
): Promise<void> {
  const [pathOnly, query] = roomPath.split('?');
  const match = BOARD_ROOM_PATH_RE.exec(pathOnly);
  if (!match) {
    ws.close(1008, 'Unknown room path');
    return;
  }
  const roomId = match[1];
  const params = new URLSearchParams(query ?? '');
  const token = params.get('token');

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
    ws.close(1008, 'Missing sessionId');
    return;
  }

  const access = await checkRoomAccess(roomId, token);
  if (!access.ok) {
    ws.close(access.code, access.reason);
    return;
  }

  await roomManager.join(roomId, sessionId, ws, { roll: access.roll, role: access.role });
}

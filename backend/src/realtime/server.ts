import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { WebSocketServer, type WebSocket } from 'ws';

// Path prefix for realtime upgrade requests, e.g. /api/realtime/boards/<roomId>?token=...
// Kept under /api so it shares the same reverse-proxy/CORS-origin surface as
// the rest of the backend rather than needing a separate port or route.
export const REALTIME_PATH_PREFIX = '/api/realtime/';

export type RealtimeUpgradeHandler = (
  req: IncomingMessage,
  socket: WebSocket,
  roomPath: string
) => void;

// Global kill switch — read once at boot, not re-checked per request. This is
// deliberately an env var (not an app_settings DB row like public_meet_enabled):
// flipping it means "redeploy with the var unset", not "an admin session can
// toggle it live", which is the property you want for an emergency rollback
// of a still-maturing feature. See boards.realtime_enabled for the per-board
// half of the gate — both must be true for a given board to use this path.
export function isRealtimeGloballyEnabled(): boolean {
  return process.env.REALTIME_ENABLED === 'true';
}

// Attaches a WebSocketServer to the same HTTP server Express is already
// listening on, in `noServer` mode — Express keeps handling every normal
// HTTP request unchanged; only upgrade requests under REALTIME_PATH_PREFIX
// are intercepted here, and only when the global flag is on. Every other
// upgrade request (there are none elsewhere in this app today, but this is
// what makes that safe to add later) falls through untouched.
//
// Room-level logic (which board, auth, TLSocketRoom lookup) is intentionally
// NOT here — this module's only job is the transport-level handshake. See
// realtime/rooms.ts for the room manager wired in on top of this via
// `onUpgrade`.
export function attachRealtimeServer(httpServer: HttpServer, onUpgrade: RealtimeUpgradeHandler): WebSocketServer | null {
  if (!isRealtimeGloballyEnabled()) {
    console.log('Realtime collaboration disabled (REALTIME_ENABLED is not "true") — WS upgrade handler not attached.');
    return null;
  }

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url ?? '';
    if (!url.startsWith(REALTIME_PATH_PREFIX)) {
      // Not ours — leave the socket alone. If nothing else handles this
      // upgrade, the client's connection attempt just fails, same as today
      // (no other upgrade handler exists yet).
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const roomPath = url.slice(REALTIME_PATH_PREFIX.length);
      onUpgrade(req, ws, roomPath);
    });
  });

  console.log(`Realtime collaboration enabled — WS upgrades accepted under ${REALTIME_PATH_PREFIX}`);
  return wss;
}

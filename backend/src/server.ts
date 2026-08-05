import 'dotenv/config';

// ── Startup guards ─────────────────────────────────────────────────────────────
const required = ['ADMIN_PASSWORD', 'JWT_SECRET', 'DATABASE_URL'];
for (const v of required) {
  if (!process.env[v]) {
    console.error(`FATAL: ${v} environment variable is not set.`);
    process.exit(1);
  }
}

const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL);
const hasSupabaseKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
if (hasSupabaseUrl !== hasSupabaseKey) {
  console.error('FATAL: Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or neither (local storage).');
  process.exit(1);
}

// Student login depends on email OTP delivery. Without RESEND_API_KEY the mailer
// falls back to logging codes to the console — fine for dev, unacceptable in
// production — so refuse to boot rather than silently ship that fallback.
if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
  console.error('FATAL: RESEND_API_KEY is required in production (OTP email delivery). Refusing to start.');
  process.exit(1);
}

import http from 'http';
import { pool, query } from './db/client';
import { initSchema } from './db/schema';
import bcrypt from 'bcryptjs';
import { createApp } from './app';
import { attachRealtimeServer } from './realtime/server';
import { RoomManager } from './realtime/rooms';
import { BoardCanvasPersistence } from './realtime/roomPersistence';
import { createConnectionHandler, type StudentSessionMeta } from './realtime/connectionHandler';
import { VersionHistoryService } from './realtime/history/versionHistoryService';
import { RestoreService } from './realtime/history/restoreService';
import { CommentBroadcaster } from './realtime/comments/commentBroadcaster';
import { setCheckpointHook } from './routes/boards';

// roomId -> boardId: RoomManager and VersionHistoryService's onSnapshotChanged
// notifications only carry roomId (see rooms.ts — RoomManager "knows nothing
// about boards"). This is the one place that mapping is resolved, injected
// into VersionHistoryService/RestoreService as a plain function rather than
// either service importing `pool` directly — keeps both testable against a
// fake without a database (see this commit's backend test file).
async function resolveBoardIdForRoom(roomId: string): Promise<string | null> {
  const result = await pool.query('SELECT id FROM boards WHERE room_id = $1', [roomId]);
  return (result.rows[0] as { id: string } | undefined)?.id ?? null;
}

// The inverse lookup, for boards.ts's rename/archive checkpoint hook, which
// only has boardId (it's never touched RoomManager/roomId at all before
// this). Version history applies to every board with realtime_enabled OR
// not — a checkpoint just reads through BoardCanvasPersistence, which works
// identically whether a live TLSocketRoom currently exists for this board
// or not (see VersionHistoryService's own fallback to
// getCanvasSnapshotFromPersistence when RoomManager.getCurrentSnapshot
// returns null because nobody's connected right now).
async function getRoomIdForBoard(boardId: string): Promise<string | null> {
  const result = await pool.query('SELECT room_id FROM boards WHERE id = $1', [boardId]);
  return (result.rows[0] as { room_id: string | null } | undefined)?.room_id ?? null;
}

async function main() {
  await initSchema();

  // Auto-seed admin password hash on first startup
  const rows = await query<{ value: string }>('SELECT value FROM admin_config WHERE key=$1', ['admin_password_hash']);
  if (rows.length === 0) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD!, 12);
    await query('INSERT INTO admin_config(key,value) VALUES($1,$2)', ['admin_password_hash', hash]);
    console.log('Admin password initialized from ADMIN_PASSWORD env var.');
  }

  // Room lifecycle + persistence are deliberately separate objects composed
  // here, not a single class — see realtime/rooms.ts and
  // realtime/roomPersistence.ts's own doc comments for why. connectionHandler
  // is the only place authorization (roomAccess.ts) and lifecycle (rooms.ts)
  // meet, keeping both independently reusable for future collaboration
  // features (comments, presence, etc.) that aren't in scope for this commit.
  const persistence = new BoardCanvasPersistence();
  const roomManager = new RoomManager<StudentSessionMeta>(persistence);

  // Version history (Commit 5) — constructed here, BEFORE createApp(), since
  // the REST endpoints in routes/versions.ts need real service instances to
  // mount at all (see app.ts's optional `realtime` param). Both services
  // depend only on RoomManager's already-generic accessors
  // (onSnapshotChanged, getCurrentSnapshot, restoreSnapshot) and
  // BoardCanvasPersistence's load/save — neither one imports anything
  // WebSocket- or TLSocketRoom-specific, per versionHistoryService.ts's own
  // "why this stays independent of the realtime transport" comment.
  const versionHistoryService = new VersionHistoryService({
    roomManager,
    getCanvasSnapshotFromPersistence: (roomId) => persistence.load(roomId),
    resolveBoardIdForRoom,
  });
  versionHistoryService.start();

  // boards.ts's PUT /:id fires this on a successful rename/archive — see
  // that file's own comment on why the hook is injected rather than
  // imported directly. Resolves boardId -> roomId once here, then delegates
  // to the same checkpointRename/checkpointArchive methods the REST layer
  // would call, so rename/archive checkpoints go through the identical
  // dedup/retention path as every other checkpoint trigger.
  setCheckpointHook((boardId, trigger, actorRoll, actorName) => {
    void (async () => {
      const roomId = await getRoomIdForBoard(boardId);
      if (!roomId) return;
      if (trigger === 'rename') {
        await versionHistoryService.checkpointRename(boardId, roomId, actorRoll, actorName);
      } else {
        await versionHistoryService.checkpointArchive(boardId, roomId, actorRoll, actorName);
      }
    })().catch(err => {
      console.error(`Version history: ${trigger} checkpoint failed for board ${boardId}:`, err);
    });
  });

  const restoreService = new RestoreService({
    roomManager,
    persistCanvasSnapshot: (roomId, snapshot) => persistence.save(roomId, snapshot),
  });

  // Comments (Commit 6) — pure in-memory fan-out, no persistence/lifecycle
  // dependency at all (see commentBroadcaster.ts's own header comment), so
  // unlike roomManager it needs no constructor arguments. Shared between
  // the WS upgrade path (connectionHandler.ts, for live delivery) and the
  // REST router (routes/comments.ts, for broadcasting after each write) —
  // the same single-instance-shared-two-ways pattern roomManager itself
  // already uses.
  const commentBroadcaster = new CommentBroadcaster();

  const PORT = Number(process.env.PORT ?? 4000);
  const app = createApp({ versionHistoryService, restoreService, commentBroadcaster });
  // http.createServer(app) instead of app.listen() directly so the realtime
  // WS upgrade handler can attach to the same server/port — Express keeps
  // handling every normal HTTP request exactly as before; this only adds an
  // 'upgrade' listener alongside it. See realtime/server.ts.
  const httpServer = http.createServer(app);

  attachRealtimeServer(httpServer, createConnectionHandler(roomManager, commentBroadcaster));

  httpServer.listen(PORT, () => {
    const storage = (hasSupabaseUrl && hasSupabaseKey) ? 'Supabase Storage' : 'local disk';
    console.log(`DnA Club API running on port ${PORT} [storage: ${storage}]`);
  });
}

main().catch(err => {
  console.error('FATAL startup error:', err);
  process.exit(1);
});

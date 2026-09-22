import { Router, Request, Response } from 'express';
import { isRealtimeGloballyEnabled } from '../realtime/server';
import { checkRoomAccess, roleCanWriteCanvas, roleCanComment, type RoomAccessDenialReason } from '../realtime/roomAccess';
import { requireStudent } from '../middleware/studentAuth';
import { param } from '../routeParams';

const router = Router();

// GET /api/realtime/status
// The ONLY thing the frontend is allowed to know about the realtime global
// kill switch — whether it's on, nothing else. Reads the same env var the
// WS upgrade handler itself gates on (isRealtimeGloballyEnabled), so this
// can never drift from what the transport layer actually does. No auth
// required: this is a non-sensitive boolean, not a value that grants
// access to anything — BoardPage still needs board.realtime_enabled (from
// the authenticated GET /boards/:id call) AND this flag before it will
// even attempt a realtime connection, and the WS upgrade itself re-checks
// both server-side regardless of what the client believes.
router.get('/status', (_req: Request, res: Response) => {
  res.json({ enabled: isRealtimeGloballyEnabled() });
});

// GET /api/realtime/boards/:roomId/access
//
// Commit 7's answer to "clients should receive meaningful errors, do NOT
// silently ignore writes." The WS upgrade path (connectionHandler.ts)
// already computes and enforces the exact same access decision via
// checkRoomAccess — this endpoint calls THE SAME FUNCTION and exists
// purely so the frontend can learn the reason BEFORE opening a socket,
// because a WS close code alone can't reliably communicate it: verified
// directly against @tldraw/sync-core's ClientWebSocketAdapter source that
// any close code other than its own hardcoded NOT_FOUND (4099) is treated
// as `status: 'offline'` by useSync's ReconnectManager, which then keeps
// retrying indefinitely — a permission_denied close would otherwise look
// identical to a transient network drop to the client, and the
// ReconnectManager would retry forever against a condition that will
// never change. TldrawCanvasSync.tsx calls this once before constructing
// its useSync `uri`, and again on a periodic poll while connected (see
// that file's own comment on why polling, not an in-band WS notice, is
// how a permission REVOKED mid-session is surfaced) — this is
// intentionally the SAME source of truth the socket layer itself uses,
// not a second opinion that could drift.
router.get('/boards/:roomId/access', requireStudent, async (req: Request, res: Response) => {
  try {
    const roomId = param(req.params.roomId);
    // requireStudent already verified the token to get here — this
    // endpoint reuses checkRoomAccess with the ORIGINAL bearer token
    // (not just the already-extracted roll) so it exercises the exact
    // same code path the WS upgrade does, including the global-flag and
    // token checks, rather than a hand-assembled equivalent that could
    // silently diverge later.
    const token = req.headers.authorization?.slice('Bearer '.length) ?? null;
    const access = await checkRoomAccess(roomId, token);

    if (!access.ok) {
      const reason: RoomAccessDenialReason = access.reason;
      res.json({ ok: false, reason });
      return;
    }

    res.json({
      ok: true,
      role: access.role,
      canWriteCanvas: roleCanWriteCanvas(access.role, access.isArchived),
      canComment: roleCanComment(access.role),
    });
  } catch (err) {
    console.error('Realtime access pre-check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

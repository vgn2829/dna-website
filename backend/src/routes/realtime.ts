import { Router, Request, Response } from 'express';
import { isRealtimeGloballyEnabled } from '../realtime/server';

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

export default router;

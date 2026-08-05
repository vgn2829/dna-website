import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireStudent } from '../middleware/studentAuth';
import { pool } from '../db/client';
import { param } from '../routeParams';
import * as versionTimeline from '../realtime/history/versionTimeline';
import type { VersionHistoryService } from '../realtime/history/versionHistoryService';
import type { RestoreService } from '../realtime/history/restoreService';
import { getBoardRole, roleCanWriteCanvas } from '../realtime/roomAccess';

// ─────────────────────────────────────────────────────────────────────────
// Version history REST endpoints — deliberately a separate router/file
// from routes/boards.ts, not new routes bolted onto it. boards.ts has no
// dependency on the realtime module at all today (it's pure Postgres +
// Supabase Storage); threading VersionHistoryService/RestoreService through
// it would mean every existing boards.ts test/call site suddenly needs
// realtime wiring it doesn't care about. This router is only mounted when
// that wiring exists (see app.ts's optional `realtime` param) — in test
// environments that call createApp() with no args, these routes simply
// don't exist, which is correct: there is nothing version-history-related
// to test without a real RoomManager behind it (see this commit's own
// backend test file for what CAN be tested in isolation — the service
// logic, via a fake RoomManager, not these HTTP routes).
//
// Permission model (Commit 7): uses roomAccess.ts's getBoardRole/
// roleCanWriteCanvas — the SAME classification the realtime write gate
// itself now enforces (roomSocketGate.ts) — rather than this file's own
// former canEditBoard helper. That helper had a real, previously
// unnoticed gap this refactor closes: it never checked board.is_archived,
// so restoring a version (a write) on an archived board was permitted —
// inconsistent with the realtime canvas layer's own archived-board
// write-freeze (see roomAccess.ts's classifyBoardAccess). Restore goes
// through Express/requireStudent, so this check is REAL server-side
// enforcement, not the WS transport's advisory-only equivalent that used
// to exist before Commit 7.
// ─────────────────────────────────────────────────────────────────────────

async function getBoardRoomId(boardId: string): Promise<string | null> {
  const result = await pool.query('SELECT room_id FROM boards WHERE id = $1', [boardId]);
  return (result.rows[0] as { room_id: string | null } | undefined)?.room_id ?? null;
}

// Generic over SessionMeta purely so this accepts whatever concrete
// RoomManager<SessionMeta>-backed services app.ts passes through from
// server.ts — see versionHistoryService.ts's own comment on why those
// services are generic in the first place. Nothing in this router actually
// reads SessionMeta.
export function createVersionsRouter<SessionMeta = unknown>(services: {
  versionHistoryService: VersionHistoryService<SessionMeta>;
  restoreService: RestoreService<SessionMeta>;
}): Router {
  const router = Router();

  // GET /api/boards/:id/versions
  // Lazily loaded — the frontend only calls this when the Version History
  // panel is actually opened (see the PERFORMANCE requirement: never
  // download all snapshots on board open). Returns metadata only, never
  // snapshot content — see versionStorage.ts's own comment on why.
  router.get('/:id/versions', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);

      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanWriteCanvas(boardRole.role, boardRole.isArchived)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(50).optional(),
        before: z.string().optional(),
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid query parameters' });
      }

      const page = await versionTimeline.getPage(boardId, parsed.data);
      res.json(page);
    } catch (err) {
      console.error('List versions error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/boards/:id/versions
  // Explicit "save a version now" checkpoint — the one manual trigger from
  // the spec's checkpoint-strategy list initiated directly by a user
  // action rather than a side effect of another endpoint (rename/archive
  // trigger checkpoints from within routes/boards.ts itself — see that
  // file's own changes in this commit).
  router.post('/:id/versions', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);

      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanWriteCanvas(boardRole.role, boardRole.isArchived)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const roomId = await getBoardRoomId(boardId);
      if (!roomId) {
        return res.status(404).json({ error: 'Board not found' });
      }

      const bodySchema = z.object({ description: z.string().max(200).optional() });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      const studentResult = await pool.query(
        'SELECT name FROM student_sessions WHERE roll_number = $1', [roll]
      );
      const actorName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

      const version = await services.versionHistoryService.checkpointExplicit(
        boardId, roomId, roll, actorName, parsed.data.description
      );
      if (!version) {
        return res.status(409).json({ error: 'No content to checkpoint yet' });
      }

      res.status(201).json(version);
    } catch (err) {
      console.error('Create version error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/boards/:id/versions/:versionId/restore
  router.post('/:id/versions/:versionId/restore', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);
      const versionId = param(req.params.versionId);

      // Real server-side write enforcement — a restore is exactly the
      // kind of write that must be permission-checked, and now also
      // correctly rejects a restore attempt on an archived board (see
      // this file's own header comment on the gap this closed).
      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanWriteCanvas(boardRole.role, boardRole.isArchived)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const roomId = await getBoardRoomId(boardId);
      if (!roomId) {
        return res.status(404).json({ error: 'Board not found' });
      }

      const studentResult = await pool.query(
        'SELECT name FROM student_sessions WHERE roll_number = $1', [roll]
      );
      const actorName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

      const result = await services.restoreService.restore(boardId, roomId, versionId, roll, actorName);
      if (!result.ok) {
        return res.status(404).json({ error: 'Version not found' });
      }

      res.json({
        success: true,
        version: result.version,
        // Tells the frontend whether connected collaborators just went
        // through a reconnect cycle (see rooms.ts's restoreSnapshot doc
        // comment) — lets the UI show an accurate "collaborators are
        // reconnecting" hint instead of a generic success message when
        // that's actually what just happened.
        hadLiveRoom: result.hadLiveRoom,
      });
    } catch (err) {
      console.error('Restore version error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

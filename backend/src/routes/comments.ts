import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireStudent } from '../middleware/studentAuth';
import { pool } from '../db/client';
import { param } from '../routeParams';
import * as commentsStorage from '../realtime/comments/commentsStorage';
import type { CommentBroadcaster } from '../realtime/comments/commentBroadcaster';
import type { BoardComment } from '../realtime/comments/commentsStorage';

// ─────────────────────────────────────────────────────────────────────────
// COMMENTS REST ENDPOINTS — a dedicated router, same reasoning as
// routes/versions.ts: boards.ts has no realtime dependency today, and every
// existing test call site (createApp() with no args) should keep getting
// an app with no comment routes mounted rather than needing a
// CommentBroadcaster it doesn't care about.
//
// PERMISSION MODEL (Owner / Editor / Commenter / Viewer from the spec,
// mapped onto this codebase's actual, existing two-tier board permission
// system — see roomAccess.ts / routes/boards.ts's canEdit for the model
// this reuses rather than inventing a third, parallel one):
//
//   - "can read" (isMember, or board.visibility === 'shared') is the bar
//     for creating comments/replies and reading the thread — this is the
//     Commenter/Viewer-with-comment-rights tier from the spec. Plain
//     Figma/FigJam/Miro all let anyone with view access comment; there is
//     no separate "Commenter" role in this app's data model, and adding
//     one would be exactly the over-engineering the spec's DATA MODEL
//     section says to avoid ("design the simplest production-quality
//     schema... do not over-engineer").
//   - "can edit the board" (canEditBoard — owner/member/edit_mode=anyone,
//     same helper versions.ts already uses) additionally grants: resolve/
//     reopen any thread, and edit/delete ANY comment (not just your own).
//   - A comment's OWN AUTHOR may always edit or delete their own comment,
//     even without board-edit access — this is the "Commenter" tier's
//     actual capability (comment on a board you can't edit, then manage
//     your own comment), matching Figma's own behavior.
//   - A true read-only Viewer (no read access at all — private board,
//     not a member) is rejected by canReadBoard below with 403, same as
//     every other board-scoped endpoint in this app.
//
// Every check here is REAL server-side enforcement via Express/
// requireStudent — never the WS transport's advisory-only `role` (see
// roomAccess.ts's own "known limitation" comment, which explicitly lists
// Comments as a feature that must close this gap before shipping; this
// router is that closure for the comments surface, exactly like
// routes/versions.ts already did for restore).
// ─────────────────────────────────────────────────────────────────────────

async function canReadBoard(boardId: string, roll: string): Promise<boolean> {
  const board = await pool.query(
    'SELECT owner_roll, visibility FROM boards WHERE id = $1', [boardId]
  );
  if (board.rows.length === 0) return false;
  const b = board.rows[0] as { owner_roll: string; visibility: string };
  if (b.owner_roll === roll) return true;
  if (b.visibility === 'shared') return true;
  const mem = await pool.query(
    'SELECT 1 FROM board_members WHERE board_id = $1 AND roll_number = $2', [boardId, roll]
  );
  return mem.rows.length > 0;
}

async function canEditBoard(boardId: string, roll: string): Promise<boolean> {
  const board = await pool.query(
    'SELECT owner_roll, visibility, edit_mode FROM boards WHERE id = $1', [boardId]
  );
  if (board.rows.length === 0) return false;
  const b = board.rows[0] as { owner_roll: string; visibility: string; edit_mode: string };
  if (b.owner_roll === roll) return true;
  if (b.edit_mode === 'anyone' && b.visibility === 'shared') return true;
  const mem = await pool.query(
    'SELECT 1 FROM board_members WHERE board_id = $1 AND roll_number = $2', [boardId, roll]
  );
  return mem.rows.length > 0;
}

async function getBoardRoomId(boardId: string): Promise<string | null> {
  const result = await pool.query('SELECT room_id FROM boards WHERE id = $1', [boardId]);
  return (result.rows[0] as { room_id: string | null } | undefined)?.room_id ?? null;
}

async function getStudentName(roll: string): Promise<string | null> {
  const result = await pool.query('SELECT name FROM student_sessions WHERE roll_number = $1', [roll]);
  return (result.rows[0] as { name: string } | undefined)?.name ?? null;
}

const CONTENT_MAX_LENGTH = 2000;

// Anchor fields are optional at the schema level — they're only REQUIRED
// for a thread root (no parentCommentId) and are ignored for a reply
// (inherited from the root instead; see the POST handler below). Zod's
// discriminated/tagged unions don't compose cleanly with an independently
// optional parentCommentId sibling field here, so the actual "root requires
// a valid anchor" invariant is checked imperatively in the handler, where
// the parentCommentId branch is already being decided anyway.
const createCommentSchema = z.object({
  parentCommentId: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(CONTENT_MAX_LENGTH),
  anchorType: z.enum(['canvas', 'shape']).optional(),
  anchorShapeId: z.string().min(1).max(200).optional(),
  anchorX: z.number().finite().optional(),
  anchorY: z.number().finite().optional(),
});

export function createCommentsRouter(broadcaster: CommentBroadcaster): Router {
  const router = Router();

  // GET /api/boards/:id/comments?includeResolved=true
  router.get('/:id/comments', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);

      if (!(await canReadBoard(boardId, roll))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const includeResolved = req.query.includeResolved === 'true';
      const comments = await commentsStorage.listComments(boardId, { includeResolved });
      res.json({ comments });
    } catch (err) {
      console.error('List comments error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/boards/:id/comments — create a thread root (no
  // parentCommentId, anchor required) or a reply (parentCommentId set, no
  // anchor — inherited from the root).
  router.post('/:id/comments', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);

      if (!(await canReadBoard(boardId, roll))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const parsed = createCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      const body = parsed.data;

      let anchor: { anchorType: 'canvas' | 'shape'; anchorShapeId?: string; anchorX: number; anchorY: number };
      if (body.parentCommentId) {
        // Reply — inherit anchor from the root so every reply renders at
        // the same pin as its thread, regardless of what (if anything) the
        // client sent for anchor fields.
        const root = await commentsStorage.getComment(boardId, body.parentCommentId);
        if (!root || root.deletedAt || root.parentCommentId) {
          return res.status(404).json({ error: 'Thread not found' });
        }
        anchor = {
          anchorType: root.anchorType,
          anchorShapeId: root.anchorShapeId ?? undefined,
          anchorX: root.anchorX,
          anchorY: root.anchorY,
        };
      } else {
        if (body.anchorType === undefined || body.anchorX === undefined || body.anchorY === undefined) {
          return res.status(400).json({ error: 'A new thread requires an anchor' });
        }
        if (body.anchorType === 'shape' && !body.anchorShapeId) {
          return res.status(400).json({ error: 'A shape-anchored thread requires anchorShapeId' });
        }
        anchor = {
          anchorType: body.anchorType,
          anchorShapeId: body.anchorShapeId,
          anchorX: body.anchorX,
          anchorY: body.anchorY,
        };
      }

      const authorName = await getStudentName(roll);
      const comment = await commentsStorage.createComment({
        boardId,
        parentCommentId: body.parentCommentId ?? null,
        authorRoll: roll,
        authorName,
        anchorType: anchor.anchorType,
        anchorShapeId: anchor.anchorShapeId ?? null,
        anchorX: anchor.anchorX,
        anchorY: anchor.anchorY,
        content: body.content,
      });

      await broadcastIfConnected(boardId, { type: 'create', comment });
      res.status(201).json(comment);
    } catch (err) {
      console.error('Create comment error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/boards/:id/comments/:commentId — edit content. Own author, or
  // anyone with board-edit access (see this file's own permission-model
  // comment above).
  router.put('/:id/comments/:commentId', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);
      const commentId = param(req.params.commentId);

      const existing = await commentsStorage.getComment(boardId, commentId);
      if (!existing || existing.deletedAt) {
        return res.status(404).json({ error: 'Comment not found' });
      }
      const isAuthor = existing.authorRoll === roll;
      if (!isAuthor && !(await canEditBoard(boardId, roll))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const bodySchema = z.object({ content: z.string().trim().min(1).max(CONTENT_MAX_LENGTH) });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      const updated = await commentsStorage.updateCommentContent(boardId, commentId, parsed.data.content);
      if (!updated) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      await broadcastIfConnected(boardId, { type: 'edit', comment: updated });
      res.json(updated);
    } catch (err) {
      console.error('Edit comment error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/boards/:id/comments/:commentId — soft delete. Own author,
  // or anyone with board-edit access.
  router.delete('/:id/comments/:commentId', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);
      const commentId = param(req.params.commentId);

      const existing = await commentsStorage.getComment(boardId, commentId);
      if (!existing || existing.deletedAt) {
        return res.status(404).json({ error: 'Comment not found' });
      }
      const isAuthor = existing.authorRoll === roll;
      if (!isAuthor && !(await canEditBoard(boardId, roll))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const deleted = await commentsStorage.softDeleteComment(boardId, commentId);
      if (!deleted) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      await broadcastIfConnected(boardId, { type: 'delete', comment: deleted });
      res.json({ success: true });
    } catch (err) {
      console.error('Delete comment error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/boards/:id/comments/:commentId/resolve — thread roots only.
  // Requires board-edit access (not just authorship) — resolving affects
  // what every collaborator sees by default (resolved threads hide), so
  // this is a board-moderation action, not a private one, matching
  // Figma/FigJam's own "anyone who can edit resolves" behavior.
  router.post('/:id/comments/:commentId/resolve', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);
      const commentId = param(req.params.commentId);

      if (!(await canEditBoard(boardId, roll))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const existing = await commentsStorage.getComment(boardId, commentId);
      if (!existing || existing.deletedAt) {
        return res.status(404).json({ error: 'Comment not found' });
      }
      if (existing.parentCommentId) {
        return res.status(400).json({ error: 'Only a thread root can be resolved' });
      }

      const resolved = await commentsStorage.resolveComment(boardId, commentId, roll);
      if (!resolved) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      await broadcastIfConnected(boardId, { type: 'resolve', comment: resolved });
      res.json(resolved);
    } catch (err) {
      console.error('Resolve comment error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/boards/:id/comments/:commentId/reopen
  router.post('/:id/comments/:commentId/reopen', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);
      const commentId = param(req.params.commentId);

      if (!(await canEditBoard(boardId, roll))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const existing = await commentsStorage.getComment(boardId, commentId);
      if (!existing || existing.deletedAt) {
        return res.status(404).json({ error: 'Comment not found' });
      }
      if (existing.parentCommentId) {
        return res.status(400).json({ error: 'Only a thread root can be reopened' });
      }

      const reopened = await commentsStorage.reopenComment(boardId, commentId);
      if (!reopened) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      await broadcastIfConnected(boardId, { type: 'reopen', comment: reopened });
      res.json(reopened);
    } catch (err) {
      console.error('Reopen comment error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Broadcasts over the comments WS channel keyed by room_id (same key
  // RoomManager/CommentBroadcaster.join both use) — resolved once per
  // request rather than threading roomId through every handler above, so a
  // board without a room_id (should not happen post-backfill, but matches
  // versions.ts's own defensive style) just silently sends to zero sockets
  // instead of failing the REST request, since the write already
  // succeeded and broadcast is a best-effort live-update side channel, not
  // the source of truth (see commentBroadcaster.ts's own header comment on
  // "REST for initial state, WS for live deltas").
  async function broadcastIfConnected(boardId: string, event: { type: 'create' | 'edit' | 'delete' | 'resolve' | 'reopen'; comment: BoardComment }): Promise<void> {
    const roomId = await getBoardRoomId(boardId);
    if (!roomId) return;
    broadcaster.broadcast(roomId, event);
  }

  return router;
}

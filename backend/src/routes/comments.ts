import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireStudent } from '../middleware/studentAuth';
import { pool } from '../db/client';
import { param } from '../routeParams';
import * as commentsStorage from '../realtime/comments/commentsStorage';
import type { CommentBroadcaster } from '../realtime/comments/commentBroadcaster';
import type { BoardComment } from '../realtime/comments/commentsStorage';
import { getBoardRole, roleCanWriteCanvas, roleCanComment } from '../realtime/roomAccess';
import { notifyCommentCreated, notifyCommentReplied } from '../services/notificationService';

// ─────────────────────────────────────────────────────────────────────────
// COMMENTS REST ENDPOINTS — a dedicated router, same reasoning as
// routes/versions.ts: boards.ts has no realtime dependency today, and every
// existing test call site (createApp() with no args) should keep getting
// an app with no comment routes mounted rather than needing a
// CommentBroadcaster it doesn't care about.
//
// PERMISSION MODEL (Owner / Editor / Commenter / Viewer) — Commit 7
// replaced this file's own hand-rolled canReadBoard/canEditBoard helpers
// with roomAccess.ts's getBoardRole(), the same role classification the
// realtime transport itself now enforces (see roomAccess.ts's own
// "COMMIT 7" comment). This was a real duplication before: two separate
// functions computing "can this roll write to this board" from the same
// owner_roll/edit_mode/visibility/board_members facts, with no guarantee
// they'd stay in sync if one changed. There is now exactly one place that
// logic lives.
//
//   - roleCanComment(role) (true for owner/editor/commenter, false only
//     for the reserved 'viewer' tier — see roomAccess.ts) is the bar for
//     creating comments/replies and reading the thread. Plain Figma/
//     FigJam/Miro all let anyone with view access comment; there is no
//     separate DB-level "Commenter" role, and adding one would be exactly
//     the over-engineering the Commit 6 spec's DATA MODEL section said to
//     avoid — Commenter is a classification of existing read-access
//     facts, not new storage.
//   - roleCanWriteCanvas(role) (true for owner/editor) additionally
//     grants: resolve/reopen any thread, and edit/delete ANY comment (not
//     just your own) — this is the canvas-adjacent moderation capability,
//     reusing the exact same predicate the realtime write gate uses for
//     the canvas itself (roomSocketGate.ts), not a separate "can edit
//     comments" concept.
//   - A comment's OWN AUTHOR may edit or delete their own comment without
//     write-canvas access — this is the Commenter tier's actual capability
//     (comment on a board you can't edit, then manage your own comment),
//     matching Figma's own behavior. AUTHORSHIP DOES NOT BYPASS CURRENT
//     BOARD AUTHORIZATION (V2.6 Phase A): the author still has to pass
//     roleCanComment against CURRENT board access first. Before this, the
//     author branch skipped getBoardRole entirely, so a user whose board
//     access had been revoked could keep editing and soft-deleting their
//     own comments indefinitely — each mutation also broadcasting to every
//     collaborator still on the board. Reproduced against the real router
//     (PUT and DELETE both returned 200 after revocation, and the row was
//     genuinely mutated) before being fixed here. Authorship is now a
//     NARROWING of an existing permission, never a substitute for one —
//     the same invariant V2.5 established for canvas writes.
//   - getBoardRole returning null (no read access at all — private board,
//     not a member) is rejected with 403, same as every other
//     board-scoped endpoint in this app.
//
// Every check here is REAL server-side enforcement via Express/
// requireStudent — never the WS transport's advisory-only `role` used to
// be (see roomAccess.ts's own history on that — Commit 7 closed it for
// the canvas transport itself; this router already had real REST
// enforcement since Commit 6, now sharing its logic with that fix).
// ─────────────────────────────────────────────────────────────────────────

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
  // Which tldraw page the anchor lives on (V2.6 Phase B). Optional at the
  // schema level: a reply inherits it from the thread root, and a client
  // older than this change simply omits it (the comment is then stored
  // with a NULL page and behaves exactly as every pre-Phase-B comment
  // does — see schema.ts's compatibility note).
  anchorPageId: z.string().min(1).max(200).optional(),
});

export function createCommentsRouter(broadcaster: CommentBroadcaster): Router {
  const router = Router();

  // GET /api/boards/:id/comments?includeResolved=true
  router.get('/:id/comments', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);

      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanComment(boardRole.role)) {
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

      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanComment(boardRole.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const parsed = createCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request' });
      }
      const body = parsed.data;

      let anchor: {
        anchorType: 'canvas' | 'shape'; anchorShapeId?: string;
        anchorX: number; anchorY: number; anchorPageId?: string;
      };
      // Hoisted out of the if-branch below so the notification block
      // further down (which needs the root's author for a reply) doesn't
      // have to re-fetch it.
      let threadRoot: BoardComment | null = null;
      if (body.parentCommentId) {
        // Reply — inherit anchor from the root so every reply renders at
        // the same pin as its thread, regardless of what (if anything) the
        // client sent for anchor fields.
        const root = await commentsStorage.getComment(boardId, body.parentCommentId);
        if (!root || root.deletedAt || root.parentCommentId) {
          return res.status(404).json({ error: 'Thread not found' });
        }
        threadRoot = root;
        anchor = {
          anchorType: root.anchorType,
          anchorShapeId: root.anchorShapeId ?? undefined,
          anchorX: root.anchorX,
          anchorY: root.anchorY,
          // Inherited too, so a reply can never land on a different page
          // from its own thread root — including inheriting NULL from a
          // legacy root, which keeps that whole thread legacy-behaving.
          anchorPageId: root.anchorPageId ?? undefined,
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
          anchorPageId: body.anchorPageId,
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
        anchorPageId: anchor.anchorPageId ?? null,
        content: body.content,
      });

      await broadcastIfConnected(boardId, { type: 'create', comment });

      // Best-effort — a notification failure must never fail the comment
      // creation itself (the comment already exists at this point; the
      // client got a 201 for a real, persisted comment). Exactly one of
      // the two branches below runs per request: a reply notifies the
      // THREAD ROOT's author (not necessarily the board owner — see
      // notifyCommentReplied's own doc comment), a new thread notifies the
      // board owner. Both service functions already no-op on
      // self-notification, so no separate "don't notify yourself" check
      // is needed here.
      (async () => {
        const boardResult = await pool.query('SELECT owner_roll, name FROM boards WHERE id = $1', [boardId]);
        const board = boardResult.rows[0] as { owner_roll: string; name: string } | undefined;
        if (!board) return;

        if (threadRoot) {
          await notifyCommentReplied({
            recipientRoll: threadRoot.authorRoll,
            actorRoll: roll,
            actorName: authorName,
            boardId,
            boardName: board.name,
            commentId: comment.id,
          });
        } else {
          await notifyCommentCreated({
            recipientRoll: board.owner_roll,
            actorRoll: roll,
            actorName: authorName,
            boardId,
            boardName: board.name,
            commentId: comment.id,
          });
        }
      })().catch(err => console.error('Comment notification failed (non-fatal):', err));

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

      // CURRENT board access is checked FIRST, unconditionally — authorship
      // is a narrowing of an existing permission, never a substitute for
      // one. See this file's header comment (AUTHORSHIP DOES NOT BYPASS
      // CURRENT BOARD AUTHORIZATION) for the vulnerability this closes.
      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanComment(boardRole.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // Then the pre-existing policy: your own comment, or board-edit
      // (moderation) access over anyone's.
      const isAuthor = existing.authorRoll === roll;
      if (!isAuthor && !roleCanWriteCanvas(boardRole.role, boardRole.isArchived)) {
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

      // CURRENT board access first, unconditionally — same rule as PUT
      // above: authorship narrows an existing permission, it never
      // substitutes for one.
      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanComment(boardRole.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const isAuthor = existing.authorRoll === roll;
      if (!isAuthor && !roleCanWriteCanvas(boardRole.role, boardRole.isArchived)) {
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

  // GET /api/boards/:id/comments/read-state — this user's watermark for
  // this board (V2.6 Phase E). null means "never looked", which the client
  // renders as everything unread.
  //
  // Read state is strictly per (board, caller): the roll comes from the
  // verified token, never from the request, so one user can neither read
  // nor affect another's state. A revoked user is rejected by the same
  // roleCanComment bar the list endpoint uses, so they cannot learn that a
  // board has new activity either.
  router.get('/:id/comments/read-state', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);

      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanComment(boardRole.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const lastSeenAt = await commentsStorage.getLastSeenAt(boardId, roll);
      res.json({ lastSeenAt });
    } catch (err) {
      console.error('Get comment read-state error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/boards/:id/comments/read-state — move this user's watermark
  // forward. The timestamp is generated SERVER-side rather than taken from
  // the body, so a client cannot mark itself read into the future and
  // permanently suppress genuine unread activity.
  router.post('/:id/comments/read-state', requireStudent, async (req: Request, res: Response) => {
    try {
      const roll = req.studentRoll!;
      const boardId = param(req.params.id);

      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanComment(boardRole.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const lastSeenAt = await commentsStorage.markSeen(boardId, roll, new Date().toISOString());
      res.json({ lastSeenAt });
    } catch (err) {
      console.error('Set comment read-state error:', err);
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

      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanWriteCanvas(boardRole.role, boardRole.isArchived)) {
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

      const boardRole = await getBoardRole(boardId, roll);
      if (boardRole === null || !roleCanWriteCanvas(boardRole.role, boardRole.isArchived)) {
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

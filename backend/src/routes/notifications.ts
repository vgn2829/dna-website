import { Router, Request, Response } from 'express';
import { pool } from '../db/client';
import { param } from '../routeParams';
import { requireStudent } from '../middleware/studentAuth';
import type { NotificationRow } from '../services/notificationService';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS — read side. Creation lives entirely in
// services/notificationService.ts, called from the existing mutation
// routes (boards.ts's member-add, workspaces.ts's member-add/role-change,
// comments.ts's comment-create) — this file only ever reads/updates rows
// for the AUTHENTICATED caller's own recipient_roll, never anyone else's.
// No realtime channel: the panel refetches on open (see this file's own
// GET handler) — same "poll/refetch on open, no new WebSocket
// infrastructure" approach the spec asked for, consistent with how e.g.
// WorkspaceSettingsModal.tsx already fetches fresh on open rather than
// subscribing to live updates.
// ─────────────────────────────────────────────────────────────────────────

function toPublicNotification(row: NotificationRow) {
  return {
    id: row.id,
    actorRoll: row.actor_roll,
    actorName: row.actor_name,
    type: row.type,
    boardId: row.board_id,
    boardName: row.board_name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    commentId: row.comment_id,
    read: row.read_at !== null,
    createdAt: row.created_at,
  };
}

// GET /api/notifications?unread_only=true&limit=&cursor=
// Always scoped to req.studentRoll — there is no recipient/roll query
// param at all, so there is nothing for a client to spoof here.
router.get('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const unreadOnly = req.query.unread_only === 'true';

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 30;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const conditions = ['recipient_roll = $1'];
    const params: unknown[] = [roll];
    if (unreadOnly) conditions.push('read_at IS NULL');
    if (cursor) {
      params.push(cursor);
      conditions.push(`(created_at, id) < (SELECT created_at, id FROM notifications WHERE id = $${params.length})`);
    }
    params.push(limit);

    const result = await pool.query(
      `SELECT * FROM notifications WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params
    );

    const unreadCountResult = await pool.query(
      'SELECT COUNT(*)::int as count FROM notifications WHERE recipient_roll = $1 AND read_at IS NULL',
      [roll]
    );

    const rows = result.rows as NotificationRow[];
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    res.json({
      notifications: rows.map(toPublicNotification),
      unreadCount: (unreadCountResult.rows[0] as { count: number }).count,
      nextCursor,
    });
  } catch (err) {
    console.error('List notifications error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notifications/:id/read — idempotent (marking an already-read
// notification read again just re-confirms success, no error).
router.post('/:id/read', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    // WHERE recipient_roll = $2 is the entire authorization check here —
    // a notification belonging to someone else's recipient_roll simply
    // matches zero rows, same "scoped query, not a separate permission
    // check" pattern workspaces.ts's getMembership already uses.
    const result = await pool.query(
      `UPDATE notifications SET read_at = $1 WHERE id = $2 AND recipient_roll = $3 AND read_at IS NULL RETURNING *`,
      [new Date().toISOString(), id, roll]
    );

    if (result.rows.length === 0) {
      // Either it doesn't exist, isn't this caller's, or was already
      // read — re-fetch to distinguish "already read" (still a success)
      // from "not found/not yours" (404), rather than assuming either.
      const existing = await pool.query(
        'SELECT * FROM notifications WHERE id = $1 AND recipient_roll = $2',
        [id, roll]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }
      return res.json(toPublicNotification(existing.rows[0] as NotificationRow));
    }

    res.json(toPublicNotification(result.rows[0] as NotificationRow));
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notifications/read-all
router.post('/read-all', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const result = await pool.query(
      `UPDATE notifications SET read_at = $1 WHERE recipient_roll = $2 AND read_at IS NULL`,
      [new Date().toISOString(), roll]
    );
    res.json({ success: true, markedCount: result.rowCount ?? 0 });
  } catch (err) {
    console.error('Mark all notifications read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

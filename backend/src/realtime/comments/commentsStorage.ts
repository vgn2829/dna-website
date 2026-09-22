import { v4 as uuidv4 } from 'uuid';
import { pool } from '../../db/client';

// ─────────────────────────────────────────────────────────────────────────
// COMMENTS STORAGE — pure database access for board_comments. Mirrors
// history/versionStorage.ts's own shape deliberately: no policy lives here
// (no permission checks, no broadcast, no version-history interaction) —
// only reads and writes against Postgres. Callers (routes/comments.ts) are
// responsible for authorization and for telling CommentBroadcaster what
// happened; this module doesn't know either exists.
// ─────────────────────────────────────────────────────────────────────────

export type CommentAnchorType = 'canvas' | 'shape';

export interface BoardComment {
  id: string;
  boardId: string;
  parentCommentId: string | null;
  authorRoll: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedByRoll: string | null;
  deletedAt: string | null;
  anchorType: CommentAnchorType;
  anchorShapeId: string | null;
  anchorX: number;
  anchorY: number;
  content: string;
}

export interface CreateCommentInput {
  boardId: string;
  parentCommentId?: string | null;
  authorRoll: string;
  authorName: string | null;
  anchorType: CommentAnchorType;
  anchorShapeId?: string | null;
  anchorX: number;
  anchorY: number;
  content: string;
}

function rowToComment(row: Record<string, unknown>): BoardComment {
  return {
    id: row.id as string,
    boardId: row.board_id as string,
    parentCommentId: (row.parent_comment_id as string | null) ?? null,
    authorRoll: row.author_roll as string,
    authorName: (row.author_name as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
    resolvedByRoll: (row.resolved_by_roll as string | null) ?? null,
    deletedAt: (row.deleted_at as string | null) ?? null,
    anchorType: row.anchor_type as CommentAnchorType,
    anchorShapeId: (row.anchor_shape_id as string | null) ?? null,
    anchorX: Number(row.anchor_x),
    anchorY: Number(row.anchor_y),
    content: row.content as string,
  };
}

const SELECT_COLUMNS = `
  id, board_id, parent_comment_id, author_roll, author_name,
  created_at, updated_at, resolved_at, resolved_by_roll, deleted_at,
  anchor_type, anchor_shape_id, anchor_x, anchor_y, content
`;

export async function createComment(input: CreateCommentInput): Promise<BoardComment> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const result = await pool.query(
    `INSERT INTO board_comments
       (id, board_id, parent_comment_id, author_roll, author_name,
        created_at, updated_at, anchor_type, anchor_shape_id, anchor_x, anchor_y, content)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11)
     RETURNING ${SELECT_COLUMNS}`,
    [
      id, input.boardId, input.parentCommentId ?? null, input.authorRoll, input.authorName,
      now, input.anchorType, input.anchorShapeId ?? null, input.anchorX, input.anchorY, input.content,
    ]
  );
  return rowToComment(result.rows[0] as Record<string, unknown>);
}

// Every non-deleted comment for a board, thread roots and replies together
// — the frontend groups replies under their root client-side (see
// useBoardComments.ts), since a single flat list is cheap to fetch once and
// avoids an N+1 "list threads then fetch each thread's replies" pattern for
// boards with hundreds of comments (see PERFORMANCE requirement).
// includeResolved defaults to false — the "resolved comments hidden by
// default" UX requirement is enforced here, not just client-side, so a
// board with a long resolved history doesn't inflate every load.
export async function listComments(boardId: string, opts: { includeResolved: boolean }): Promise<BoardComment[]> {
  const resolvedClause = opts.includeResolved
    ? ''
    : 'AND (resolved_at IS NULL OR parent_comment_id IS NOT NULL)';
  // Replies are always included regardless of the parent thread's resolved
  // state — a resolved thread still needs its replies for context if the
  // caller separately chose to show it (client-side toggle re-fetches with
  // includeResolved:true rather than trying to reconcile partial data).
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM board_comments
     WHERE board_id = $1 AND deleted_at IS NULL ${resolvedClause}
     ORDER BY created_at ASC`,
    [boardId]
  );
  return result.rows.map(row => rowToComment(row as Record<string, unknown>));
}

export async function getComment(boardId: string, commentId: string): Promise<BoardComment | null> {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM board_comments WHERE id = $1 AND board_id = $2`,
    [commentId, boardId]
  );
  return result.rows.length > 0 ? rowToComment(result.rows[0] as Record<string, unknown>) : null;
}

export async function updateCommentContent(boardId: string, commentId: string, content: string): Promise<BoardComment | null> {
  const now = new Date().toISOString();
  const result = await pool.query(
    `UPDATE board_comments
     SET content = $1, updated_at = $2
     WHERE id = $3 AND board_id = $4 AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [content, now, commentId, boardId]
  );
  return result.rows.length > 0 ? rowToComment(result.rows[0] as Record<string, unknown>) : null;
}

// Soft delete only — a deleted comment's row stays (deleted_at set), never
// physically removed. This preserves reply threads: a deleted root comment
// with live replies still needs to exist as a row for those replies'
// parent_comment_id to resolve against, even though listComments filters
// it out of the default view. See SAFETY requirements' general spirit
// (never destructively lose collaboration history) applied to comments.
export async function softDeleteComment(boardId: string, commentId: string): Promise<BoardComment | null> {
  const now = new Date().toISOString();
  const result = await pool.query(
    `UPDATE board_comments
     SET deleted_at = $1, updated_at = $1
     WHERE id = $2 AND board_id = $3 AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [now, commentId, boardId]
  );
  return result.rows.length > 0 ? rowToComment(result.rows[0] as Record<string, unknown>) : null;
}

// Resolve/reopen only ever apply to a thread ROOT (parent_comment_id IS
// NULL) — the caller (routes/comments.ts) is expected to have already
// loaded the comment and checked this, but the WHERE clause enforces it
// again here defensively, so a reply id can never end up with its own
// independent resolved state even from a route-layer bug.
export async function resolveComment(boardId: string, commentId: string, resolvedByRoll: string): Promise<BoardComment | null> {
  const now = new Date().toISOString();
  const result = await pool.query(
    `UPDATE board_comments
     SET resolved_at = $1, resolved_by_roll = $2, updated_at = $1
     WHERE id = $3 AND board_id = $4 AND deleted_at IS NULL AND parent_comment_id IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [now, resolvedByRoll, commentId, boardId]
  );
  return result.rows.length > 0 ? rowToComment(result.rows[0] as Record<string, unknown>) : null;
}

export async function reopenComment(boardId: string, commentId: string): Promise<BoardComment | null> {
  const now = new Date().toISOString();
  const result = await pool.query(
    `UPDATE board_comments
     SET resolved_at = NULL, resolved_by_roll = NULL, updated_at = $1
     WHERE id = $2 AND board_id = $3 AND deleted_at IS NULL AND parent_comment_id IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [now, commentId, boardId]
  );
  return result.rows.length > 0 ? rowToComment(result.rows[0] as Record<string, unknown>) : null;
}

export async function countComments(boardId: string): Promise<number> {
  const result = await pool.query(
    'SELECT COUNT(*)::int as count FROM board_comments WHERE board_id = $1 AND deleted_at IS NULL',
    [boardId]
  );
  return (result.rows[0] as { count: number }).count;
}

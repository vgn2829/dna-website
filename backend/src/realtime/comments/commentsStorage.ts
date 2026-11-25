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
  // Which tldraw page this anchor lives on (V2.6 Phase B). NULL for
  // comments created before pages were tracked — see schema.ts's own
  // comment on why those are deliberately not backfilled, and
  // CommentsOverlay for the "legacy comments show on every page"
  // compatibility rule that NULL implies.
  anchorPageId: string | null;
  content: string;
  // Normalized roll numbers of users mentioned in this comment (V2.6
  // Phase D). Always server-validated — see routes/comments.ts.
  mentions: string[];
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
  anchorPageId?: string | null;
  content: string;
}

// Hoisted so rowToComment (declared above parseMentions) can use it.
function parseMentionsInline(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
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
    anchorPageId: (row.anchor_page_id as string | null) ?? null,
    mentions: parseMentionsInline((row.mentions as string | null) ?? null),
    content: row.content as string,
  };
}

const SELECT_COLUMNS = `
  id, board_id, parent_comment_id, author_roll, author_name,
  created_at, updated_at, resolved_at, resolved_by_roll, deleted_at,
  anchor_type, anchor_shape_id, anchor_x, anchor_y, anchor_page_id, content, mentions
`;

export async function createComment(input: CreateCommentInput): Promise<BoardComment> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const result = await pool.query(
    `INSERT INTO board_comments
       (id, board_id, parent_comment_id, author_roll, author_name,
        created_at, updated_at, anchor_type, anchor_shape_id, anchor_x, anchor_y, anchor_page_id, content)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${SELECT_COLUMNS}`,
    [
      id, input.boardId, input.parentCommentId ?? null, input.authorRoll, input.authorName,
      now, input.anchorType, input.anchorShapeId ?? null, input.anchorX, input.anchorY,
      input.anchorPageId ?? null, input.content,
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

// ─────────────────────────────────────────────────────────────────────────
// READ STATE (V2.6 Phase E) — a per-(board, user) watermark, not a row per
// comment. See schema.ts's board_comment_reads comment for why. Same
// division of responsibility as the rest of this module: no authorization
// here, callers (routes/comments.ts) enforce board access first.
// ─────────────────────────────────────────────────────────────────────────

// Returns null when the user has never opened this board's comments —
// which the caller renders as "everything is unread", the correct
// first-visit behaviour.
export async function getLastSeenAt(boardId: string, roll: string): Promise<string | null> {
  const result = await pool.query(
    'SELECT last_seen_at FROM board_comment_reads WHERE board_id = $1 AND roll_number = $2',
    [boardId, roll]
  );
  return (result.rows[0] as { last_seen_at: string } | undefined)?.last_seen_at ?? null;
}

// Upsert. Deliberately monotonic — GREATEST() means a late-arriving or
// out-of-order request can never move a user's watermark BACKWARDS and
// resurrect threads they have already read.
export async function markSeen(boardId: string, roll: string, seenAt: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO board_comment_reads (board_id, roll_number, last_seen_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (board_id, roll_number)
     DO UPDATE SET last_seen_at = GREATEST(board_comment_reads.last_seen_at, EXCLUDED.last_seen_at)
     RETURNING last_seen_at`,
    [boardId, roll, seenAt]
  );
  return (result.rows[0] as { last_seen_at: string }).last_seen_at;
}

// ─────────────────────────────────────────────────────────────────────────
// MENTIONS (V2.6 Phase D) — stored as a JSON array of roll numbers in the
// long-reserved `mentions` TEXT column (see schema.ts, which set it aside
// for exactly this and left it unused until now). No new column, no new
// table.
// ─────────────────────────────────────────────────────────────────────────

export function parseMentions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function getCommentMentions(boardId: string, commentId: string): Promise<string[]> {
  const result = await pool.query(
    'SELECT mentions FROM board_comments WHERE id = $1 AND board_id = $2',
    [commentId, boardId]
  );
  return parseMentions((result.rows[0] as { mentions: string | null } | undefined)?.mentions ?? null);
}

export async function setCommentMentions(boardId: string, commentId: string, rolls: string[]): Promise<void> {
  await pool.query(
    'UPDATE board_comments SET mentions = $1 WHERE id = $2 AND board_id = $3',
    [JSON.stringify(rolls), commentId, boardId]
  );
}

import { Router, Request, Response } from 'express';
import { pool } from '../db/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../middleware/adminAuth';
import { requireStudent, optionalStudent } from '../middleware/studentAuth';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { getStorage } from '../storage';
import { scheduleDerivative } from '../storage/derivatives';
import { param } from '../routeParams';
import { ensurePersonalWorkspace } from './workspaces';
import { getBoardRole, roleCanWriteCanvas } from '../realtime/roomAccess';
import { notifyBoardShared } from '../services/notificationService';
import { canvasSummaryColumns } from '../lib/canvasSummary';
import { toPublicBoard, BOARD_ITEM_COUNT_SQL, BOARD_LIST_COLUMNS, MARK_PLACED_BOARD_ITEMS_SQL } from '../lib/boardRows';
import { withPreviewThumbnails } from '../lib/boardPreviewThumbnails';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// Version-history checkpoint hook (Commit 5) — deliberately an optional,
// injectable function rather than boards.ts importing VersionHistoryService
// directly. boards.ts is pure Postgres + Supabase Storage with no realtime
// dependency today, used standalone by every existing test
// (tests/otp-auth.test.ts, tests/rsvp-capacity.test.ts both call
// createApp() with zero realtime wiring) — making it import the history
// module directly would mean it always needs a live RoomManager behind it,
// even in contexts that have never needed one. Defaults to a no-op; only
// server.ts's real boot path calls setCheckpointHook, after constructing a
// real VersionHistoryService (see server.ts's own comment on why that
// construction has to happen before app.ts mounts any routers).
type CheckpointHook = (boardId: string, trigger: 'rename' | 'archive', actorRoll: string, actorName: string | null) => void;
let checkpointHook: CheckpointHook = () => {};
export function setCheckpointHook(hook: CheckpointHook): void {
  checkpointHook = hook;
}

const createBoardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many boards created — please slow down' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// isOwner stays a direct, standalone ownership check — deliberately NOT
// consolidated onto getBoardRole/RoomRole below. True board ownership can
// never be widened OR narrowed by workspace role (see roomAccess.ts's own
// classifyBoardAccess comment: an explicit board_members row or ownership
// always wins outright, workspace role is only ever a fallback ceiling on
// SHARED boards with no board-level grant) — every owner-gated route below
// (rename, delete, member management) must keep working identically
// regardless of workspace membership, so this check has nothing to gain
// from going through the shared classifier and every reason to stay simple
// and obviously correct.
async function isOwner(boardId: string, roll: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM boards WHERE id = $1 AND owner_roll = $2',
    [boardId, roll]
  );
  return result.rows.length > 0;
}

// CONSOLIDATION (workspace/organization layer, Commit 6/9) — canAccess,
// isMember, and canEdit used to each hand-roll their own SQL, duplicating
// (and silently diverging from) the exact same read/write access logic
// realtime/roomAccess.ts's classifyBoardAccess/getBoardRole already
// compute for the realtime WS path, comments, and version history. That
// duplication is exactly what roomAccess.ts's own header comment already
// flagged as the thing every OTHER permission consumer in this codebase
// was supposed to avoid — boards.ts was the one file that never migrated
// onto it. This consolidation is also the ONLY way these REST mutation
// routes become workspace-ceiling-aware: getBoardRole already folds in
// the workspace fallback (see roomAccess.ts), so replacing the hand-rolled
// SQL here with a getBoardRole call picks that up for free, with no new
// workspace-specific logic duplicated in this file.
//
// canAccess/isMember below are now the SAME check (any non-null role means
// read access) — they were already semantically identical before this
// consolidation (both queries were byte-for-byte the same UNION), kept as
// two names only because call sites already read naturally either way.
async function canAccess(boardId: string, roll: string): Promise<boolean> {
  return (await getBoardRole(boardId, roll)) !== null;
}

async function isMember(boardId: string, roll: string): Promise<boolean> {
  return (await getBoardRole(boardId, roll)) !== null;
}

// Write access honours edit_mode: owner and members can always edit; when a board
// is shared with edit_mode='anyone', any signed-in student may edit too.
// is_archived is enforced by roleCanWriteCanvas itself (its own doc comment
// explains why isArchived is a required, non-optional parameter there) —
// this function no longer needs its own separate archive check, since
// getBoardRole already returns isArchived alongside role for exactly this
// purpose.
async function canEdit(boardId: string, roll: string): Promise<boolean> {
  const result = await getBoardRole(boardId, roll);
  if (!result) return false;
  return roleCanWriteCanvas(result.role, result.isArchived);
}

// GET /api/boards
// Returns non-archived boards owned by or shared with this student.
// Optional ?workspace_id= narrows to a single workspace (workspace/
// organization layer, Commit 5/9) — absent by default, so this stays
// "every board I own or am a member of, across ALL workspaces" unless a
// caller opts in, exactly its pre-existing semantic. This route does NOT
// additionally surface workspace-ceiling-only access (a shared board
// reachable only via workspace membership, no owner/board_members row) —
// that's intentionally GET /shared's job (see below); "my boards" means
// "boards I explicitly own or was explicitly added to," unchanged.
router.get('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const workspaceId = typeof req.query.workspace_id === 'string' ? req.query.workspace_id : undefined;

    // V2.2 Projects layer — a lightweight LEFT JOIN for project_name
    // (display only, purely so board cards can show "in {project}"
    // without a second request per board — see MoodboardsPage.tsx's
    // BoardCard usage). Same join-for-display-data shape this query
    // already uses for item_count/member_count/is_favorite; p.name has
    // to join the GROUP BY (it's functionally dependent on b.project_id,
    // but Postgres still requires it listed) alongside the pre-existing
    // b.id, bf.roll_number.
    const result = await pool.query(`
      SELECT DISTINCT
        ${BOARD_LIST_COLUMNS},
        p.name as project_name,
        ${BOARD_ITEM_COUNT_SQL},
        COUNT(DISTINCT bm.roll_number)::int as member_count,
        (bf.roll_number IS NOT NULL) as is_favorite
      FROM boards b
      LEFT JOIN board_items bi ON bi.board_id = b.id
      LEFT JOIN board_members bm ON bm.board_id = b.id
      LEFT JOIN board_favorites bf ON bf.board_id = b.id AND bf.roll_number = $1
      LEFT JOIN projects p ON p.id = b.project_id
      WHERE NOT b.is_archived
        AND (
          b.owner_roll = $1
          OR b.id IN (
            SELECT board_id FROM board_members
            WHERE roll_number = $1
          )
        )
        AND ($2::text IS NULL OR b.workspace_id = $2)
      GROUP BY b.id, bf.roll_number, p.name
      ORDER BY b.created_at DESC
    `, [roll, workspaceId ?? null]);

    res.json(await withPreviewThumbnails(result.rows.map(toPublicBoard)));
  } catch (err) {
    console.error('Get boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/archived
// Returns this student's own archived boards. Optional ?workspace_id=
// narrows to a single workspace, same additive/unscoped-by-default
// treatment as GET / above.
router.get('/archived', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const workspaceId = typeof req.query.workspace_id === 'string' ? req.query.workspace_id : undefined;

    const result = await pool.query(`
      SELECT
        ${BOARD_LIST_COLUMNS},
        ${BOARD_ITEM_COUNT_SQL},
        COUNT(DISTINCT bm.roll_number)::int as member_count,
        (bf.roll_number IS NOT NULL) as is_favorite
      FROM boards b
      LEFT JOIN board_items bi ON bi.board_id = b.id
      LEFT JOIN board_members bm ON bm.board_id = b.id
      LEFT JOIN board_favorites bf ON bf.board_id = b.id AND bf.roll_number = $1
      WHERE b.is_archived AND b.owner_roll = $1
        AND ($2::text IS NULL OR b.workspace_id = $2)
      GROUP BY b.id, bf.roll_number
      ORDER BY b.updated_at DESC
    `, [roll, workspaceId ?? null]);

    res.json(await withPreviewThumbnails(result.rows.map(toPublicBoard)));
  } catch (err) {
    console.error('Get archived boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/shared
// Returns shared, non-archived boards for discovery — ALWAYS scoped to an
// authorized workspace context, never the whole app.
//
// Workspace scoping (workspace/organization layer, Commit 7/9; tightened
// V2.0 Phase 0): this route used to fall back to EVERY shared,
// non-archived board across the entire app whenever ?workspace_id= was
// omitted — a real cross-tenant leak (a private team's shared boards
// would surface in every OTHER workspace's "discover" feed) that a V2
// multi-workspace product cannot ship with. There is no longer an
// unscoped path:
//
//   - workspace_id explicitly provided: the caller must be a member of
//     that workspace (checked below) or this 403s — a workspace_id for a
//     workspace the caller can't prove membership of is never silently
//     ignored/dropped, it's a hard denial. This is what lets an anonymous
//     visitor with a direct link/workspace context still browse that ONE
//     workspace's shared boards (matching the pre-existing "guests can
//     browse a shared board" UX), while never leaking any OTHER
//     workspace's contents to them.
//   - workspace_id omitted, caller signed in: scoped to the UNION of
//     every workspace the caller is actually a member of — same
//     "unscoped means across all of MY workspaces, never anyone else's"
//     shape GET / already uses, not a global result.
//   - workspace_id omitted, caller anonymous: there is no authorized
//     workspace context to fall back to (an anonymous caller has no
//     memberships), so this returns an empty list rather than any
//     board's contents — confirmed product decision, not an inferred
//     default.
router.get('/shared', optionalStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll;
    const workspaceId = typeof req.query.workspace_id === 'string' ? req.query.workspace_id : undefined;

    if (workspaceId) {
      // Explicit workspace requested — membership required for a signed-in
      // caller. An anonymous caller has no membership to check, so a
      // direct workspace_id link stays browsable for guests (pre-existing
      // "shared board is publicly viewable" behavior), same as visiting
      // /moodboards/:id directly already allows.
      if (roll) {
        const membership = await pool.query(
          'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND roll_number = $2',
          [workspaceId, roll]
        );
        if (membership.rows.length === 0) {
          return res.status(403).json({ error: 'Not a member of that workspace' });
        }
      }

      const result = await pool.query(`
        SELECT
          ${BOARD_LIST_COLUMNS},
          ${BOARD_ITEM_COUNT_SQL},
          COUNT(DISTINCT bm.roll_number)::int as member_count,
          (bf.roll_number IS NOT NULL) as is_favorite
        FROM boards b
        LEFT JOIN board_items bi ON bi.board_id = b.id
        LEFT JOIN board_members bm ON bm.board_id = b.id
        LEFT JOIN board_favorites bf ON bf.board_id = b.id AND bf.roll_number = $1
        WHERE b.visibility = 'shared' AND NOT b.is_archived AND b.workspace_id = $2
        GROUP BY b.id, bf.roll_number
        ORDER BY b.created_at DESC
      `, [roll ?? null, workspaceId]);
      return res.json(await withPreviewThumbnails(result.rows.map(toPublicBoard)));
    }

    if (!roll) {
      // Anonymous + no workspace_id: no authorized context exists.
      // Never fall back to a global, cross-tenant result.
      return res.json([]);
    }

    // Signed in, no workspace_id: scope to every workspace this caller is
    // actually a member of — an authorized set, not the whole app.
    const result = await pool.query(`
      SELECT
        ${BOARD_LIST_COLUMNS},
        ${BOARD_ITEM_COUNT_SQL},
        COUNT(DISTINCT bm.roll_number)::int as member_count,
        (bf.roll_number IS NOT NULL) as is_favorite
      FROM boards b
      LEFT JOIN board_items bi ON bi.board_id = b.id
      LEFT JOIN board_members bm ON bm.board_id = b.id
      LEFT JOIN board_favorites bf ON bf.board_id = b.id AND bf.roll_number = $1
      WHERE b.visibility = 'shared' AND NOT b.is_archived
        AND b.workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE roll_number = $1
        )
      GROUP BY b.id, bf.roll_number
      ORDER BY b.created_at DESC
    `, [roll]);
    res.json(await withPreviewThumbnails(result.rows.map(toPublicBoard)));
  } catch (err) {
    console.error('Get shared boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/favorite
// Star a board (any signed-in student who can access it)
router.post('/:id/favorite', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const access = await canAccess(param(req.params.id), roll);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query(`
      INSERT INTO board_favorites (board_id, roll_number, created_at)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, [req.params.id, roll, new Date().toISOString()]);

    res.json({ success: true, is_favorite: true });
  } catch (err) {
    console.error('Favorite board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id/favorite
// Unstar a board
router.delete('/:id/favorite', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    await pool.query(
      'DELETE FROM board_favorites WHERE board_id = $1 AND roll_number = $2',
      [req.params.id, roll]
    );
    res.json({ success: true, is_favorite: false });
  } catch (err) {
    console.error('Unfavorite board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/duplicate
// Duplicate a board's metadata + canvas content (owner or member — mirrors
// canEdit's audience, since duplicating is a read of content you can already
// edit). The copy is always private with no members, owned by the requester,
// regardless of the source board's visibility/sharing — sharing is a
// deliberate choice the duplicator makes fresh, not inherited.
router.post('/:id/duplicate', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const access = await canEdit(param(req.params.id), roll);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const sourceResult = await pool.query(
      'SELECT name, description, canvas_data FROM boards WHERE id = $1',
      [req.params.id]
    );
    if (sourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }
    const source = sourceResult.rows[0] as { name: string; description: string | null; canvas_data: string | null };

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    // The copy always lands in the REQUESTER's own personal workspace, not
    // the source board's workspace — same "deliberate choice made fresh,
    // not inherited" philosophy already documented above for visibility/
    // sharing. A duplicator may only have workspace-ceiling access to the
    // source (no board_members row, no workspace-management rights there),
    // so silently placing the copy in that same workspace would be a
    // surprising side effect, not a neutral default.
    const workspaceId = await ensurePersonalWorkspace(roll, ownerName);

    const id = uuidv4();
    const roomId = uuidv4();
    const now = new Date().toISOString();
    const copyName = `${source.name} (copy)`.slice(0, 100);

    // The copy's card count/preview come from the copied snapshot itself
    // (lib/canvasSummary.ts); it has no board_items of its own.
    const summary = canvasSummaryColumns(source.canvas_data);
    const result = await pool.query(`
      INSERT INTO boards
        (id, name, description, owner_roll, owner_name,
         visibility, room_id, created_at, updated_at, canvas_data, workspace_id,
         canvas_item_count, canvas_preview, canvas_placed_item_ids)
      VALUES ($1, $2, $3, $4, $5, 'private', $6, $7, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      id, copyName, source.description,
      roll, ownerName, roomId, now, source.canvas_data, workspaceId,
      summary.canvas_item_count, summary.canvas_preview, summary.canvas_placed_item_ids,
    ]);

    res.status(201).json({ ...toPublicBoard(result.rows[0]), item_count: summary.canvas_item_count, member_count: 0, is_favorite: false });
  } catch (err) {
    console.error('Duplicate board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/admin/all
// Returns all boards from all users (admin only), including archived
router.get('/admin/all', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        b.*,
        ${BOARD_ITEM_COUNT_SQL},
        COUNT(DISTINCT bm.roll_number)::int as member_count
      FROM boards b
      LEFT JOIN board_items bi ON bi.board_id = b.id
      LEFT JOIN board_members bm ON bm.board_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);
    res.json(result.rows.map(toPublicBoard));
  } catch (err) {
    console.error('Admin get boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/admin/:id
// Admin can delete any board
router.delete('/admin/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM boards WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/admin/:id
// Admin can update visibility/edit_mode of any board
router.put('/admin/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      visibility: z.enum(['private', 'shared']).optional(),
      edit_mode: z.enum(['members_only', 'anyone']).optional(),
    });
    const parsed = schema.parse(req.body);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (parsed.visibility !== undefined) {
      fields.push(`visibility = $${i++}`);
      values.push(parsed.visibility);
    }
    if (parsed.edit_mode !== undefined) {
      fields.push(`edit_mode = $${i++}`);
      values.push(parsed.edit_mode);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(`
      UPDATE boards SET ${fields.join(', ')}
      WHERE id = $${i} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json(toPublicBoard(result.rows[0]));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:id/canvas
// Save Excalidraw canvas state (owner + members)
router.put('/:id/canvas', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const access = await canEdit(param(req.params.id), roll);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { canvas_data } = req.body as { canvas_data?: string };
    if (!canvas_data) {
      return res.status(400).json({ error: 'canvas_data is required' });
    }

    let parsedCanvas: unknown;
    try {
      parsedCanvas = JSON.parse(canvas_data);
    } catch {
      return res.status(400).json({ error: 'canvas_data must be valid JSON' });
    }

    // Card item count/preview kept in sync with every canvas write
    // (lib/canvasSummary.ts), and Gallery items on the saved canvas marked
    // placed in the same statement (lib/boardRows.ts).
    const summary = canvasSummaryColumns(parsedCanvas as object);
    await pool.query(`
      WITH saved AS (
        UPDATE boards
        SET canvas_data = $1, updated_at = $2,
            canvas_item_count = $4, canvas_preview = $5, canvas_placed_item_ids = $6
        WHERE id = $3
        RETURNING id, canvas_placed_item_ids
      )
      ${MARK_PLACED_BOARD_ITEMS_SQL}
    `, [canvas_data, new Date().toISOString(), req.params.id,
        summary.canvas_item_count, summary.canvas_preview, summary.canvas_placed_item_ids]);

    res.json({ success: true });
  } catch (err) {
    console.error('Save canvas error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/:id/canvas
// Load Excalidraw canvas state
router.get('/:id/canvas', optionalStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll;

    const boardResult = await pool.query(
      'SELECT visibility, canvas_data FROM boards WHERE id = $1',
      [req.params.id]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = boardResult.rows[0] as { visibility: string; canvas_data: string | null };

    if (board.visibility === 'private') {
      if (!roll) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const access = await isMember(param(req.params.id), roll);
      if (!access) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({ canvas_data: board.canvas_data ?? null });
  } catch (err) {
    console.error('Load canvas error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/:id
// Returns board with items and members
router.get('/:id', optionalStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll;

    const boardResult = await pool.query(
      'SELECT * FROM boards WHERE id = $1',
      [req.params.id]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = boardResult.rows[0];

    // Private boards: owner + members only; shared boards: everyone (even guests)
    if (board.visibility === 'private') {
      if (!roll) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const access = await isMember(board.id, roll);
      if (!access) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Only never-placed Gallery items — `items` is what the canvas
    // injects as pending (injectPendingBoardItems); a placed item is
    // already on the canvas or was deleted from it by the user.
    const itemsResult = await pool.query(`
      SELECT * FROM board_items
      WHERE board_id = $1 AND placed_at IS NULL
      ORDER BY created_at DESC
    `, [req.params.id]);

    const membersResult = await pool.query(`
      SELECT roll_number, name, added_at
      FROM board_members
      WHERE board_id = $1
      ORDER BY added_at ASC
    `, [req.params.id]);

    const isFavorite = roll
      ? (await pool.query(
          'SELECT 1 FROM board_favorites WHERE board_id = $1 AND roll_number = $2',
          [req.params.id, roll]
        )).rows.length > 0
      : false;

    res.json({
      ...toPublicBoard(board),
      is_favorite: isFavorite,
      items: itemsResult.rows,
      members: membersResult.rows,
    });
  } catch (err) {
    console.error('Get board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards
// Create a new board
router.post('/', createBoardLimiter, requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const schema = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(300).optional(),
      visibility: z.enum(['private', 'shared']).default('private'),
      // Optional (workspace/organization layer, Commit 4/9): if omitted,
      // falls back to the caller's auto-provisioned personal workspace
      // below, so every existing caller of this route (including every
      // pre-workspace-layer test) keeps working unchanged. If provided,
      // the caller must already be a member of that workspace (any
      // role) — otherwise a board could be silently created inside a
      // workspace its creator has no business putting content into.
      workspace_id: z.string().optional(),
      // Optional (V2.2 Projects layer): if omitted, the board is created
      // ungrouped (project_id NULL) — the exact pre-V2.2 behavior, so
      // every existing caller keeps working unchanged. If provided, must
      // belong to the SAME workspace the board is about to be created in
      // (resolved above/below as workspaceId) — verified after
      // workspaceId is known, never trusted from the client in isolation,
      // so a project_id can't smuggle a board into a project that
      // belongs to a workspace the caller only guessed the id of.
      project_id: z.string().optional(),
    });

    const parsed = schema.parse(req.body);

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    let workspaceId: string;
    if (parsed.workspace_id) {
      const membership = await pool.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND roll_number = $2',
        [parsed.workspace_id, roll]
      );
      if (membership.rows.length === 0) {
        return res.status(403).json({ error: 'Not a member of that workspace' });
      }
      workspaceId = parsed.workspace_id;
    } else {
      workspaceId = await ensurePersonalWorkspace(roll, ownerName);
    }

    let projectId: string | null = null;
    if (parsed.project_id) {
      const project = await pool.query(
        'SELECT workspace_id FROM projects WHERE id = $1', [parsed.project_id]
      );
      const projectRow = project.rows[0] as { workspace_id: string } | undefined;
      if (!projectRow) {
        return res.status(404).json({ error: 'Project not found' });
      }
      // The project must belong to the board's own (already-authorized)
      // workspace — membership in the WORKSPACE was already verified
      // above; this additionally confirms the project itself lives in
      // that same workspace, never a different one the caller happens to
      // also have access to. This is the "never allow cross-workspace
      // attachment" guarantee, enforced at insert time.
      if (projectRow.workspace_id !== workspaceId) {
        return res.status(400).json({ error: 'Project does not belong to that workspace' });
      }
      projectId = parsed.project_id;
    }

    const id = uuidv4();
    const roomId = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO boards
        (id, name, description, owner_roll,
         owner_name, visibility, room_id, created_at, updated_at, workspace_id, project_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)
      RETURNING *
    `, [
      id, parsed.name, parsed.description ?? null,
      roll, ownerName, parsed.visibility, roomId, now, workspaceId, projectId,
    ]);

    res.status(201).json({ ...toPublicBoard(result.rows[0]), item_count: 0, member_count: 0, is_favorite: false });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Create board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:id
// Update board name/description/visibility/project (owner only)
router.put('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const boardId = param(req.params.id);

    const owner = await isOwner(boardId, roll);
    if (!owner) {
      return res.status(403).json({ error: 'Only owner can update board' });
    }

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(300).optional(),
      visibility: z.enum(['private', 'shared']).optional(),
      edit_mode: z.enum(['members_only', 'anyone']).optional(),
      is_archived: z.boolean().optional(),
      // V2.2 Projects layer — move this board into a project, or pass
      // null to un-group it back to workspace-level. Omitted entirely =
      // leave project_id untouched (the usual "field not in the request
      // body isn't touched" convention every other field here already
      // follows); explicit null IS a meaningful value (distinct from
      // "not provided"), so this is nullable().optional(), not just
      // optional() — the fields-array pattern below checks `!== undefined`
      // specifically so an explicit null still gets included.
      project_id: z.string().nullable().optional(),
    });

    const parsed = schema.parse(req.body);

    // Resolved once, only if project_id was actually supplied — this
    // board's own (immutable-via-this-route) workspace_id is what a
    // target project must belong to. NEVER allow cross-workspace
    // attachment: a project from a different workspace than this board's
    // own is rejected outright, even if the caller happens to also have
    // access to that other project.
    if (parsed.project_id !== undefined && parsed.project_id !== null) {
      const boardWorkspace = await pool.query('SELECT workspace_id FROM boards WHERE id = $1', [boardId]);
      const boardWorkspaceId = (boardWorkspace.rows[0] as { workspace_id: string } | undefined)?.workspace_id;
      const project = await pool.query('SELECT workspace_id FROM projects WHERE id = $1', [parsed.project_id]);
      const projectRow = project.rows[0] as { workspace_id: string } | undefined;
      if (!projectRow) {
        return res.status(404).json({ error: 'Project not found' });
      }
      if (projectRow.workspace_id !== boardWorkspaceId) {
        return res.status(400).json({ error: 'Project does not belong to this board\'s workspace' });
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (parsed.name !== undefined) { fields.push(`name = $${i++}`); values.push(parsed.name); }
    if (parsed.description !== undefined) { fields.push(`description = $${i++}`); values.push(parsed.description); }
    if (parsed.visibility !== undefined) { fields.push(`visibility = $${i++}`); values.push(parsed.visibility); }
    if (parsed.edit_mode !== undefined) { fields.push(`edit_mode = $${i++}`); values.push(parsed.edit_mode); }
    if (parsed.is_archived !== undefined) { fields.push(`is_archived = $${i++}`); values.push(parsed.is_archived); }
    if (parsed.project_id !== undefined) { fields.push(`project_id = $${i++}`); values.push(parsed.project_id); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    fields.push(`updated_at = $${i++}`);
    values.push(new Date().toISOString());

    values.push(req.params.id);
    await pool.query(`
      UPDATE boards SET ${fields.join(', ')}
      WHERE id = $${i}
    `, values);

    // Re-select with the same join shape as the list endpoints (item_count,
    // member_count, is_favorite) — a bare RETURNING * from the UPDATE above
    // omits those, and callers on the dashboard replace their whole cached
    // board object with this response, which would otherwise silently wipe
    // is_favorite/counts client-side after any rename/archive/visibility change.
    const result = await pool.query(`
      SELECT
        b.*,
        ${BOARD_ITEM_COUNT_SQL},
        COUNT(DISTINCT bm.roll_number)::int as member_count,
        (bf.roll_number IS NOT NULL) as is_favorite
      FROM boards b
      LEFT JOIN board_items bi ON bi.board_id = b.id
      LEFT JOIN board_members bm ON bm.board_id = b.id
      LEFT JOIN board_favorites bf ON bf.board_id = b.id AND bf.roll_number = $1
      WHERE b.id = $2
      GROUP BY b.id, bf.roll_number
    `, [roll, req.params.id]);

    const updated = result.rows[0] as { owner_name: string | null };

    // Fire-and-forget: a checkpoint failing must never fail the rename/
    // archive request itself (the actual metadata update above already
    // succeeded) — checkpointHook is synchronous-looking but its real
    // implementation (server.ts) is async internally and handles its own
    // errors; this call site doesn't await it on purpose, matching the
    // "restore/checkpoint problems are recoverable, never fatal to the
    // request" philosophy already used throughout realtime/rooms.ts.
    // Only fires for an actual rename (name provided) or a fresh archive
    // (is_archived === true specifically — restoring FROM archive doesn't
    // change board content, so it isn't a checkpoint-worthy moment).
    if (parsed.name !== undefined) {
      checkpointHook(param(req.params.id), 'rename', roll, updated.owner_name);
    } else if (parsed.is_archived === true) {
      checkpointHook(param(req.params.id), 'archive', roll, updated.owner_name);
    }

    res.json(toPublicBoard(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id
// Delete board (owner only)
router.delete('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const owner = await isOwner(param(req.params.id), roll);
    if (!owner) {
      return res.status(403).json({ error: 'Only owner can delete board' });
    }

    await pool.query('DELETE FROM boards WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/members
// Add collaborator by roll number (owner only)
router.post('/:id/members', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const boardId = param(req.params.id);

    const owner = await isOwner(boardId, roll);
    if (!owner) {
      return res.status(403).json({ error: 'Only owner can add members' });
    }

    const { roll_number } = req.body as { roll_number?: string };
    if (!roll_number) {
      return res.status(400).json({ error: 'Roll number required' });
    }

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll_number]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Student not found — they must register first',
      });
    }

    const memberName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;
    const now = new Date().toISOString();

    // RETURNING is empty when ON CONFLICT DO NOTHING actually skipped the
    // insert (already a member) — only notify on a genuine new addition,
    // never on a redundant re-add.
    const inserted = await pool.query(`
      INSERT INTO board_members (board_id, roll_number, name, added_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
      RETURNING board_id
    `, [boardId, roll_number, memberName, now]);

    if (inserted.rows.length > 0) {
      const boardResult = await pool.query('SELECT name FROM boards WHERE id = $1', [boardId]);
      const boardName = (boardResult.rows[0] as { name: string } | undefined)?.name ?? 'a board';
      const actorResult = await pool.query('SELECT name FROM student_sessions WHERE roll_number = $1', [roll]);
      const actorName = (actorResult.rows[0] as { name: string } | undefined)?.name ?? null;
      await notifyBoardShared({
        recipientRoll: roll_number,
        actorRoll: roll,
        actorName,
        boardId,
        boardName,
      });
    }

    res.json({ success: true, name: memberName });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id/members/:roll
// Remove collaborator (owner only)
router.delete('/:id/members/:roll', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const owner = await isOwner(param(req.params.id), roll);
    if (!owner) {
      return res.status(403).json({ error: 'Only owner can remove members' });
    }

    await pool.query(
      'DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2',
      [req.params.id, req.params.roll]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/items
// Add item to board (owner + members)
router.post('/:id/items', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const access = await canEdit(param(req.params.id), roll);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only allow http(s) (and inline data:image/ for pasted images) so stored
    // URLs can't become javascript:/other-scheme sinks when rendered.
    const safeUrl = (allowDataImage: boolean) => z.string().min(1).max(2_000_000).refine(u => {
      if (allowDataImage && /^data:image\//i.test(u)) return true;
      try {
        const proto = new URL(u).protocol;
        return proto === 'https:' || proto === 'http:';
      } catch { return false; }
    }, 'URL must be http(s) or a data:image');

    const schema = z.object({
      image_url: safeUrl(true),
      note: z.string().max(500).optional(),
      source_url: safeUrl(false).optional(),
    });

    const parsed = schema.parse(req.body);

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const addedByName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO board_items
        (id, board_id, image_url, note,
         source_url, added_by_roll, added_by_name, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      id, req.params.id,
      parsed.image_url,
      parsed.note ?? null,
      parsed.source_url ?? null,
      roll,
      addedByName,
      now,
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Add item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id/items/:itemId
// Delete item (item owner or board owner)
router.delete('/:id/items/:itemId', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const itemResult = await pool.query(
      'SELECT * FROM board_items WHERE id = $1 AND board_id = $2',
      [req.params.itemId, req.params.id]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemResult.rows[0] as { added_by_roll: string };
    const owner = await isOwner(param(req.params.id), roll);

    if (item.added_by_roll !== roll && !owner) {
      return res.status(403).json({ error: 'Cannot delete this item' });
    }

    await pool.query('DELETE FROM board_items WHERE id = $1', [req.params.itemId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/:id/items
// Get only pending (never-placed) items, same filter as GET /:id's
// `items`. No in-app caller today (api.boards.getItems is unused); kept
// for API compatibility.
router.get('/:id/items', optionalStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll;

    const boardResult = await pool.query(
      'SELECT * FROM boards WHERE id = $1',
      [req.params.id]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = boardResult.rows[0] as { visibility: string; id: string };

    if (board.visibility === 'private') {
      if (!roll) return res.status(403).json({ error: 'Access denied' });
      const access = await isMember(board.id, roll);
      if (!access) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(`
      SELECT * FROM board_items
      WHERE board_id = $1 AND placed_at IS NULL
      ORDER BY created_at DESC
    `, [req.params.id]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/canvas-files
// Upload a canvas image file to storage; returns the public URL
// Extensions are derived from a validated content-type allowlist, never from the
// raw client MIME string, so they can't be used to smuggle path characters.
const CANVAS_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

router.post('/:id/canvas-files', requireStudent, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    if (!UUID_RE.test(param(req.params.id))) {
      return res.status(400).json({ error: 'Invalid board id' });
    }

    const access = await canEdit(param(req.params.id), roll);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const ext = CANVAS_MIME_EXT[req.file.mimetype];
    if (!ext) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const rawFileId = (req.body.fileId as string | undefined) ?? `canvas_${Date.now()}`;
    if (!FILE_ID_RE.test(rawFileId)) {
      return res.status(400).json({ error: 'Invalid fileId' });
    }
    const fileId = rawFileId;

    const storagePath = `canvas-files/${req.params.id}/${fileId}.${ext}`;

    await getStorage().upload(storagePath, req.file.buffer, req.file.mimetype);
    const url = getStorage().getPublicUrl(storagePath);

    // Original stored — best-effort thumbnail derivative, off the response
    // path; the canvas keeps using `url` (storage/derivatives.ts).
    scheduleDerivative(storagePath, req.file.buffer);

    res.json({ fileId, url });
  } catch (err) {
    console.error('Canvas file upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

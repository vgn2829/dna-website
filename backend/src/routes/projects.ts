import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';
import { param } from '../routeParams';
import { getWorkspaceMembership } from './assets';
import { toPublicBoard, BOARD_ITEM_COUNT_SQL } from '../lib/boardRows';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// PROJECTS (V2.2) — a pure organizational grouping between a workspace and
// its boards. Deliberately modeled on routes/assets.ts, the most
// structurally similar existing router: a workspace-scoped resource with
// no permission system of its own, reusing the SAME exported
// getWorkspaceMembership helper assets.ts already defines rather than
// hand-rolling a second copy (see that file's own comment on the
// convention: UPLOAD/LIST needs any membership role, DELETE needs
// owner/admin — projects follow the identical two-tier split below).
//
// NO project_members, NO project-level role column, NO second
// authorization hierarchy — every route here verifies workspace
// membership via workspace_members and nothing else. A project's
// workspace_id is the ONLY thing that determines who can read/write it;
// there is no scenario where a project is authorized "because its ID
// exists" without that workspace check.
// ─────────────────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  owner_roll: string;
  owner_name: string | null;
  created_at: string;
  is_archived: boolean;
}

// GET /api/projects?workspace_id=
// Required, unlike boards.ts's optional workspace_id filters — a project
// has no meaningful "across all my workspaces" view (unlike a board,
// which a user can own outright), and defaulting to global here would
// reintroduce exactly the cross-tenant leak V2.0 Phase 0 closed on
// GET /api/boards/shared. Membership required in the target workspace;
// no membership means no list, never a silently-empty-but-200 response
// for a workspace the caller has no business asking about — this
// deliberately 403s rather than returning [] so a client bug that omits
// workspace_id (or sends one from a workspace the caller left) surfaces
// immediately instead of silently showing nothing.
router.get('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const workspaceId = typeof req.query.workspace_id === 'string' ? req.query.workspace_id : '';
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    const membership = await getWorkspaceMembership(workspaceId, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of that workspace' });
    }

    const result = await pool.query(`
      SELECT
        p.*,
        COUNT(b.id)::int as board_count
      FROM projects p
      LEFT JOIN boards b ON b.project_id = p.id
      WHERE p.workspace_id = $1
      GROUP BY p.id
      ORDER BY p.is_archived ASC, p.created_at DESC
    `, [workspaceId]);

    res.json(result.rows);
  } catch (err) {
    console.error('List projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects
// Create — any workspace member (any role) may create a project, same
// permission tier boards.ts's POST / uses for creating a board inside an
// explicitly-provided workspace_id (any membership, not owner/admin-only)
// — a project is closer to "a board" than to "a workspace setting" in
// this sense.
router.post('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const schema = z.object({
      workspace_id: z.string().min(1),
      name: z.string().min(1).max(100),
      description: z.string().max(300).optional(),
    });
    const parsed = schema.parse(req.body);

    const membership = await getWorkspaceMembership(parsed.workspace_id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of that workspace' });
    }

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO projects (id, workspace_id, name, description, owner_roll, owner_name, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, parsed.workspace_id, parsed.name, parsed.description ?? null, roll, ownerName, now]);

    res.status(201).json({ ...result.rows[0], board_count: 0 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id
// Detail — any workspace member. Looks the project up FIRST to learn its
// real workspace_id, then checks membership against THAT workspace — a
// caller can never authorize a project by guessing/reusing membership in
// some OTHER workspace; the membership check is always against the
// project's own, actual workspace_id, never a client-supplied one.
router.get('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const result = await pool.query(`
      SELECT
        p.*,
        COUNT(b.id)::int as board_count
      FROM projects p
      LEFT JOIN boards b ON b.project_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);
    const project = result.rows[0] as (ProjectRow & { board_count: number }) | undefined;
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const membership = await getWorkspaceMembership(project.workspace_id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(project);
  } catch (err) {
    console.error('Get project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/boards
// The board list for a project's detail page. Delegates read authorization
// to the SAME per-board access rule every other board list in this app
// already uses (owner OR explicit board_members row OR shared visibility)
// rather than "any workspace member sees every board in the project" —
// a project is an organizational label, not a new grant path onto boards
// it contains (see boards.ts's own canAccess, mirrored inline here since
// this is a project-scoped list, not a single-board lookup canAccess is
// shaped for). Workspace membership on the PROJECT itself is still
// required first, same as GET /:id above — a non-member of the workspace
// can't enumerate the project's boards at all, regardless of any
// individual board's own sharing.
router.get('/:id/boards', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const projectResult = await pool.query('SELECT workspace_id FROM projects WHERE id = $1', [id]);
    const project = projectResult.rows[0] as { workspace_id: string } | undefined;
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const membership = await getWorkspaceMembership(project.workspace_id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

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
      WHERE b.project_id = $2
        AND NOT b.is_archived
        AND (
          b.owner_roll = $1
          OR b.visibility = 'shared'
          OR b.id IN (SELECT board_id FROM board_members WHERE roll_number = $1)
        )
      GROUP BY b.id, bf.roll_number
      ORDER BY b.updated_at DESC
    `, [roll, id]);

    res.json(result.rows.map(toPublicBoard));
  } catch (err) {
    console.error('List project boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/projects/:id
// Update name/description/is_archived — any workspace member (any role),
// same tier as create. Deliberately NOT owner-of-project-only: a project
// has no per-project role to distinguish "creator" from "any other
// member" beyond workspace_members' own owner/admin/member axis, and
// restricting rename/archive to the project's creator alone would be a
// new, project-specific permission rule this phase explicitly avoids
// introducing. workspace_id is never accepted here — a project cannot be
// moved between workspaces via this route (or any route in this file);
// doing so would need its own explicit, carefully-authorized operation
// this phase does not need.
router.patch('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const projectResult = await pool.query('SELECT workspace_id FROM projects WHERE id = $1', [id]);
    const project = projectResult.rows[0] as { workspace_id: string } | undefined;
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const membership = await getWorkspaceMembership(project.workspace_id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(300).nullable().optional(),
      is_archived: z.boolean().optional(),
    });
    const parsed = schema.parse(req.body);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (parsed.name !== undefined) { fields.push(`name = $${i++}`); values.push(parsed.name); }
    if (parsed.description !== undefined) { fields.push(`description = $${i++}`); values.push(parsed.description); }
    if (parsed.is_archived !== undefined) { fields.push(`is_archived = $${i++}`); values.push(parsed.is_archived); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(id);
    const result = await pool.query(`
      UPDATE projects SET ${fields.join(', ')} WHERE id = $${i}
      RETURNING *
    `, values);

    const boardCountResult = await pool.query(
      'SELECT COUNT(*)::int as count FROM boards WHERE project_id = $1', [id]
    );

    res.json({ ...result.rows[0], board_count: (boardCountResult.rows[0] as { count: number }).count });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Update project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id
// Owner/admin tier — same "workspace-management" permission tier
// assets.ts's own DELETE uses (uploader-or-workspace-owner/admin), here
// simplified to owner/admin only (a project has no "uploader" analog to
// grant an extra bypass through) since a project is closer in spirit to
// a workspace-management action (deleting an organizational container)
// than to deleting one's own uploaded file.
//
// EXPLICIT PROTECTION, NOT CASCADE (V2.2's core requirement): rejects
// with 409 while ANY board still references this project, archived or
// not — the caller must move or un-group those boards first (PATCH
// /api/boards/:id with project_id: null, or reassign to another
// project — see boards.ts's own PUT /:id extension, next commit). This
// is the PRIMARY mechanism; boards.project_id's ON DELETE SET NULL FK
// (schema.ts) is defense-in-depth only and should never actually fire
// in normal operation through this route.
router.delete('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const projectResult = await pool.query('SELECT workspace_id FROM projects WHERE id = $1', [id]);
    const project = projectResult.rows[0] as { workspace_id: string } | undefined;
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const membership = await getWorkspaceMembership(project.workspace_id, roll);
    if (membership !== 'owner' && membership !== 'admin') {
      return res.status(403).json({ error: 'Only a workspace admin or owner can delete a project' });
    }

    const boardsCheck = await pool.query(
      'SELECT 1 FROM boards WHERE project_id = $1 LIMIT 1', [id]
    );
    if (boardsCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'This project still has boards in it — move or remove them first',
      });
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { pool } from '../db/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireStudent } from '../middleware/studentAuth';
import { param } from '../routeParams';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// WORKSPACE ROUTES (workspace/organization layer, Commit 3/9) — CRUD and
// membership management for the workspaces/workspace_members tables added
// in Commit 1. This file deliberately does NOT touch boards at all: board
// creation/listing gaining workspace_id is a separate, later commit
// (POST /api/boards's workspace_id wiring) — every route here is
// independently testable against workspaces/workspace_members alone.
//
// Role model: owner/admin/member (see workspace_members' own schema.ts
// comment) is a WORKSPACE-MANAGEMENT permission axis — who can rename,
// delete, or manage membership — completely separate from the board-
// access ceiling realtime/roomAccess.ts's classifyBoardAccess computes
// from it. Every route below enforces workspace-management permissions
// only; it never touches board-level authorization.
//
// PERSONAL WORKSPACE IMMUTABILITY — every user's auto-provisioned
// personal workspace (is_personal = true) must never be renameable,
// deletable, or have its membership changed via these routes: it's not a
// product concept a user creates or manages, it's the implicit home for
// boards nobody has organized into a real workspace yet. This is an
// app-layer invariant (no DB trigger enforcing it — same pattern as
// single board ownership elsewhere in this codebase), checked explicitly
// at the top of every mutating route below.
// ─────────────────────────────────────────────────────────────────────────

interface WorkspaceRow {
  id: string;
  name: string;
  is_personal: boolean;
  owner_roll: string;
  created_at: string;
}

interface WorkspaceMemberRow {
  workspace_id: string;
  roll_number: string;
  role: 'owner' | 'admin' | 'member';
  name: string | null;
  added_at: string;
}

async function getMembership(workspaceId: string, roll: string): Promise<WorkspaceMemberRow | null> {
  const result = await pool.query(
    'SELECT * FROM workspace_members WHERE workspace_id = $1 AND roll_number = $2',
    [workspaceId, roll]
  );
  return (result.rows[0] as WorkspaceMemberRow | undefined) ?? null;
}

async function getWorkspace(workspaceId: string): Promise<WorkspaceRow | null> {
  const result = await pool.query('SELECT * FROM workspaces WHERE id = $1', [workspaceId]);
  return (result.rows[0] as WorkspaceRow | undefined) ?? null;
}

// Lazily creates-if-missing the caller's personal workspace — used both
// by GET / (so a brand-new student's first workspace-list call still
// returns their personal workspace even before any board of theirs
// exists) and by POST /api/boards's future workspace_id fallback (a
// later commit). Idempotent: if a personal workspace already exists for
// this roll (created here, or backfilled by Commit 1's migration for a
// pre-existing board owner), that row is reused rather than duplicated.
export async function ensurePersonalWorkspace(roll: string, name: string | null): Promise<string> {
  const existing = await pool.query(
    'SELECT id FROM workspaces WHERE owner_roll = $1 AND is_personal = true LIMIT 1',
    [roll]
  );
  if (existing.rows.length > 0) {
    return (existing.rows[0] as { id: string }).id;
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, $2, true, $3, $4)`,
    [id, `${name ?? roll}'s Workspace`, roll, now]
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'owner', $3, $4)`,
    [id, roll, name, now]
  );
  return id;
}

// GET /api/workspaces
// List every workspace the caller is a member of, with their role and a
// member count AND board count (sharing/dashboard UI). Always includes
// the caller's personal workspace (lazily provisioned here if it doesn't
// exist yet) so the frontend switcher/panel never has to special-case
// "no workspaces yet".
//
// board_count added for the Workspaces panel's dashboard cards — a pure
// aggregate over the existing boards.workspace_id column (no schema
// change), counted the same way item_count/member_count already are on
// boards.ts's own list routes (COUNT DISTINCT via a LEFT JOIN, so a
// workspace with zero boards still returns 0, not an omitted row).
router.get('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1', [roll]
    );
    const studentName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;
    await ensurePersonalWorkspace(roll, studentName);

    const result = await pool.query(`
      SELECT
        w.*,
        wm.role,
        COUNT(DISTINCT wm2.roll_number)::int as member_count,
        COUNT(DISTINCT b.id)::int as board_count
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.roll_number = $1
      LEFT JOIN workspace_members wm2 ON wm2.workspace_id = w.id
      LEFT JOIN boards b ON b.workspace_id = w.id
      GROUP BY w.id, wm.role
      ORDER BY w.is_personal DESC, w.created_at ASC
    `, [roll]);

    res.json(result.rows);
  } catch (err) {
    console.error('List workspaces error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workspaces
// Create a new workspace — any authenticated student may create one,
// becoming its 'owner'. Never creates a personal workspace via this
// route (is_personal is always false here — the personal workspace is
// exclusively provisioned by ensurePersonalWorkspace).
router.post('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const schema = z.object({
      name: z.string().min(1).max(100),
    });
    const parsed = schema.parse(req.body);

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1', [roll]
    );
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    const id = uuidv4();
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, $2, false, $3, $4)`,
      [id, parsed.name, roll, now]
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'owner', $3, $4)`,
      [id, roll, ownerName, now]
    );

    res.status(201).json({
      id, name: parsed.name, is_personal: false, owner_roll: roll, created_at: now,
      role: 'owner', member_count: 1,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Create workspace error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workspaces/:id
// Workspace detail + member list — member-only (any role).
router.get('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const membership = await getMembership(id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const workspace = await getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const membersResult = await pool.query(
      'SELECT roll_number, name, role, added_at FROM workspace_members WHERE workspace_id = $1 ORDER BY added_at ASC',
      [id]
    );

    res.json({ ...workspace, role: membership.role, members: membersResult.rows });
  } catch (err) {
    console.error('Get workspace error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/workspaces/:id
// Rename — admin/owner only. Personal workspaces cannot be renamed.
router.put('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const workspace = await getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (workspace.is_personal) {
      return res.status(400).json({ error: 'Personal workspaces cannot be modified' });
    }

    const membership = await getMembership(id, roll);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only a workspace admin or owner can rename it' });
    }

    const schema = z.object({ name: z.string().min(1).max(100) });
    const parsed = schema.parse(req.body);

    await pool.query('UPDATE workspaces SET name = $1 WHERE id = $2', [parsed.name, id]);

    res.json({ ...workspace, name: parsed.name, role: membership.role });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Update workspace error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/workspaces/:id
// Owner only. Blocked (409) while any board still references this
// workspace — boards.workspace_id has ON DELETE RESTRICT (see schema.ts),
// so this pre-check returns a clean, actionable error instead of ever
// surfacing that raw FK violation as an unhandled 500. Personal
// workspaces cannot be deleted via this route.
router.delete('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const workspace = await getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (workspace.is_personal) {
      return res.status(400).json({ error: 'Personal workspaces cannot be deleted' });
    }

    const membership = await getMembership(id, roll);
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the workspace owner can delete it' });
    }

    const boardsCheck = await pool.query(
      'SELECT 1 FROM boards WHERE workspace_id = $1 LIMIT 1', [id]
    );
    if (boardsCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'This workspace still has boards in it — move or delete them first',
      });
    }

    await pool.query('DELETE FROM workspaces WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete workspace error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workspaces/:id/leave
// Self-removal. The owner cannot leave their own workspace via this
// route — ownership transfer is out of scope for this phase, so an
// owner wanting to leave must first delete the workspace (after moving
// its boards elsewhere) rather than abandoning it ownerless.
router.post('/:id/leave', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const workspace = await getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (workspace.is_personal) {
      return res.status(400).json({ error: 'You cannot leave your personal workspace' });
    }

    const membership = await getMembership(id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }
    if (membership.role === 'owner') {
      return res.status(400).json({ error: 'The workspace owner cannot leave — delete the workspace instead' });
    }

    await pool.query(
      'DELETE FROM workspace_members WHERE workspace_id = $1 AND roll_number = $2', [id, roll]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Leave workspace error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/workspaces/:id/members
// Member-only (any role).
router.get('/:id/members', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const membership = await getMembership(id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    const result = await pool.query(
      'SELECT roll_number, name, role, added_at FROM workspace_members WHERE workspace_id = $1 ORDER BY added_at ASC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List workspace members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/workspaces/:id/members
// Add a member by roll number — admin/owner only. Mirrors boards.ts's
// POST /:id/members exactly (student_sessions name lookup, 404 if the
// roll has never registered). New members always join as 'member' — an
// admin/owner promotion is a separate, explicit role-change action (see
// PUT /:id/members/:roll/role below), never implicit at add-time.
router.post('/:id/members', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const workspace = await getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (workspace.is_personal) {
      return res.status(400).json({ error: 'Personal workspaces cannot be modified' });
    }

    const membership = await getMembership(id, roll);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only a workspace admin or owner can add members' });
    }

    const { roll_number } = req.body as { roll_number?: string };
    if (!roll_number) {
      return res.status(400).json({ error: 'Roll number required' });
    }

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1', [roll_number]
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found — they must register first' });
    }

    const memberName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at)
      VALUES ($1, $2, 'member', $3, $4)
      ON CONFLICT DO NOTHING
    `, [id, roll_number, memberName, now]);

    res.json({ success: true, name: memberName });
  } catch (err) {
    console.error('Add workspace member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/workspaces/:id/members/:roll
// Remove a member — admin/owner only. The owner cannot be removed via
// this route (only via deleting the whole workspace).
router.delete('/:id/members/:roll', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);
    const targetRoll = param(req.params.roll);

    const workspace = await getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (workspace.is_personal) {
      return res.status(400).json({ error: 'Personal workspaces cannot be modified' });
    }

    const membership = await getMembership(id, roll);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only a workspace admin or owner can remove members' });
    }

    const target = await getMembership(id, targetRoll);
    if (target?.role === 'owner') {
      return res.status(400).json({ error: 'The workspace owner cannot be removed' });
    }

    await pool.query(
      'DELETE FROM workspace_members WHERE workspace_id = $1 AND roll_number = $2', [id, targetRoll]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Remove workspace member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/workspaces/:id/members/:roll/role
// Change a member between 'admin' and 'member' — owner only. The owner
// role itself is not reassignable via this route: transferring ownership
// is a distinct, harder operation (would need to also handle "what
// happens to the previous owner's role") deliberately out of scope here.
router.put('/:id/members/:roll/role', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);
    const targetRoll = param(req.params.roll);

    const workspace = await getWorkspace(id);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (workspace.is_personal) {
      return res.status(400).json({ error: 'Personal workspaces cannot be modified' });
    }

    const membership = await getMembership(id, roll);
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the workspace owner can change member roles' });
    }

    const schema = z.object({ role: z.enum(['admin', 'member']) });
    const parsed = schema.parse(req.body);

    const target = await getMembership(id, targetRoll);
    if (!target) {
      return res.status(404).json({ error: 'That roll number is not a member of this workspace' });
    }
    if (target.role === 'owner') {
      return res.status(400).json({ error: 'The workspace owner\'s role cannot be changed here' });
    }

    await pool.query(
      'UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND roll_number = $3',
      [parsed.role, id, targetRoll]
    );
    res.json({ success: true, role: parsed.role });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Change workspace member role error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

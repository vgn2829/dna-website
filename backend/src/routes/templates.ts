import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';
import { requireAdmin } from '../middleware/adminAuth';
import { adminListQuery, adminListWhere, adminUpdateSchema } from '../lib/libraryAdmin';
import { param } from '../routeParams';
import { getWorkspaceMembership } from './assets';
import { canvasSummaryColumns } from '../lib/canvasSummary';
import { toPublicBoard } from '../lib/boardRows';
import { getBoardRole, roleCanWriteCanvas } from '../realtime/roomAccess';
import { LIBRARY_VISIBILITIES, canSeeLibraryItem, libraryScopeSql, parseLibraryScope, rollBinder, type LibraryStatus, type LibraryVisibility } from '../lib/libraryVisibility';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// TEMPLATES (V2.3) — a reusable, frozen canvas snapshot a user can
// instantiate into a new board. Modeled directly on routes/projects.ts
// (the most structurally similar existing router: a workspace-scoped
// resource with no permission system of its own, reusing the SAME
// exported getWorkspaceMembership helper assets.ts defines) for every
// authorization concern, and on POST /:id/duplicate in routes/boards.ts
// for the actual snapshot-copy mechanics — templates.canvas_data is
// copied from/into boards.canvas_data as an OPAQUE STRING, exactly like
// duplicate already does, never parsed or reshaped.
//
// NO template_members, NO template-level role column, NO second
// authorization hierarchy — every route here verifies workspace
// membership via workspace_members first.
//
// Shared Creative Library: inside that workspace, visibility decides who
// else sees a template (lib/libraryVisibility.ts). A personal template is
// the owner's alone; a community template is visible to and usable by
// every member. Only the owner manages it (edit, archive, publish,
// delete). Another member's personal template answers 404, as if it did
// not exist, so ids can't be probed.
// ─────────────────────────────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  workspace_id: string;
  source_board_id: string | null;
  name: string;
  description: string | null;
  canvas_data: string | null;
  thumbnail_url: string | null;
  owner_roll: string;
  owner_name: string | null;
  created_at: string;
  is_archived: boolean;
  visibility: LibraryVisibility;
  status: LibraryStatus;
}

// canvas_data is intentionally never included in the list/detail JSON —
// same "don't ship the whole payload for a list view" boundary
// boards.ts's list endpoints already draw (they never return canvas_data
// either; only GET /:id/canvas does). A template's snapshot can be as
// large as any board's; the Templates page only ever needs metadata to
// render cards, and POST /:id/use (below) reads canvas_data directly
// from the DB, never from a value the client already had.
function toPublicTemplate(row: TemplateRow) {
  const { canvas_data: _canvas_data, ...rest } = row;
  return rest;
}

// GET /api/templates?workspace_id=&scope=all|mine|community
// workspace_id required, same reasoning as routes/projects.ts's own GET / —
// a template has no meaningful "across all my workspaces" view, and
// defaulting to global would repeat the exact cross-tenant leak V2.0
// Phase 0 closed on GET /api/boards/shared. scope (default all) is applied
// in SQL — another member's personal template is never returned.
router.get('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const workspaceId = typeof req.query.workspace_id === 'string' ? req.query.workspace_id : '';
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }
    const scope = parseLibraryScope(req.query.scope);
    if (!scope) {
      return res.status(400).json({ error: 'Invalid scope' });
    }

    const membership = await getWorkspaceMembership(workspaceId, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of that workspace' });
    }

    const params: unknown[] = [workspaceId];
    const result = await pool.query(
      `SELECT * FROM templates WHERE workspace_id = $1 AND ${libraryScopeSql(scope, rollBinder(params, roll))}
       ORDER BY is_archived ASC, created_at DESC`,
      params
    );

    res.json((result.rows as TemplateRow[]).map(toPublicTemplate));
  } catch (err) {
    console.error('List templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/templates
// Create a template from an existing board's CURRENT PERSISTED snapshot.
// workspace_id is NEVER accepted from the client here — it is always
// derived from the source board's own row, exactly as the V2.3 brief
// requires ("the source board is authoritative"). This also means a
// template can never be created detached from any board (no
// "blank template" path) — matches the brief's scope (save/reuse an
// existing Moodboard), not a template-authoring feature.
router.post('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const schema = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(300).optional(),
      source_board_id: z.string().min(1),
      visibility: z.enum(LIBRARY_VISIBILITIES).optional(),
    });
    const parsed = schema.parse(req.body);

    // getBoardRole re-derives the board's real workspace_id/owner/
    // visibility from the DB row itself — never trusts anything the
    // client sent about the board beyond its id. roleCanWriteCanvas
    // (not just "can read") is the bar, matching POST /:id/duplicate's
    // own canEdit requirement — saving a template is the same class of
    // action as duplicating (producing a new persistent artifact from
    // this board's content), not a passive read.
    const boardRole = await getBoardRole(parsed.source_board_id, roll);
    if (!boardRole || !roleCanWriteCanvas(boardRole.role, boardRole.isArchived)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const sourceResult = await pool.query(
      'SELECT workspace_id, canvas_data FROM boards WHERE id = $1',
      [parsed.source_board_id]
    );
    const source = sourceResult.rows[0] as { workspace_id: string; canvas_data: string | null } | undefined;
    if (!source) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // A board with no persisted canvas yet (never saved/opened) has
    // canvas_data NULL — creating a template from it would produce a
    // template that instantiates into a permanently-blank board with no
    // way to tell "intentionally blank" apart from "something went
    // wrong." Reject with a clear, actionable error instead (per the
    // brief's explicit requirement), rather than silently creating a
    // corrupt/empty template.
    if (!source.canvas_data) {
      return res.status(400).json({ error: 'This board has no saved canvas content yet — open and edit it before saving as a template' });
    }

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO templates
        (id, workspace_id, source_board_id, name, description, canvas_data, owner_roll, owner_name, created_at, visibility)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      id, source.workspace_id, parsed.source_board_id, parsed.name,
      parsed.description ?? null, source.canvas_data, roll, ownerName, now,
      parsed.visibility ?? 'personal',
    ]);

    res.status(201).json(toPublicTemplate(result.rows[0] as TemplateRow));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Create template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Loads a template for an owner-only action. Non-members get 403 (the
// existing workspace convention); a member who can't see it (someone
// else's personal template) gets 404; a member who can see it but doesn't
// own it gets 403.
async function loadOwnedTemplate(id: string, roll: string): Promise<
  { ok: true; row: TemplateRow } | { ok: false; status: number; error: string }
> {
  const found = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
  const row = found.rows[0] as TemplateRow | undefined;
  if (!row) return { ok: false, status: 404, error: 'Template not found' };
  if (!(await getWorkspaceMembership(row.workspace_id, roll))) return { ok: false, status: 403, error: 'Access denied' };
  if (!canSeeLibraryItem(row, roll)) return { ok: false, status: 404, error: 'Template not found' };
  if (row.owner_roll !== roll) return { ok: false, status: 403, error: 'Only the template owner can change it' };
  return { ok: true, row };
}

// GET /api/templates/:id
router.get('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const result = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
    const template = result.rows[0] as TemplateRow | undefined;
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const membership = await getWorkspaceMembership(template.workspace_id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!canSeeLibraryItem(template, roll)) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(toPublicTemplate(template));
  } catch (err) {
    console.error('Get template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/templates/:id
// Rename/describe/archive/publish (visibility) — the template's owner only.
// Other members may use a community template, never change the original.
router.patch('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const loaded = await loadOwnedTemplate(id, roll);
    if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(300).nullable().optional(),
      is_archived: z.boolean().optional(),
      visibility: z.enum(LIBRARY_VISIBILITIES).optional(),
    });
    const parsed = schema.parse(req.body);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (parsed.name !== undefined) { fields.push(`name = $${i++}`); values.push(parsed.name); }
    if (parsed.description !== undefined) { fields.push(`description = $${i++}`); values.push(parsed.description); }
    if (parsed.is_archived !== undefined) { fields.push(`is_archived = $${i++}`); values.push(parsed.is_archived); }
    if (parsed.visibility !== undefined) { fields.push(`visibility = $${i++}`); values.push(parsed.visibility); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(id);
    const result = await pool.query(`
      UPDATE templates SET ${fields.join(', ')} WHERE id = $${i}
      RETURNING *
    `, values);

    res.json(toPublicTemplate(result.rows[0] as TemplateRow));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Update template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/templates/:id
// The template's owner only (Shared Creative Library). Deleting a template
// has no "attached content" to protect against (unlike a project, which
// can hold boards), so no pre-check/409 is needed here; a hard delete is
// safe by construction because every board ever created from this
// template already has its own independent copy of canvas_data (see
// POST /:id/use below) with no ongoing reference back to the template row.
router.delete('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const loaded = await loadOwnedTemplate(id, roll);
    if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });

    await pool.query('DELETE FROM templates WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/templates/:id/use
// Create a new board from a template's frozen snapshot. Mirrors
// POST /:id/duplicate's insertion shape almost exactly — the only real
// difference is the source is a template row instead of a board row,
// and project_id is optionally accepted (workspace-checked against the
// TEMPLATE's own workspace_id, never trusted bare from the client).
//
// The template itself is never mutated by this route — canvas_data is
// only ever read here, and the new board gets its OWN copy of that
// string in its own row; there is no shared/linked storage between a
// template and the boards created from it, so editing the new board
// can never affect the template or any other board made from it.
router.post('/:id/use', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      project_id: z.string().optional(),
    });
    const parsed = schema.parse(req.body);

    const templateResult = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
    const template = templateResult.rows[0] as TemplateRow | undefined;
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Destination workspace is ALWAYS the template's own workspace_id —
    // never client-supplied, never inferred from the caller's "active"
    // workspace. This is what makes "Workspace A template -> Workspace B
    // board" structurally impossible, not just checked: there is no
    // parameter through which a different workspace could even be named.
    const membership = await getWorkspaceMembership(template.workspace_id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // Any member may use a community template; a personal one only by its
    // owner. The new board belongs to the CALLER (below), never the
    // template's owner, and the template row is only read.
    if (!canSeeLibraryItem(template, roll)) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (!template.canvas_data) {
      return res.status(400).json({ error: 'This template has no canvas content' });
    }

    let projectId: string | null = null;
    if (parsed.project_id) {
      const project = await pool.query('SELECT workspace_id FROM projects WHERE id = $1', [parsed.project_id]);
      const projectRow = project.rows[0] as { workspace_id: string } | undefined;
      if (!projectRow) {
        return res.status(404).json({ error: 'Project not found' });
      }
      // Same "never allow cross-workspace attachment" guarantee
      // routes/boards.ts's own project_id handling already enforces —
      // the project must belong to the SAME workspace the template (and
      // therefore the new board) belongs to, never a different one.
      if (projectRow.workspace_id !== template.workspace_id) {
        return res.status(400).json({ error: 'Project does not belong to that workspace' });
      }
      projectId = parsed.project_id;
    }

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    const boardId = uuidv4();
    const roomId = uuidv4();
    const now = new Date().toISOString();
    const boardName = (parsed.name?.trim() || template.name).slice(0, 100);

    // Normal board ownership/access model, same INSERT shape POST /
    // and POST /:id/duplicate already use — the caller becomes owner,
    // visibility defaults private (an explicit, fresh choice, same
    // "not silently inherited" philosophy duplicate's own comment
    // documents for its own visibility default), realtime_enabled
    // takes the column's own default (true — see schema.ts's V1
    // production-fix migration), and canvas_data is the template's
    // snapshot string copied verbatim, establishing a fully independent
    // board with no ongoing link to the template.
    // Card count/preview from the copied snapshot (lib/canvasSummary.ts).
    const summary = canvasSummaryColumns(template.canvas_data);
    const result = await pool.query(`
      INSERT INTO boards
        (id, name, owner_roll, owner_name, visibility, room_id, created_at, updated_at, canvas_data, workspace_id, project_id,
         canvas_item_count, canvas_preview, canvas_placed_item_ids)
      VALUES ($1, $2, $3, $4, 'private', $5, $6, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      boardId, boardName, roll, ownerName, roomId, now,
      template.canvas_data, template.workspace_id, projectId,
      summary.canvas_item_count, summary.canvas_preview, summary.canvas_placed_item_ids,
    ]);

    res.status(201).json({ ...toPublicBoard(result.rows[0]), item_count: summary.canvas_item_count, member_count: 0, is_favorite: false });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Use template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});



function toAdminTemplate(row: TemplateRow & { workspace_name: string; workspace_is_personal: boolean }) {
  return toPublicTemplate(row);
}

// GET /api/templates/admin/all?q=&status=&visibility=&limit=
router.get('/admin/all', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = adminListQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid filters' });
    const params: unknown[] = [];
    const where = adminListWhere(parsed.data, 'name', params);
    params.push(parsed.data.limit ?? 200);
    const result = await pool.query(
      `SELECT a.*, w.name AS workspace_name, w.is_personal AS workspace_is_personal
       FROM templates a JOIN workspaces w ON w.id = a.workspace_id
       ${where}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ templates: (result.rows as Array<TemplateRow & { workspace_name: string; workspace_is_personal: boolean }>).map(toAdminTemplate) });
  } catch (err) {
    console.error('Admin list templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/templates/admin/:id { visibility?, status? } — never touches the
// snapshot, owner or workspace.
router.patch('/admin/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = adminUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid update' });
    const result = await pool.query(
      `UPDATE templates SET visibility = COALESCE($2, visibility), status = COALESCE($3, status)
       WHERE id = $1 RETURNING id`,
      [param(req.params.id), parsed.data.visibility ?? null, parsed.data.status ?? null]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    const row = await pool.query(
      `SELECT a.*, w.name AS workspace_name, w.is_personal AS workspace_is_personal
       FROM templates a JOIN workspaces w ON w.id = a.workspace_id WHERE a.id = $1`,
      [param(req.params.id)]
    );
    res.json(toAdminTemplate(row.rows[0]));
  } catch (err) {
    console.error('Admin update template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';
import { param } from '../routeParams';
import { getWorkspaceMembership } from './assets';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// ASSET COLLECTIONS ("asset packs") — flat, workspace-scoped groupings of
// library assets (see db/schema.ts's asset_collections comment). Assets
// join a collection via PATCH /api/assets/:id (or collection_id on
// create), not through this router.
//
// Permissions reuse the existing workspace roles only (the same
// getWorkspaceMembership helper assets/projects/templates use):
//   LIST/CREATE — any member of the workspace
//   RENAME/EDIT/DELETE — the collection's creator, or a workspace
//     owner/admin (same tier as deleting someone else's asset)
// Deleting a collection never deletes assets: FK ON DELETE SET NULL just
// ungroups them.
// ─────────────────────────────────────────────────────────────────────────

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests — please slow down' },
});

interface CollectionRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_by_roll: string;
  created_at: string;
  updated_at: string;
  asset_count?: number;
}

function toPublicCollection(row: CollectionRow) {
  return { ...row, asset_count: Number(row.asset_count ?? 0) };
}

// Postgres unique_violation on uq_asset_collections_workspace_name.
function isDuplicateName(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
}).refine(v => v.name !== undefined || v.description !== undefined, { message: 'Nothing to update' });

// GET /api/asset-collections?workspace_id=...
// Alphabetical, with a live asset_count per collection.
router.get('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const workspaceId = typeof req.query.workspace_id === 'string' ? req.query.workspace_id : '';
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }
    if (!(await getWorkspaceMembership(workspaceId, roll))) {
      return res.status(403).json({ error: 'Not a member of that workspace' });
    }

    const result = await pool.query(`
      SELECT c.*, COUNT(a.id)::int AS asset_count
      FROM asset_collections c
      LEFT JOIN assets a ON a.collection_id = c.id
      WHERE c.workspace_id = $1
      GROUP BY c.id
      ORDER BY lower(c.name) ASC
    `, [workspaceId]);

    res.json({ collections: (result.rows as CollectionRow[]).map(toPublicCollection) });
  } catch (err) {
    console.error('List asset collections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/asset-collections
router.post('/', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'A collection needs a name (max 80 characters)' });
    }
    const { workspace_id: workspaceId, name } = parsed.data;
    if (!(await getWorkspaceMembership(workspaceId, roll))) {
      return res.status(403).json({ error: 'Not a member of that workspace' });
    }

    const now = new Date().toISOString();
    try {
      const result = await pool.query(`
        INSERT INTO asset_collections (id, workspace_id, name, description, created_by_roll, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        RETURNING *
      `, [uuidv4(), workspaceId, name, parsed.data.description || null, roll, now]);
      res.status(201).json(toPublicCollection(result.rows[0] as CollectionRow));
    } catch (err) {
      if (isDuplicateName(err)) {
        return res.status(409).json({ error: 'A collection with that name already exists' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Create asset collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Loads a collection and checks the caller may manage it. Non-members get
// 404 rather than 403 for a collection in a workspace they can't see, so
// ids from other workspaces can't be probed for existence.
async function loadManageable(id: string, roll: string): Promise<
  { ok: true; row: CollectionRow } | { ok: false; status: number; error: string }
> {
  const found = await pool.query('SELECT * FROM asset_collections WHERE id = $1', [id]);
  const row = found.rows[0] as CollectionRow | undefined;
  if (!row) return { ok: false, status: 404, error: 'Collection not found' };
  const membership = await getWorkspaceMembership(row.workspace_id, roll);
  if (!membership) return { ok: false, status: 404, error: 'Collection not found' };
  const canManage = row.created_by_roll === roll || membership === 'owner' || membership === 'admin';
  if (!canManage) return { ok: false, status: 403, error: 'Only the creator or a workspace admin can change this collection' };
  return { ok: true, row };
}

// PATCH /api/asset-collections/:id
router.patch('/:id', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update' });
    }
    const loaded = await loadManageable(param(req.params.id), roll);
    if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });

    try {
      const result = await pool.query(`
        UPDATE asset_collections SET
          name = COALESCE($2, name),
          description = CASE WHEN $3::boolean THEN $4 ELSE description END,
          updated_at = $5
        WHERE id = $1
        RETURNING *
      `, [loaded.row.id, parsed.data.name ?? null, parsed.data.description !== undefined,
          parsed.data.description || null, new Date().toISOString()]);
      const count = await pool.query('SELECT COUNT(*)::int AS n FROM assets WHERE collection_id = $1', [loaded.row.id]);
      res.json(toPublicCollection({ ...(result.rows[0] as CollectionRow), asset_count: (count.rows[0] as { n: number }).n }));
    } catch (err) {
      if (isDuplicateName(err)) {
        return res.status(409).json({ error: 'A collection with that name already exists' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Update asset collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/asset-collections/:id — ungroups its assets, never deletes them.
router.delete('/:id', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const loaded = await loadManageable(param(req.params.id), roll);
    if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });

    const count = await pool.query('SELECT COUNT(*)::int AS n FROM assets WHERE collection_id = $1', [loaded.row.id]);
    await pool.query('DELETE FROM asset_collections WHERE id = $1', [loaded.row.id]);
    res.json({ success: true, ungroupedAssets: (count.rows[0] as { n: number }).n });
  } catch (err) {
    console.error('Delete asset collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

import { Router } from 'express';
import { pool } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';
import { requireAdmin } from '../middleware/adminAuth';
import { param } from '../routeParams';

// ─────────────────────────────────────────────────────────────────────────
// Asset sharing — explicit per-workspace grants (asset_workspace_grants,
// db/assetSharingSchema.ts). Mounted under /api/assets by routes/assets.ts.
//
// A grant makes ONE active community asset visible to, and usable by, the
// members of ONE target workspace (lib/libraryVisibility.ts assetScopeSql /
// canSeeAsset). It never copies the stored object, never changes the
// asset's owner, workspace_id or storage_key, and never creates a second
// asset row. Hiding or unpublishing the asset suspends its grants (the
// visibility checks require active + community); revoking deletes the
// grant. Neither touches storage: boards that already placed the asset keep
// its URL (storage/references.ts protects the object from deletion).
//
// Who may grant:
//   - the asset's owner, while still a member of its source workspace,
//     into any non-personal workspace they are currently a member of (any
//     role — membership is the row in workspace_members; a removed member
//     has none). Only an asset's owner shares it: another member of the
//     source workspace, or a recipient in a target workspace, can never
//     grant or re-share someone else's asset.
//   - a site admin (requireAdmin), into any non-personal workspace. Owner
//     management never confers site-admin moderation powers, and site-admin
//     moderation (routes/assets.ts /admin) stays separate from sharing.
// A target workspace's owner/admin may also REVOKE a grant into their
// workspace (see revoke) — never create one on someone else's behalf.
// A personal workspace is never a target: its only member is its owner.
// ─────────────────────────────────────────────────────────────────────────

export const assetSharingRouter = Router();

async function sharingInfo(id: string, roll: string) {
  const asset = await pool.query(
    `SELECT a.id FROM assets a
     JOIN workspace_members m ON m.workspace_id = a.workspace_id AND m.roll_number = $2
     WHERE a.id = $1 AND a.owner_roll = $2 AND a.status = 'active'`,
    [id, roll]
  );
  if (!asset.rowCount) return null;
  const grants = await pool.query(
    `SELECT g.workspace_id, w.name FROM asset_workspace_grants g
     JOIN workspaces w ON w.id = g.workspace_id
     WHERE g.asset_id = $1 ORDER BY w.name`,
    [id]
  );
  const targets = await pool.query(
    `SELECT w.id, w.name FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.roll_number = $2 AND NOT w.is_personal
       AND w.id <> (SELECT workspace_id FROM assets WHERE id = $1)
     ORDER BY w.name`,
    [id, roll]
  );
  return { grants: grants.rows, targets: targets.rows };
}

// GET /api/assets/:id/shares — the owner's view: current grants plus the
// workspaces they may still share into (every non-personal workspace they
// belong to, other than the asset's own).
assetSharingRouter.get('/:id/shares', requireStudent, async (req, res) => {
  const result = await sharingInfo(param(req.params.id), req.studentRoll!);
  if (!result) { res.status(404).json({ error: 'Asset not found' }); return; }
  res.json(result);
});

// Locks the asset so a concurrent hide/unpublish can't race the eligibility
// check. Target membership is checked independently; receiving a grant
// never permits resharing. roll = null is the site-admin path.
async function grant(id: string, target: string, roll: string | null): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [id]);
    const asset = found.rows[0];
    if (!asset) { await client.query('ROLLBACK'); return 404; }
    if (roll) {
      const member = await client.query(
        'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND roll_number = $2 FOR SHARE',
        [asset.workspace_id, roll]
      );
      if (asset.owner_roll !== roll || !member.rowCount) { await client.query('ROLLBACK'); return 404; }
    }
    if (asset.status !== 'active' || asset.visibility !== 'community' || asset.workspace_id === target) {
      await client.query('ROLLBACK');
      return 409;
    }
    const allowed = roll
      ? await client.query(
        `SELECT 1 FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.workspace_id = $1 AND m.roll_number = $2 AND NOT w.is_personal
         FOR SHARE OF m`,
        [target, roll]
      )
      : await client.query('SELECT 1 FROM workspaces WHERE id = $1 AND NOT is_personal FOR SHARE', [target]);
    if (!allowed.rowCount) { await client.query('ROLLBACK'); return 404; }
    await client.query(
      `INSERT INTO asset_workspace_grants (asset_id, workspace_id, created_by_roll)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [id, target, roll ?? 'site-admin']
    );
    await client.query('COMMIT');
    return 204;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Who may revoke a grant:
//   - the asset's owner — even after losing source or target membership, or
//     while the asset is hidden (idempotent: revoking a missing grant is 204);
//   - a site admin (roll = null);
//   - an owner or admin of the TARGET workspace, for a grant that exists into
//     that workspace — so a team can remove what was shared into it. This is
//     the only thing it lets them do: they still can't edit, delete, re-share
//     or otherwise manage the asset itself.
// Everyone else (ordinary target members, other members of the source
// workspace, outsiders) gets the same 404 as a nonexistent asset, so the
// response reveals nothing about the asset or its grants. Revoking only
// removes access; it never touches storage.
async function revoke(id: string, target: string, roll: string | null): Promise<number> {
  const found = await pool.query('SELECT owner_roll FROM assets WHERE id = $1', [id]);
  if (!found.rowCount) return 404;
  if (roll && found.rows[0].owner_roll !== roll) {
    const managesTarget = await pool.query(
      `SELECT 1 FROM asset_workspace_grants g
       JOIN workspace_members m ON m.workspace_id = g.workspace_id
       WHERE g.asset_id = $1 AND g.workspace_id = $2 AND m.roll_number = $3 AND m.role IN ('owner', 'admin')`,
      [id, target, roll]
    );
    if (!managesTarget.rowCount) return 404;
  }
  await pool.query('DELETE FROM asset_workspace_grants WHERE asset_id = $1 AND workspace_id = $2', [id, target]);
  return 204;
}

const GRANT_ERRORS: Record<number, string> = {
  404: 'Asset or authorized target not found',
  409: 'Only active Community assets can be shared to another workspace',
};

assetSharingRouter.put('/:id/shares/:workspaceId', requireStudent, async (req, res) => {
  const status = await grant(param(req.params.id), param(req.params.workspaceId), req.studentRoll!);
  if (status === 204) res.status(status).end();
  else res.status(status).json({ error: GRANT_ERRORS[status] });
});

assetSharingRouter.delete('/:id/shares/:workspaceId', requireStudent, async (req, res) => {
  const status = await revoke(param(req.params.id), param(req.params.workspaceId), req.studentRoll!);
  if (status === 204) res.status(status).end();
  else res.status(status).json({ error: 'Asset not found' });
});

assetSharingRouter.put('/admin/:id/shares/:workspaceId', requireAdmin, async (req, res) => {
  const status = await grant(param(req.params.id), param(req.params.workspaceId), null);
  if (status === 204) res.status(status).end();
  else res.status(status).json({ error: GRANT_ERRORS[status] });
});

assetSharingRouter.delete('/admin/:id/shares/:workspaceId', requireAdmin, async (req, res) => {
  const status = await revoke(param(req.params.id), param(req.params.workspaceId), null);
  if (status === 204) res.status(status).end();
  else res.status(status).json({ error: 'Asset not found' });
});

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import { pool } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';
import { param } from '../routeParams';
import { getStorage } from '../storage';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// ASSET MANAGER (Phase B, Commit B2/6) — a persistent, workspace-scoped,
// reusable file library. Distinct from boards.ts's POST /:id/canvas-files:
// that route stores objects via the same StorageProvider but keeps no DB
// row of its own (referenced only from one board's canvas_data/tldraw
// document JSON, never listed or reused elsewhere) — canvas-files is left
// completely untouched by this file. An asset row here is the thing a user
// can browse, preview, delete, and re-insert onto ANY board they can write
// to, scoped to a workspace exactly like boards themselves are.
//
// Permission model reuses existing helpers, no new permission system:
//   UPLOAD/LIST — caller must be a member of the target workspace
//     (workspace_members lookup, same inline check POST /api/boards already
//     uses for its own optional workspace_id — see that route's comment).
//   DELETE — asset owner, or a workspace owner/admin (workspace-management
//     tier, same as routes/workspaces.ts's canManage for removing a member).
//   INSERT-ONTO-BOARD is not a route here at all — the frontend fetches the
//     target board's own canEdit-gated data (board.workspace_id) and calls
//     the EXISTING getBoardRole/roleCanWriteCanvas check via whichever route
//     actually mutates the board's canvas; this router never authorizes
//     board writes itself.
// ─────────────────────────────────────────────────────────────────────────

const uploadAssetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many uploads — please slow down' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Extensions are derived from a validated content-type allowlist, never
// from the raw client MIME string or original filename — same convention
// as boards.ts's CANVAS_MIME_EXT, so a crafted filename/MIME can't smuggle
// path characters into the storage key.
const ASSET_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

interface AssetRow {
  id: string;
  workspace_id: string;
  owner_roll: string;
  owner_name: string | null;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

function toPublicAsset(row: AssetRow) {
  // Never return storage_key (an internal StorageProvider path, not
  // guaranteed public/stable) or any filesystem/service-role detail —
  // only the derived public URL, same boundary boards.ts's canvas-files
  // route already draws (returns `url`, never the raw storagePath).
  const { storage_key: _storage_key, ...rest } = row;
  return { ...rest, url: getStorage().getPublicUrl(row.storage_key) };
}

async function getWorkspaceMembership(workspaceId: string, roll: string): Promise<'owner' | 'admin' | 'member' | null> {
  const result = await pool.query(
    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND roll_number = $2',
    [workspaceId, roll]
  );
  return (result.rows[0] as { role: 'owner' | 'admin' | 'member' } | undefined)?.role ?? null;
}

// POST /api/assets
// Multipart upload: file + workspace_id. Uploads to storage FIRST, then
// inserts the DB row — if the DB insert fails, the just-uploaded object is
// deleted so a failed request never leaves an orphaned storage object with
// no corresponding row (see this file's own note on the reverse case,
// under DELETE, for the other half of this consistency story).
router.post('/', requireStudent, uploadAssetLimiter, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const workspaceId = typeof req.body.workspace_id === 'string' ? req.body.workspace_id : '';
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspace_id is required' });
    }

    // Never trust a client-provided role/ownership claim — re-derive
    // membership server-side from the authenticated roll on every request.
    const membership = await getWorkspaceMembership(workspaceId, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of that workspace' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const ext = ASSET_MIME_EXT[req.file.mimetype];
    if (!ext) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    let width: number | null = null;
    let height: number | null = null;
    // Best-effort only — dimension extraction failing (e.g. a malformed or
    // unusually-encoded SVG) must never block an otherwise-valid upload;
    // same graceful-degradation convention as artworks.ts's generateThumb.
    try {
      const metadata = await sharp(req.file.buffer).metadata();
      if (metadata.width && metadata.height) {
        width = metadata.width;
        height = metadata.height;
      }
    } catch {
      // Dimensions stay null — not fatal.
    }

    const id = uuidv4();
    const storageKey = `assets/${workspaceId}/${id}.${ext}`;

    await getStorage().upload(storageKey, req.file.buffer, req.file.mimetype);

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    // Client-provided filename is stored as display metadata ONLY — it
    // never touches the storage path (storageKey above is built entirely
    // from server-generated id + a validated extension), so a crafted
    // filename (e.g. containing "../" or null bytes) can't affect where
    // the object is actually stored.
    const rawFilename = typeof req.body.filename === 'string' ? req.body.filename : req.file.originalname;
    const filename = rawFilename.slice(0, 255) || `asset.${ext}`;
    const now = new Date().toISOString();

    let row: AssetRow;
    try {
      const result = await pool.query(`
        INSERT INTO assets
          (id, workspace_id, owner_roll, owner_name, filename, storage_key, mime_type, size_bytes, width, height, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [id, workspaceId, roll, ownerName, filename, storageKey, req.file.mimetype, req.file.size, width, height, now]);
      row = result.rows[0] as AssetRow;
    } catch (dbErr) {
      // Storage upload succeeded but the DB insert failed — delete the
      // now-orphaned object rather than leaving a file with no metadata
      // row anyone can ever discover or clean up. Best-effort: if the
      // cleanup delete itself fails, log it (an orphaned object is a
      // storage-cost leak, not a correctness/security issue) but still
      // surface the original DB error to the client.
      try {
        await getStorage().delete(storageKey);
      } catch (cleanupErr) {
        console.error('Failed to clean up orphaned asset object after DB insert failure:', storageKey, cleanupErr);
      }
      throw dbErr;
    }

    res.status(201).json(toPublicAsset(row));
  } catch (err) {
    console.error('Asset upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/assets?workspace_id=...&limit=&cursor=
// Workspace-scoped, newest-first, cursor-paginated on created_at+id (both
// strictly monotonic-enough for this table's insert pattern — created_at
// alone could tie within the same millisecond under concurrent uploads).
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

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const result = cursor
      ? await pool.query(
          `SELECT * FROM assets
           WHERE workspace_id = $1 AND (created_at, id) < (
             SELECT created_at, id FROM assets WHERE id = $2
           )
           ORDER BY created_at DESC, id DESC
           LIMIT $3`,
          [workspaceId, cursor, limit]
        )
      : await pool.query(
          `SELECT * FROM assets WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
          [workspaceId, limit]
        );

    const rows = result.rows as AssetRow[];
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    res.json({ assets: rows.map(toPublicAsset), nextCursor });
  } catch (err) {
    console.error('List assets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/assets/:id
router.get('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const result = await pool.query('SELECT * FROM assets WHERE id = $1', [param(req.params.id)]);
    const row = result.rows[0] as AssetRow | undefined;
    if (!row) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const membership = await getWorkspaceMembership(row.workspace_id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(toPublicAsset(row));
  } catch (err) {
    console.error('Get asset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/assets/:id
// Only the uploader, or a workspace owner/admin, may delete — same
// workspace-management tier routes/workspaces.ts's member-removal already
// uses. DB row is deleted first, then the storage object — if the storage
// delete fails, the API does NOT claim success: it still reports the
// failure rather than silently leaving an orphaned object while telling
// the client everything is clean. The DB row is gone either way (deleting
// it again is not retryable in a meaningful way once it succeeded), so a
// storage-delete failure here is reported as a 500 with a distinct message
// rather than rolled back — re-deleting is not attempted automatically,
// matching this codebase's "no background job system for V1" scope limit.
router.delete('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);

    const result = await pool.query('SELECT * FROM assets WHERE id = $1', [id]);
    const row = result.rows[0] as AssetRow | undefined;
    if (!row) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const isOwner = row.owner_roll === roll;
    if (!isOwner) {
      const membership = await getWorkspaceMembership(row.workspace_id, roll);
      if (membership !== 'owner' && membership !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    await pool.query('DELETE FROM assets WHERE id = $1', [id]);

    try {
      await getStorage().delete(row.storage_key);
    } catch (storageErr) {
      console.error('Asset DB row deleted but storage object delete failed:', row.storage_key, storageErr);
      return res.status(200).json({
        success: true,
        storageWarning: 'Asset removed, but the underlying file could not be deleted from storage.',
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete asset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
export { getWorkspaceMembership };

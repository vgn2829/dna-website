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
import { findStorageReferences } from '../storage/references';
import { deleteDerivatives, scheduleDerivative } from '../storage/derivatives';

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

// Two size tiers: images keep their original 15MB cap; general library
// files (PSD/AI/PDF/ZIP/...) get 25MB. multer enforces the larger tier as
// a hard ceiling (memory storage — the whole file is buffered, so this is
// also the per-request memory bound); the per-kind cap is checked in the
// handler once the kind is known.
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const FILE_MAX_BYTES = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_MAX_BYTES },
});

export const ASSET_KINDS = ['image', 'file', 'link'] as const;
export type AssetKind = typeof ASSET_KINDS[number];

// Extension for a general (non-image) library file, taken from the
// client filename's last dot-segment. Deliberately NOT a finite allowlist
// of formats (PSD, AI, EPS, XD, FIG, PDF, PPTX, ZIP, ... all work) — the
// server never parses these files. Safety instead comes from (a) the
// strict [a-z0-9]{1,12} shape, so nothing path-like reaches the storage
// key, and (b) storing/serving every such file as an
// application/octet-stream download (see the upload route below), so no
// extension — .html/.svg/.js included — can ever render as a page.
export function fileExtension(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : null;
}

// Client-reported MIME is display metadata only for general files (never
// used as the stored Content-Type) — keep it only if it's a plausible
// type/subtype token.
function displayMime(mime: string): string {
  return /^[\w.+-]{1,64}\/[\w.+-]{1,128}$/.test(mime) ? mime : 'application/octet-stream';
}

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

// Normalizes a user-supplied external link. Only absolute http(s) URLs,
// no embedded credentials (user:pass@ — a classic phishing disguise), at
// most 2048 chars. Returns the canonical href, or null if unacceptable.
// The URL is stored and displayed only — never fetched server-side.
export function normalizeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return url.href.length > 2048 ? null : url.href;
}

// True if collectionId names a collection in workspaceId. Every write that
// sets assets.collection_id goes through this, so an asset can never be
// grouped into another workspace's collection (and a foreign collection
// id is indistinguishable from a nonexistent one).
async function collectionInWorkspace(collectionId: string, workspaceId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM asset_collections WHERE id = $1 AND workspace_id = $2',
    [collectionId, workspaceId]
  );
  return result.rows.length > 0;
}

// Optional collection_id on create: absent/empty -> null (ungrouped).
async function resolveCreateCollection(raw: unknown, workspaceId: string): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, id: null };
  if (typeof raw !== 'string' || !(await collectionInWorkspace(raw, workspaceId))) return { ok: false };
  return { ok: true, id: raw };
}

interface AssetRow {
  id: string;
  workspace_id: string;
  owner_roll: string;
  owner_name: string | null;
  kind: AssetKind;
  collection_id: string | null;
  filename: string;
  link_url: string | null;
  // null only for kind='link' (no stored object).
  storage_key: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

function toPublicAsset(row: AssetRow) {
  // Never return storage_key (an internal StorageProvider path, not
  // guaranteed public/stable) or any filesystem/service-role detail —
  // only the derived public URL, same boundary boards.ts's canvas-files
  // route already draws (returns `url`, never the raw storagePath).
  //
  // Non-image files get a download (Content-Disposition: attachment) URL
  // under their display filename; images keep their plain inline URL,
  // exactly as before, since the board picker and <img> previews use it.
  // Links have no stored object: url is null and link_url carries the
  // external address.
  const { storage_key: storageKey, ...rest } = row;
  if (!storageKey) return { ...rest, extension: null, url: null };
  const extension = storageKey.slice(storageKey.lastIndexOf('.') + 1) || null;
  const url = getStorage().getPublicUrl(
    storageKey,
    row.kind === 'file' ? { download: row.filename } : undefined,
  );
  return { ...rest, extension, url };
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

    const collection = await resolveCreateCollection(req.body.collection_id, workspaceId);
    if (!collection.ok) {
      return res.status(400).json({ error: 'Collection not found in this workspace' });
    }

    // Classification. An allowlisted image MIME is ALWAYS an image
    // (inline, previewable, board-insertable) — exactly the original
    // behavior. Anything else is accepted only when the client explicitly
    // opts in with kind=file, so a request shaped like the original
    // image-only upload still gets the original "Unsupported file type".
    const imageExt = ASSET_MIME_EXT[req.file.mimetype];
    const originalName = typeof req.body.filename === 'string' ? req.body.filename : req.file.originalname;
    let kind: AssetKind;
    let ext: string;
    let storedMime: string;
    if (imageExt) {
      kind = 'image';
      ext = imageExt;
      storedMime = req.file.mimetype;
    } else if (req.body.kind === 'file') {
      const fileExt = fileExtension(originalName);
      if (!fileExt) {
        return res.status(400).json({ error: 'File name needs a valid extension (e.g. .psd, .pdf, .zip)' });
      }
      kind = 'file';
      ext = fileExt;
      // Never the client MIME: an octet-stream object is downloaded, not
      // rendered, by every browser — the other half of the
      // Content-Disposition download URL toPublicAsset builds for files.
      storedMime = 'application/octet-stream';
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    if (req.file.size > (kind === 'image' ? IMAGE_MAX_BYTES : FILE_MAX_BYTES)) {
      return res.status(400).json({ error: 'File exceeds the size limit for this upload' });
    }

    let width: number | null = null;
    let height: number | null = null;
    // Best-effort only — dimension extraction failing (e.g. a malformed or
    // unusually-encoded SVG) must never block an otherwise-valid upload;
    // same graceful-degradation convention as artworks.ts's generateThumb.
    // General files are never handed to sharp (never parsed server-side).
    if (kind === 'image') {
      try {
        const metadata = await sharp(req.file.buffer).metadata();
        if (metadata.width && metadata.height) {
          width = metadata.width;
          height = metadata.height;
        }
      } catch {
        // Dimensions stay null — not fatal.
      }
    }

    const id = uuidv4();
    const storageKey = `assets/${workspaceId}/${id}.${ext}`;

    await getStorage().upload(storageKey, req.file.buffer, storedMime);

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
    const filename = originalName.slice(0, 255) || `asset.${ext}`;
    const now = new Date().toISOString();

    let row: AssetRow;
    try {
      const result = await pool.query(`
        INSERT INTO assets
          (id, workspace_id, owner_roll, owner_name, kind, collection_id, filename, storage_key, mime_type, size_bytes, width, height, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `, [id, workspaceId, roll, ownerName, kind, collection.id, filename, storageKey,
          kind === 'image' ? req.file.mimetype : displayMime(req.file.mimetype),
          req.file.size, width, height, now]);
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

    // Original stored and its row persisted — now (best-effort, off the
    // response path) make its thumbnail derivative. Its outcome never
    // affects this upload; see storage/derivatives.ts.
    if (kind === 'image') scheduleDerivative(storageKey, req.file.buffer);

    res.status(201).json(toPublicAsset(row));
  } catch (err) {
    console.error('Asset upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/assets?workspace_id=...&limit=&cursor=&kind=&q=
// Workspace-scoped, newest-first, cursor-paginated on created_at+id (both
// strictly monotonic-enough for this table's insert pattern — created_at
// alone could tie within the same millisecond under concurrent uploads).
// Optional filters narrow the same keyset scan (workspace_id is always
// the leading predicate, so idx_assets_workspace_id still applies):
//   kind — image | file | link
//   q    — case-insensitive substring of the display name (plain ILIKE;
//          library sizes here don't justify full-text infrastructure)
//   collection_id — a collection id, or 'none' for ungrouped assets. A
//          collection from another workspace simply matches nothing (the
//          workspace_id predicate still applies).
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

    const kindFilter = typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : undefined;
    if (kindFilter && !(ASSET_KINDS as readonly string[]).includes(kindFilter)) {
      return res.status(400).json({ error: 'Invalid kind filter' });
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

    const params: unknown[] = [workspaceId];
    const where = ['workspace_id = $1'];
    if (kindFilter) {
      params.push(kindFilter);
      where.push(`kind = $${params.length}`);
    }
    const collectionFilter = typeof req.query.collection_id === 'string' && req.query.collection_id ? req.query.collection_id : undefined;
    if (collectionFilter === 'none') {
      where.push('collection_id IS NULL');
    } else if (collectionFilter) {
      params.push(collectionFilter);
      where.push(`collection_id = $${params.length}`);
    }
    if (q) {
      // Escape LIKE metacharacters so a search for "50%" or "a_b" is literal.
      params.push(`%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`);
      where.push(`filename ILIKE $${params.length}`);
    }
    if (cursor) {
      // The cursor row is looked up within the same workspace, so a cursor
      // id from another workspace can't be used to probe its timestamps.
      params.push(cursor);
      where.push(`(created_at, id) < (
        SELECT created_at, id FROM assets WHERE id = $${params.length} AND workspace_id = $1
      )`);
    }
    params.push(limit);

    const result = await pool.query(
      `SELECT * FROM assets
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
      params
    );

    const rows = result.rows as AssetRow[];
    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

    res.json({ assets: rows.map(toPublicAsset), nextCursor });
  } catch (err) {
    console.error('List assets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const createLinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests — please slow down' },
});

const createLinkSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  url: z.string().max(2048),
  collection_id: z.string().min(1).nullable().optional(),
});

// POST /api/assets/links
// An external link as a first-class library asset (Envato, Figma, Behance,
// Dribbble, Pinterest, Google Drive, any http(s) URL). Stores name + URL
// only: the server never fetches the URL (no previews, no scraping), so
// this route can't be used to make the backend request arbitrary hosts.
router.post('/links', requireStudent, createLinkLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const parsed = createLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid link: name, url and workspace_id are required' });
    }
    const { workspace_id: workspaceId, name } = parsed.data;

    const membership = await getWorkspaceMembership(workspaceId, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of that workspace' });
    }

    const linkUrl = normalizeLinkUrl(parsed.data.url);
    if (!linkUrl) {
      return res.status(400).json({ error: 'Enter a full http:// or https:// URL' });
    }

    const collection = await resolveCreateCollection(parsed.data.collection_id, workspaceId);
    if (!collection.ok) {
      return res.status(400).json({ error: 'Collection not found in this workspace' });
    }

    const studentResult = await pool.query('SELECT name FROM student_sessions WHERE roll_number = $1', [roll]);
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    const result = await pool.query(`
      INSERT INTO assets
        (id, workspace_id, owner_roll, owner_name, kind, collection_id, filename, link_url, created_at)
      VALUES ($1, $2, $3, $4, 'link', $5, $6, $7, $8)
      RETURNING *
    `, [uuidv4(), workspaceId, roll, ownerName, collection.id, name, linkUrl, new Date().toISOString()]);

    res.status(201).json(toPublicAsset(result.rows[0] as AssetRow));
  } catch (err) {
    console.error('Create link asset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const updateAssetSchema = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  collection_id: z.string().min(1).nullable().optional(),
}).refine(v => v.filename !== undefined || v.collection_id !== undefined, { message: 'Nothing to update' });

// PATCH /api/assets/:id
// Two edits, two tiers (both reuse existing workspace roles, no new
// permission concept):
//   collection_id — any member of the asset's workspace: grouping is
//     organisational and fully reversible, and collections exist so the
//     whole team can curate packs together.
//   filename (rename) — the uploader or a workspace owner/admin, the same
//     tier as DELETE, since it changes how everyone sees the asset.
// The target collection must belong to the asset's own workspace.
router.patch('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const id = param(req.params.id);
    const parsed = updateAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update' });
    }

    const found = await pool.query('SELECT * FROM assets WHERE id = $1', [id]);
    const row = found.rows[0] as AssetRow | undefined;
    if (!row) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const membership = await getWorkspaceMembership(row.workspace_id, roll);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { filename, collection_id: collectionId } = parsed.data;
    if (filename !== undefined && filename !== row.filename) {
      const canRename = row.owner_roll === roll || membership === 'owner' || membership === 'admin';
      if (!canRename) {
        return res.status(403).json({ error: 'Only the uploader or a workspace admin can rename this asset' });
      }
    }
    if (collectionId && !(await collectionInWorkspace(collectionId, row.workspace_id))) {
      return res.status(400).json({ error: 'Collection not found in this workspace' });
    }

    const result = await pool.query(`
      UPDATE assets SET
        filename = COALESCE($2, filename),
        collection_id = CASE WHEN $3::boolean THEN $4 ELSE collection_id END
      WHERE id = $1
      RETURNING *
    `, [id, filename ?? null, collectionId !== undefined, collectionId ?? null]);

    res.json(toPublicAsset(result.rows[0] as AssetRow));
  } catch (err) {
    console.error('Update asset error:', err);
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
// uses.
//
// SHARED-FILE MODEL: inserting an image asset onto a board stores the
// asset's own public URL in the canvas (no copy), and that URL travels into
// version snapshots, templates, template-created boards and duplicates
// (which may live in another workspace). So deleting the library asset
// deletes its ROW, but its storage OBJECT is deleted only when no persisted
// content references it (storage/references.ts) — otherwise it is kept, so
// "copies already placed on boards are unaffected" actually holds.
//
// Ordering: row first, then the reference check, then (if unreferenced)
// the object. Server-side copies (duplicate, template create/use, version
// creation) only ever copy already-persisted canvas text, so any reference
// they could produce is already visible to the check. What the check can't
// see is state not yet persisted: an insertion still inside a realtime
// room's save debounce or a manual board's unsaved/offline edits, or an
// asset picker opened before the asset was deleted. Those windows existed
// before this check (the object was always deleted) and are only closable
// with server-mediated insertion or deferred deletion.
//
// If the object delete fails, the row is already gone; the API still
// reports success with a storageWarning rather than claiming a clean
// delete. The object is then row-less and unreferenced — exactly what the
// historical orphan sweep identifies — so it remains cleanable later.
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

    // Links have no stored object to remove.
    if (!row.storage_key) {
      return res.json({ success: true });
    }

    const references = await findStorageReferences(row.storage_key);
    if (references.length > 0) {
      console.log(`Asset ${id} deleted; storage object ${row.storage_key} retained — still referenced by ${references.map(r => `${r.surface} ${r.id}`).join(', ')}`);
      return res.json({ success: true, fileRetained: true });
    }

    try {
      await getStorage().delete(row.storage_key);
    } catch (storageErr) {
      console.error('Asset DB row deleted but storage object delete failed:', row.storage_key, storageErr);
      return res.status(200).json({
        success: true,
        storageWarning: 'Asset removed, but the underlying file could not be deleted from storage.',
      });
    }

    // The original is gone, so its derivatives go too. (A RETAINED
    // original — returned above — keeps them: previews may still render
    // it.) Best-effort: a leftover derivative object is classified as an
    // ORPHAN by the storage inventory, and never affects this response.
    try {
      await deleteDerivatives(row.storage_key);
    } catch (derivErr) {
      console.error('Asset deleted but its derivatives could not be cleaned up:', row.storage_key, derivErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete asset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
export { getWorkspaceMembership };

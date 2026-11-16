import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';
import { param } from '../routeParams';
import { canUseAssetIn, toPublicAssets, type AssetRow } from './assets';
import {
  INSPIRATION_CATEGORIES, INSPIRATION_SORTS, SORT_SQL, MAX_TAGS,
  isInspirationCategory, likePattern, normalizeTags, titleFromUrl,
  urlDedupeKey, validateImageUrl, validateReferenceUrl, type InspirationSort,
} from '../lib/inspiration';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// Inspiration Library (DNA 2.0 Milestone C).
//
// A student's private set of saved creative references. Every route is
// owner-scoped in SQL (owner_roll = caller) — there is no cross-student read
// path, and a foreign id answers 404 exactly like a missing one.
//
// Items POINT at things, they never copy them:
//   kind 'asset' → an Asset Library record. Saving requires that the caller
//     can currently use that asset (canUseAssetIn — the SAME check the board
//     insertion path uses), and every read re-checks it, so an asset that is
//     later unshared/hidden/deleted stops resolving: the item comes back
//     `unavailable` with NO url, never the stale file location.
//   kind 'link'  → an external URL stored as text. The server never fetches
//     it (no scraping/preview/proxy), so there is no SSRF surface; validation
//     lives in lib/inspiration.ts.
// Deleting an item or collection never touches the underlying asset.
// Collections are private; `visibility` is stored for the future sharing
// milestone and only 'private' is ever written here.
// ─────────────────────────────────────────────────────────────────────────

const MAX_ITEMS_PER_STUDENT = 2000;
const MAX_COLLECTIONS_PER_STUDENT = 100;

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests — please slow down' },
});

interface ItemRow {
  id: string; owner_roll: string; kind: 'asset' | 'link'; asset_id: string | null;
  url: string | null; url_key: string | null; image_url: string | null;
  title: string; description: string | null; category: string | null; tags: string[];
  created_at: string; updated_at: string; collection_ids: string[];
}
interface CollectionRow {
  id: string; owner_roll: string; name: string; description: string | null; visibility: string;
  created_at: string; updated_at: string; item_count?: number;
}

const ITEM_SELECT = `
  SELECT i.*, COALESCE(
    (SELECT array_agg(ci.collection_id ORDER BY ci.added_at) FROM inspiration_collection_items ci WHERE ci.item_id = i.id),
    '{}') AS collection_ids
  FROM inspiration_items i`;

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === '23505';

// Resolves each asset-backed item against the caller's CURRENT access.
async function serializeItems(rows: ItemRow[], roll: string) {
  const assetIds = [...new Set(rows.flatMap(r => (r.asset_id ? [r.asset_id] : [])))];
  const visible = new Map<string, ReturnType<typeof publicAsset>>();
  if (assetIds.length) {
    const assets = (await pool.query('SELECT * FROM assets WHERE id = ANY($1::text[])', [assetIds])).rows as AssetRow[];
    const usable = (await Promise.all(assets.map(async a => (await canUseAssetIn(a, roll)) ? a : null)))
      .filter((a): a is AssetRow => a !== null);
    const resolved = await toPublicAssets(usable);
    for (const a of resolved) visible.set(a.id, publicAsset(a));
  }
  return rows.map(r => {
    const asset = r.asset_id ? visible.get(r.asset_id) ?? null : null;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      description: r.description,
      category: r.category,
      tags: r.tags,
      url: r.url,
      image_url: r.image_url,
      asset,
      // An asset-backed item whose asset the caller can no longer use.
      unavailable: r.kind === 'asset' && !asset,
      collection_ids: r.collection_ids,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
}

// The few asset fields the Inspiration UI needs — never storage keys.
function publicAsset(a: { id: string; kind: string; filename: string; url: string | null; thumb_url?: string | null; width: number | null; height: number | null; visibility: string; extension: string | null; link_url: string | null; workspace_id: string }) {
  return {
    id: a.id, kind: a.kind, filename: a.filename, url: a.url, thumb_url: a.thumb_url ?? null,
    width: a.width, height: a.height, visibility: a.visibility, extension: a.extension,
    link_url: a.link_url, workspace_id: a.workspace_id,
  };
}

async function loadOwnedItem(id: string, roll: string): Promise<ItemRow | null> {
  const res = await pool.query(`${ITEM_SELECT} WHERE i.id = $1 AND i.owner_roll = $2`, [id, roll]);
  return (res.rows[0] as ItemRow | undefined) ?? null;
}

async function ownedCollectionIds(ids: string[], roll: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const res = await pool.query('SELECT id FROM inspiration_collections WHERE owner_roll = $1 AND id = ANY($2::text[])', [roll, ids]);
  return (res.rows as Array<{ id: string }>).map(r => r.id);
}

// ── Items ────────────────────────────────────────────────────────────────

// GET /api/inspiration/items?q=&tag=a,b&category=&kind=&collection_id=&sort=&limit=&offset=
router.get('/items', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
    if (!(INSPIRATION_SORTS as readonly string[]).includes(sortRaw)) return res.status(400).json({ error: 'Invalid sort' });
    const sort = sortRaw as InspirationSort;
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    if (category && category !== 'none' && !isInspirationCategory(category)) return res.status(400).json({ error: 'Invalid category' });
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
    if (kind && kind !== 'asset' && kind !== 'link') return res.status(400).json({ error: 'Invalid kind' });
    const tags = normalizeTags(typeof req.query.tag === 'string' ? req.query.tag.split(',').slice(0, 5) : []);
    const collectionId = typeof req.query.collection_id === 'string' ? req.query.collection_id : '';
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 60) : 30;
    const offsetRaw = Number(req.query.offset);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

    const params: unknown[] = [roll];
    const where = ['i.owner_roll = $1'];
    const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q) {
      const p = bind(likePattern(q));
      where.push(`(i.title ILIKE ${p} OR i.description ILIKE ${p} OR array_to_string(i.tags, ' ') ILIKE ${p})`);
    }
    if (tags.length) where.push(`i.tags @> ${bind(tags)}::text[]`);
    if (category === 'none') where.push('i.category IS NULL');
    else if (category) where.push(`i.category = ${bind(category)}`);
    if (kind) where.push(`i.kind = ${bind(kind)}`);
    if (collectionId === 'none') {
      where.push('NOT EXISTS (SELECT 1 FROM inspiration_collection_items c WHERE c.item_id = i.id)');
    } else if (collectionId) {
      where.push(`EXISTS (SELECT 1 FROM inspiration_collection_items c WHERE c.item_id = i.id AND c.collection_id = ${bind(collectionId)})`);
    }
    const whereSql = where.join(' AND ');

    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM inspiration_items i WHERE ${whereSql}`, params)).rows[0].n as number;
    const rows = (await pool.query(
      `${ITEM_SELECT} WHERE ${whereSql} ORDER BY ${SORT_SQL[sort]} LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
      params,
    )).rows as ItemRow[];

    res.json({ items: await serializeItems(rows, roll), total, hasMore: offset + rows.length < total });
  } catch (err) {
    console.error('List inspiration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inspiration/facets — tag and category counts for the filter UI.
router.get('/facets', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const [tags, cats, total] = await Promise.all([
      pool.query(`SELECT t AS tag, COUNT(*)::int AS count FROM inspiration_items i, unnest(i.tags) AS t
                  WHERE i.owner_roll = $1 GROUP BY t ORDER BY count DESC, t ASC LIMIT 60`, [roll]),
      pool.query(`SELECT category, COUNT(*)::int AS count FROM inspiration_items
                  WHERE owner_roll = $1 AND category IS NOT NULL GROUP BY category`, [roll]),
      pool.query('SELECT COUNT(*)::int AS n FROM inspiration_items WHERE owner_roll = $1', [roll]),
    ]);
    res.json({ tags: tags.rows, categories: cats.rows, total: total.rows[0].n });
  } catch (err) {
    console.error('Inspiration facets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const metaFields = {
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.enum(INSPIRATION_CATEGORIES).nullable().optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  collection_ids: z.array(z.string().min(1)).max(20).optional(),
};
const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asset'), asset_id: z.string().min(1).max(100), ...metaFields }),
  z.object({
    kind: z.literal('link'),
    url: z.string().max(4096),
    image_url: z.string().max(4096).nullable().optional(),
    ...metaFields,
    title: z.string().trim().min(1).max(120).optional(),
  }),
]);

// POST /api/inspiration/items — save an asset or an external link.
router.post('/items', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const body = parsed.data;

    const count = (await pool.query('SELECT COUNT(*)::int AS n FROM inspiration_items WHERE owner_roll = $1', [roll])).rows[0].n as number;
    if (count >= MAX_ITEMS_PER_STUDENT) return res.status(400).json({ error: `You can save up to ${MAX_ITEMS_PER_STUDENT} references` });

    let assetId: string | null = null;
    let url: string | null = null;
    let urlKey: string | null = null;
    let imageUrl: string | null = null;
    let title = body.title;

    if (body.kind === 'asset') {
      const row = (await pool.query('SELECT * FROM assets WHERE id = $1', [body.asset_id])).rows[0] as AssetRow | undefined;
      // Not visible to the caller → indistinguishable from "does not exist".
      if (!row || !(await canUseAssetIn(row, roll))) return res.status(404).json({ error: 'Asset not found' });
      assetId = row.id;
      title = title ?? row.filename.slice(0, 120);
    } else {
      url = validateReferenceUrl(body.url);
      if (!url) return res.status(400).json({ error: 'Enter a valid public http(s) link' });
      urlKey = urlDedupeKey(url);
      if (body.image_url) {
        imageUrl = validateImageUrl(body.image_url);
        if (!imageUrl) return res.status(400).json({ error: 'Image address must be a public https link' });
      }
      title = title ?? titleFromUrl(url);
    }

    const dup = await pool.query(
      'SELECT id FROM inspiration_items WHERE owner_roll = $1 AND (($2::text IS NOT NULL AND asset_id = $2) OR ($3::text IS NOT NULL AND url_key = $3)) LIMIT 1',
      [roll, assetId, urlKey],
    );
    if (dup.rows[0]) return res.status(409).json({ error: 'Already saved to your Inspiration Library', existing_id: dup.rows[0].id });

    const collectionIds = await ownedCollectionIds(body.collection_ids ?? [], roll);
    if (collectionIds.length !== new Set(body.collection_ids ?? []).size) return res.status(404).json({ error: 'Collection not found' });

    const id = uuidv4();
    const now = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO inspiration_items (id, owner_roll, kind, asset_id, url, url_key, image_url, title, description, category, tags, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [id, roll, body.kind, assetId, url, urlKey, imageUrl, title, body.description ?? null, body.category ?? null, normalizeTags(body.tags), now],
      );
      for (const cid of collectionIds) {
        await client.query('INSERT INTO inspiration_collection_items (collection_id, item_id, added_at) VALUES ($1,$2,$3)', [cid, id, now]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const item = await loadOwnedItem(id, roll);
    res.status(201).json((await serializeItems([item!], roll))[0]);
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Already saved to your Inspiration Library' });
    console.error('Create inspiration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.enum(INSPIRATION_CATEGORIES).nullable().optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' });

// PATCH /api/inspiration/items/:id — title, description, category, tags.
router.patch('/items/:id', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const existing = await loadOwnedItem(param(req.params.id), roll);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const b = parsed.data;
    await pool.query(
      `UPDATE inspiration_items SET title = $3, description = $4, category = $5, tags = $6, updated_at = $7
       WHERE id = $1 AND owner_roll = $2`,
      [existing.id, roll,
        b.title ?? existing.title,
        b.description !== undefined ? b.description : existing.description,
        b.category !== undefined ? b.category : existing.category,
        b.tags !== undefined ? normalizeTags(b.tags) : existing.tags,
        new Date().toISOString()],
    );
    const item = await loadOwnedItem(existing.id, roll);
    res.json((await serializeItems([item!], roll))[0]);
  } catch (err) {
    console.error('Update inspiration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inspiration/items/:id — removes the reference only.
router.delete('/items/:id', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('DELETE FROM inspiration_items WHERE id = $1 AND owner_roll = $2', [param(req.params.id), req.studentRoll!]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete inspiration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Collections ──────────────────────────────────────────────────────────

const collectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
});

const publicCollection = (c: CollectionRow) => ({
  id: c.id, name: c.name, description: c.description, visibility: c.visibility,
  item_count: c.item_count ?? 0, created_at: c.created_at, updated_at: c.updated_at,
});

// GET /api/inspiration/collections
router.get('/collections', requireStudent, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM inspiration_collection_items ci WHERE ci.collection_id = c.id) AS item_count
       FROM inspiration_collections c WHERE c.owner_roll = $1 ORDER BY lower(c.name) ASC`,
      [req.studentRoll!],
    );
    res.json({ collections: (result.rows as CollectionRow[]).map(publicCollection) });
  } catch (err) {
    console.error('List inspiration collections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inspiration/collections — always private.
router.post('/collections', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const parsed = collectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a collection name (up to 80 characters)' });
    const n = (await pool.query('SELECT COUNT(*)::int AS n FROM inspiration_collections WHERE owner_roll = $1', [roll])).rows[0].n as number;
    if (n >= MAX_COLLECTIONS_PER_STUDENT) return res.status(400).json({ error: `You can have up to ${MAX_COLLECTIONS_PER_STUDENT} collections` });
    const now = new Date().toISOString();
    const row = (await pool.query(
      `INSERT INTO inspiration_collections (id, owner_roll, name, description, visibility, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'private',$5,$5) RETURNING *`,
      [uuidv4(), roll, parsed.data.name, parsed.data.description ?? null, now],
    )).rows[0] as CollectionRow;
    res.status(201).json(publicCollection({ ...row, item_count: 0 }));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'You already have a collection with that name' });
    console.error('Create inspiration collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/inspiration/collections/:id — rename / describe.
router.patch('/collections/:id', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const parsed = z.object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().trim().max(500).nullable().optional(),
    }).refine(v => v.name !== undefined || v.description !== undefined).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const existing = (await pool.query('SELECT * FROM inspiration_collections WHERE id = $1 AND owner_roll = $2', [param(req.params.id), roll])).rows[0] as CollectionRow | undefined;
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const row = (await pool.query(
      `UPDATE inspiration_collections SET name = $3, description = $4, updated_at = $5
       WHERE id = $1 AND owner_roll = $2
       RETURNING *, (SELECT COUNT(*)::int FROM inspiration_collection_items ci WHERE ci.collection_id = id) AS item_count`,
      [existing.id, roll, parsed.data.name ?? existing.name,
        parsed.data.description !== undefined ? parsed.data.description : existing.description, new Date().toISOString()],
    )).rows[0] as CollectionRow;
    res.json(publicCollection(row));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'You already have a collection with that name' });
    console.error('Update inspiration collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inspiration/collections/:id — items stay in the library.
router.delete('/collections/:id', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const result = await pool.query('DELETE FROM inspiration_collections WHERE id = $1 AND owner_roll = $2', [param(req.params.id), req.studentRoll!]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete inspiration collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inspiration/collections/:id/items { item_id } — idempotent.
router.post('/collections/:id/items', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;
    const parsed = z.object({ item_id: z.string().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'item_id is required' });
    const collectionId = param(req.params.id);
    // Both must belong to the caller; either missing → 404 (no probing).
    const ok = await pool.query(
      `SELECT 1 FROM inspiration_collections c, inspiration_items i
       WHERE c.id = $1 AND c.owner_roll = $3 AND i.id = $2 AND i.owner_roll = $3`,
      [collectionId, parsed.data.item_id, roll],
    );
    if (ok.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    await pool.query(
      'INSERT INTO inspiration_collection_items (collection_id, item_id, added_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [collectionId, parsed.data.item_id, new Date().toISOString()],
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Add to inspiration collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inspiration/collections/:id/items/:itemId — un-files only.
router.delete('/collections/:id/items/:itemId', requireStudent, writeLimiter, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `DELETE FROM inspiration_collection_items ci USING inspiration_collections c
       WHERE ci.collection_id = c.id AND c.id = $1 AND c.owner_roll = $3 AND ci.item_id = $2`,
      [param(req.params.id), param(req.params.itemId), req.studentRoll!],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Remove from inspiration collection error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { MAX_TAGS };
export default router;

import { pool } from '../db/client';

// ─────────────────────────────────────────────────────────────────────────
// Is a stored object still referenced by persisted content?
//
// Library assets use a SHARED-FILE model: inserting an image asset onto a
// board stores the asset's public URL as the tldraw image src (plus
// meta.sourceAssetId as provenance) — the file is not copied. That same
// URL is then carried verbatim into everything derived from the canvas:
// board version snapshots, templates, boards created from templates,
// duplicated boards (which land in the duplicator's PERSONAL workspace, so
// references cross workspaces), archived boards and restored boards.
//
// A public URL always embeds the object's storage key
// (…/uploads/<key> locally, …/object/public/<bucket>/<key> on Supabase),
// so the check is a substring match of the storage key against every
// persisted surface that can hold a canvas or an image URL. No objects
// are downloaded, and no workspace/membership assumption is made — a
// reference counts wherever it lives.
//
// Only PERSISTED state is visible here. Edits still inside a realtime
// room's save debounce, a manual board's unsaved local changes, or an
// asset picker opened before the asset was deleted are not — see the
// asset delete route for what that means.
// ─────────────────────────────────────────────────────────────────────────

export type ReferenceSurface =
  | 'board canvas'
  | 'board version'
  | 'template'
  | 'board item'
  | 'board thumbnail'
  | 'template thumbnail';

export interface StorageReference {
  surface: ReferenceSurface;
  id: string;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`);

// Anything that can run a query — the shared pool (default) or a single
// client, e.g. one inside a BEGIN READ ONLY transaction (the storage
// inventory command uses that to make its session provably read-only).
export interface DbExecutor {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export async function findStorageReferences(storageKey: string, limit = 5, db: DbExecutor = pool): Promise<StorageReference[]> {
  if (!storageKey || storageKey.length < 8) {
    // An empty/degenerate key would match everything — refuse rather than
    // report a meaningless "referenced".
    throw new Error(`findStorageReferences: refusing to search for an unsafe storage key ${JSON.stringify(storageKey)}`);
  }
  const like = `%${escapeLike(storageKey)}%`;
  const result = await db.query(
    `SELECT 'board canvas' AS surface, id FROM boards WHERE canvas_data LIKE $1
     UNION ALL SELECT 'board version', id FROM board_versions WHERE snapshot LIKE $1
     UNION ALL SELECT 'template', id FROM templates WHERE canvas_data LIKE $1
     UNION ALL SELECT 'board item', id FROM board_items WHERE image_url LIKE $1
     UNION ALL SELECT 'board thumbnail', id FROM boards WHERE thumbnail_url LIKE $1
     UNION ALL SELECT 'template thumbnail', id FROM templates WHERE thumbnail_url LIKE $1
     LIMIT $2`,
    [like, limit]
  );
  return result.rows as StorageReference[];
}

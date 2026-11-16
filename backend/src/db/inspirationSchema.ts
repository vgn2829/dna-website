import type { Pool } from 'pg';

// Inspiration Library tables. Called from initSchema after its target guard.
// Additive and idempotent; no existing table or column is altered.
//
// An inspiration ITEM is a private pointer owned by one student: either to an
// Asset Library asset (asset_id — never a copy of the file) or to an external
// link (url, stored as text, never fetched by the server). A COLLECTION groups
// the owner's items; membership is many-to-many so one reference can live in
// several collections. `visibility` is reserved for the future sharing
// milestone: the API only ever writes 'private' today, and sharing will add an
// inspiration_collection_members table rather than change these.
export async function initInspirationSchema(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS inspiration_items (
      id          TEXT PRIMARY KEY,
      owner_roll  TEXT NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN ('asset', 'link')),
      asset_id    TEXT REFERENCES assets(id) ON DELETE CASCADE,
      url         TEXT,
      url_key     TEXT,
      image_url   TEXT,
      title       TEXT NOT NULL,
      description TEXT,
      category    TEXT,
      tags        TEXT[] NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      CHECK (
        (kind = 'asset' AND asset_id IS NOT NULL AND url IS NULL) OR
        (kind = 'link'  AND asset_id IS NULL AND url IS NOT NULL AND url_key IS NOT NULL)
      )
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inspiration_items_owner
    ON inspiration_items (owner_roll, created_at DESC)`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inspiration_items_owner_asset
    ON inspiration_items (owner_roll, asset_id) WHERE asset_id IS NOT NULL`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inspiration_items_owner_url
    ON inspiration_items (owner_roll, url_key) WHERE url_key IS NOT NULL`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inspiration_items_tags
    ON inspiration_items USING GIN (tags)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS inspiration_collections (
      id          TEXT PRIMARY KEY,
      owner_roll  TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      visibility  TEXT NOT NULL DEFAULT 'private',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inspiration_collections_owner_name
    ON inspiration_collections (owner_roll, lower(name))`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS inspiration_collection_items (
      collection_id TEXT NOT NULL REFERENCES inspiration_collections(id) ON DELETE CASCADE,
      item_id       TEXT NOT NULL REFERENCES inspiration_items(id) ON DELETE CASCADE,
      added_at      TEXT NOT NULL,
      PRIMARY KEY (collection_id, item_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inspiration_collection_items_item
    ON inspiration_collection_items (item_id)`);
}

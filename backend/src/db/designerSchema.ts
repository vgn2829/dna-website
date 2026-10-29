import type { Pool } from 'pg';

// Additive, rerunnable startup migration. No name matching or legacy backfill.
// Called after initSchema's target guard and account/artwork initialization.
export async function initDesignerSchema(db: Pool): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS designer_profiles (
        id TEXT PRIMARY KEY,
        owner_roll TEXT NOT NULL UNIQUE REFERENCES student_sessions(roll_number) ON DELETE RESTRICT,
        handle TEXT NOT NULL UNIQUE CHECK (
          length(handle) BETWEEN 3 AND 30 AND handle ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
        ),
        display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
        bio TEXT CHECK (bio IS NULL OR length(bio) <= 500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE artworks ADD COLUMN IF NOT EXISTS creator_designer_id TEXT
        REFERENCES designer_profiles(id) ON DELETE RESTRICT;
      CREATE INDEX IF NOT EXISTS idx_artworks_creator_designer_id ON artworks(creator_designer_id);

      -- Historical IDs intentionally have no FK: existing artwork deletion
      -- must remain possible without deleting or rewriting attribution history.
      -- Auth currently has ONE shared admin principal, not individual admins.
      CREATE TABLE IF NOT EXISTS artwork_attribution_audit (
        id BIGSERIAL PRIMARY KEY,
        artwork_id TEXT NOT NULL,
        previous_designer_id TEXT,
        new_designer_id TEXT,
        actor TEXT NOT NULL CHECK (actor = 'admin'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_artwork_attribution_audit_artwork
        ON artwork_attribution_audit(artwork_id, created_at);
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

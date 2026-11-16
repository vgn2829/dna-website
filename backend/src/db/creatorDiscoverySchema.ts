import type { Pool } from 'pg';

// Creator Discovery (Milestone E). The ONLY table this adds is the admin's
// featured set. It deliberately has no foreign key to designer_profiles
// (PR #84) so it can be created whether or not that table exists yet; every
// read joins profiles and filters public + active, so a featured row can
// never make a private or hidden profile visible.
export async function initCreatorDiscoverySchema(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS creator_features (
      profile_id  TEXT PRIMARY KEY,
      featured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_creator_features_at ON creator_features (featured_at DESC)`);
  // V1.1: admin-controlled order (lower first; NULL sorts after any number) and
  // an optional short editorial blurb shown beside the featured badge.
  await db.query(`ALTER TABLE creator_features ADD COLUMN IF NOT EXISTS display_order INTEGER`);
  await db.query(`ALTER TABLE creator_features ADD COLUMN IF NOT EXISTS editorial_note TEXT`);
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creator_features_note_len') THEN
        ALTER TABLE creator_features ADD CONSTRAINT creator_features_note_len CHECK (editorial_note IS NULL OR length(editorial_note) <= 200);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creator_features_order_range') THEN
        ALTER TABLE creator_features ADD CONSTRAINT creator_features_order_range CHECK (display_order IS NULL OR display_order BETWEEN 0 AND 999);
      END IF;
    END $$`);
}

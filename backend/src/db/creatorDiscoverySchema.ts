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
}

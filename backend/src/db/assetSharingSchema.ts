import type { Pool } from 'pg';

// Called only after initSchema's target guard. No stored files or ownership move.
export async function initAssetSharingSchema(db: Pool): Promise<void> {
  await db.query('ALTER TABLE assets ADD COLUMN IF NOT EXISTS upload_fingerprint TEXT');
  await db.query(`
    CREATE TABLE IF NOT EXISTS asset_workspace_grants (
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_by_roll TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (asset_id, workspace_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_asset_grants_workspace
    ON asset_workspace_grants(workspace_id, asset_id)`);
  await migrateAssetVisibility(db);
  // Community lists aren't led by workspace_id (Community is club-wide), so
  // they get their own small partial index in list order.
  await db.query(`CREATE INDEX IF NOT EXISTS idx_assets_community
    ON assets (created_at DESC, id DESC) WHERE visibility = 'community' AND status = 'active'`);
}

// Asset visibility gains 'workspace' (lib/libraryVisibility.ts), and
// 'community' becomes club-wide. Every asset already marked 'community' was
// published under the old meaning — its source workspace's members plus
// explicit grants — which is exactly what 'workspace' means now, so those
// rows are renamed to 'workspace' and nobody gains access to anything they
// couldn't already see. (An owner or admin who wants club-wide reach
// publishes again.) Runs once, in one transaction: the CHECK is widened,
// the rows renamed and the migration recorded together, or not at all. The
// schema_migrations key is claimed first, so a second instance booting at
// the same moment waits on it and then skips.
export const ASSET_VISIBILITY_MIGRATION = 'asset_visibility_workspace_v1';

export async function migrateAssetVisibility(db: Pool): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key',
      [ASSET_VISIBILITY_MIGRATION]
    );
    if (!claimed.rowCount) { await client.query('ROLLBACK'); return; }
    // The original CHECK was declared inline on ADD COLUMN, so its name is
    // Postgres-generated; find every CHECK on assets that mentions visibility.
    const checks = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'assets'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%visibility%'`
    );
    for (const { conname } of checks.rows) {
      await client.query(`ALTER TABLE assets DROP CONSTRAINT "${conname.replace(/"/g, '""')}"`);
    }
    await client.query(`ALTER TABLE assets ADD CONSTRAINT assets_visibility_check
      CHECK (visibility IN ('personal', 'workspace', 'community'))`);
    const renamed = await client.query(`UPDATE assets SET visibility = 'workspace' WHERE visibility = 'community'`);
    await client.query('COMMIT');
    console.log(`Migration applied: ${renamed.rowCount ?? 0} community asset(s) kept at their existing reach as 'workspace'`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

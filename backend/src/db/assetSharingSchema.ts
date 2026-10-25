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
}

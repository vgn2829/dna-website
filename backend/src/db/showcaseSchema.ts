import type { Pool } from 'pg';

// Public Project Showcase tables (Milestone D). Additive and idempotent; no
// existing table is altered. `showcase_projects` is deliberately separate from
// the workspace `projects` table (private, V2.2) — they are unrelated.
// Roll numbers appear here (ownership/consent) and are NEVER returned by a
// public endpoint; credits are keyed by roll so #84's designer_profiles
// (1:1 with owner_roll) attach later by lookup with no migration.
export async function initShowcaseSchema(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS showcase_projects (
      id           TEXT PRIMARY KEY,
      owner_roll   TEXT NOT NULL,
      slug         TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 80),
      title        TEXT NOT NULL,
      summary      TEXT,
      description  TEXT,
      category     TEXT,
      tags         TEXT[] NOT NULL DEFAULT '{}',
      links        JSONB NOT NULL DEFAULT '[]',
      status       TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','submitted','changes_requested','approved','published','rejected','archived')),
      review_note  TEXT,
      featured_at  TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_showcase_projects_owner ON showcase_projects (owner_roll, updated_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_showcase_projects_published
    ON showcase_projects (published_at DESC) WHERE status = 'published'`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_showcase_projects_tags ON showcase_projects USING GIN (tags)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS showcase_project_disciplines (
      project_id TEXT NOT NULL REFERENCES showcase_projects(id) ON DELETE CASCADE,
      domain_id  TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, domain_id)
    )
  `);

  // Works. asset_id is the PRIVATE source (owner-only); public_key is the
  // sanitised COPY made at publish time and the only thing public reads use.
  await db.query(`
    CREATE TABLE IF NOT EXISTS showcase_assets (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES showcase_projects(id) ON DELETE CASCADE,
      asset_id   TEXT REFERENCES assets(id) ON DELETE SET NULL,
      caption    TEXT,
      position   INT NOT NULL DEFAULT 0,
      is_cover   BOOLEAN NOT NULL DEFAULT false,
      public_key TEXT,
      public_mime TEXT,
      width      INT,
      height     INT
    )
  `);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_showcase_assets_asset
    ON showcase_assets (project_id, asset_id) WHERE asset_id IS NOT NULL`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_showcase_assets_cover
    ON showcase_assets (project_id) WHERE is_cover`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_showcase_assets_project ON showcase_assets (project_id, position)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS showcase_credits (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES showcase_projects(id) ON DELETE CASCADE,
      roll         TEXT NOT NULL,
      role_label   TEXT,
      contribution TEXT,
      display_name TEXT,
      position     INT NOT NULL DEFAULT 0,
      status       TEXT NOT NULL CHECK (status IN ('accepted','pending','declined')),
      is_owner     BOOLEAN NOT NULL DEFAULT false,
      invited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ,
      UNIQUE (project_id, roll)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_showcase_credits_roll ON showcase_credits (roll, status)`);

  // Private process references; never exposed publicly.
  await db.query(`
    CREATE TABLE IF NOT EXISTS showcase_boards (
      project_id TEXT NOT NULL REFERENCES showcase_projects(id) ON DELETE CASCADE,
      board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, board_id)
    )
  `);

  // Reserved interface for Gallery artworks the creator is credited on
  // (ownership proven through #84's artwork_credits via lib/creatorIdentity).
  await db.query(`
    CREATE TABLE IF NOT EXISTS showcase_artworks (
      project_id TEXT NOT NULL REFERENCES showcase_projects(id) ON DELETE CASCADE,
      artwork_id TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      position   INT NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, artwork_id)
    )
  `);

  // Append-only status history (no FK so it survives deleting a project).
  await db.query(`
    CREATE TABLE IF NOT EXISTS showcase_events (
      id          BIGSERIAL PRIMARY KEY,
      project_id  TEXT NOT NULL,
      from_status TEXT,
      to_status   TEXT NOT NULL,
      actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('student','admin','system')),
      actor_roll  TEXT,
      reason      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_showcase_events_project ON showcase_events (project_id, created_at)`);
}

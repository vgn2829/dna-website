import type { Pool } from 'pg';

// DNA 2.0 Phase 1 — creator identity + artwork attribution schema
// (docs/dna-2.0/DNA_2.0_PHASE_1_TECHNICAL_SPEC.md §4).
//
// Additive, transactional and re-runnable. Called from initSchema() after its
// target guard, assets and artworks. Rules this module keeps:
//   - designer_profiles EXTENDS student_sessions (real FK); it never copies
//     name/email/roll, and nothing here is ever served by SELECT *.
//   - Existing artwork rows are neither rewritten nor re-attributed: the new
//     artworks columns default so every legacy row stays a published,
//     admin-curated Gallery piece, and the free-text `artist` column is
//     untouched. There is no name-matching backfill.
//   - New profiles are private; the privacy default for artwork `status` is
//     flipped to 'draft' only in a follow-up deploy (spec §6.4).
export async function initDesignerSchema(db: Pool): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS designer_profiles (
        id                TEXT PRIMARY KEY,
        owner_roll        TEXT NOT NULL UNIQUE
                          REFERENCES student_sessions(roll_number) ON DELETE RESTRICT,
        handle            TEXT NOT NULL UNIQUE CHECK (
          length(handle) BETWEEN 3 AND 30 AND handle ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
        ),
        handle_changed_at TIMESTAMPTZ,
        display_name      TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
        headline          TEXT CHECK (headline IS NULL OR length(headline) <= 80),
        bio               TEXT CHECK (bio IS NULL OR length(bio) <= 500),
        department        TEXT CHECK (department IS NULL OR length(department) <= 60),
        show_batch        BOOLEAN NOT NULL DEFAULT false,
        skills            TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(skills) <= 12),
        avatar_key        TEXT,
        cover_key         TEXT,
        visibility        TEXT NOT NULL DEFAULT 'private'
                          CHECK (visibility IN ('private','members','public')),
        moderation_status TEXT NOT NULL DEFAULT 'active'
                          CHECK (moderation_status IN ('active','hidden')),
        verified_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_designer_profiles_public
        ON designer_profiles (created_at DESC)
        WHERE visibility = 'public' AND moderation_status = 'active';

      CREATE TABLE IF NOT EXISTS designer_profile_disciplines (
        profile_id TEXT NOT NULL REFERENCES designer_profiles(id) ON DELETE CASCADE,
        domain_id  TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        PRIMARY KEY (profile_id, domain_id)
      );

      CREATE TABLE IF NOT EXISTS designer_profile_links (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES designer_profiles(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN
          ('website','behance','dribbble','instagram','linkedin','github','youtube','other')),
        url        TEXT NOT NULL CHECK (length(url) <= 2048),
        position   INT  NOT NULL,
        UNIQUE (profile_id, position)
      );

      -- Public-work lifecycle on the existing Gallery table. Legacy rows are
      -- 'published' / 'gallery_admin' via the defaults; no UPDATE is run.
      ALTER TABLE artworks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'
        CHECK (status IN ('draft','published','hidden'));
      ALTER TABLE artworks ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'gallery_admin'
        CHECK (source_kind IN ('gallery_admin','asset','tool_export'));
      -- Provenance only; never used to resolve a public URL (publishing copies).
      ALTER TABLE artworks ADD COLUMN IF NOT EXISTS source_asset_id TEXT
        REFERENCES assets(id) ON DELETE SET NULL;
      ALTER TABLE artworks ADD COLUMN IF NOT EXISTS created_by_roll TEXT;
      ALTER TABLE artworks ADD COLUMN IF NOT EXISTS description TEXT
        CHECK (description IS NULL OR length(description) <= 1000);
      ALTER TABLE artworks ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_artworks_status_published
        ON artworks (created_at DESC) WHERE status = 'published';
      CREATE INDEX IF NOT EXISTS idx_artworks_created_by
        ON artworks (created_by_roll) WHERE created_by_roll IS NOT NULL;

      -- Attribution: who made an artwork, in what role/order, and whether they
      -- agreed. The credit row is the single source of truth (no owner column
      -- on artworks). Only 'accepted' credits are ever public.
      CREATE TABLE IF NOT EXISTS artwork_credits (
        id              TEXT PRIMARY KEY,
        artwork_id      TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
        profile_id      TEXT NOT NULL REFERENCES designer_profiles(id) ON DELETE RESTRICT,
        role            TEXT NOT NULL CHECK (role IN ('creator','co-creator','contributor')),
        role_label      TEXT CHECK (role_label IS NULL OR length(role_label) <= 40),
        is_primary      BOOLEAN NOT NULL DEFAULT false,
        position        INT NOT NULL DEFAULT 0,
        status          TEXT NOT NULL CHECK (status IN ('pending','accepted','declined')),
        source          TEXT NOT NULL CHECK (source IN ('publisher','invite','admin')),
        invited_by_roll TEXT,
        responded_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (artwork_id, profile_id),
        CHECK (NOT is_primary OR (role = 'creator' AND status = 'accepted'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_artwork_credits_primary
        ON artwork_credits (artwork_id) WHERE is_primary;
      CREATE INDEX IF NOT EXISTS idx_artwork_credits_profile
        ON artwork_credits (profile_id, status);
      CREATE INDEX IF NOT EXISTS idx_artwork_credits_artwork
        ON artwork_credits (artwork_id, position);

      -- Append-only moderation/attribution trail. entity_id has no FK so the
      -- history survives deleting the artwork or profile. The admin principal
      -- is shared today, hence actor_roll is NULL for admin actions.
      CREATE TABLE IF NOT EXISTS creator_audit_log (
        id          BIGSERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id   TEXT NOT NULL,
        action      TEXT NOT NULL,
        actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('admin','student','system')),
        actor_roll  TEXT,
        detail      JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_creator_audit_entity
        ON creator_audit_log (entity_type, entity_id, created_at);

      -- V1.1: tools a creator works in (Figma, Blender, …). Additive; existing
      -- rows get '{}'. Same shape and normalisation as skills.
      ALTER TABLE designer_profiles ADD COLUMN IF NOT EXISTS tools TEXT[] NOT NULL DEFAULT '{}';
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'designer_profiles_tools_max') THEN
          ALTER TABLE designer_profiles ADD CONSTRAINT designer_profiles_tools_max CHECK (cardinality(tools) <= 12);
        END IF;
      END $$;
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

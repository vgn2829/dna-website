import { pool } from './client';

export async function initSchema(): Promise<void> {
  // Migration: add sequence column + back-fill by insertion order per domain.
  // ALTER TABLE … ADD COLUMN IF NOT EXISTS is idempotent on re-runs.
  // The WHERE sequence = 0 guard makes the UPDATE idempotent too.
  await pool.query(`
    ALTER TABLE artworks ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
  `);

  await pool.query(`
    ALTER TABLE artworks
    ADD COLUMN IF NOT EXISTS cover_url TEXT DEFAULT NULL
  `);

  await pool.query(`
    ALTER TABLE videos ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL DEFAULT 0;

    UPDATE videos v
    SET sequence = sub.rn
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY domain_id ORDER BY created_at ASC) AS rn
      FROM videos
    ) sub
    WHERE v.id = sub.id AND v.sequence = 0;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS domains (
      id            TEXT        PRIMARY KEY,
      title         TEXT        NOT NULL,
      full_name     TEXT        NOT NULL,
      icon          TEXT        NOT NULL DEFAULT 'fa-layer-group',
      tagline       TEXT        NOT NULL DEFAULT '',
      description   TEXT        NOT NULL DEFAULT '',
      color         TEXT        NOT NULL DEFAULT '#007AFF',
      display_order INT         NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS videos (
      id          TEXT        PRIMARY KEY,
      domain_id   TEXT        NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      title       TEXT        NOT NULL,
      yt_id       TEXT        NOT NULL,
      difficulty  TEXT        NOT NULL CHECK (difficulty IN ('Beginner','Intermediate','Advanced')),
      duration    TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id           BIGSERIAL   PRIMARY KEY,
      domain_id    TEXT        NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      question     TEXT        NOT NULL,
      options      TEXT        NOT NULL,
      answer_index INT         NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id               TEXT        PRIMARY KEY,
      title            TEXT        NOT NULL,
      date             TEXT        NOT NULL,
      time             TEXT        NOT NULL,
      location         TEXT        NOT NULL,
      content          TEXT        NOT NULL,
      capacity         INT         NOT NULL,
      registered_count INT         NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS event_rsvps (
      event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      roll_number TEXT NOT NULL,
      PRIMARY KEY (event_id, roll_number)
    );

    CREATE TABLE IF NOT EXISTS artworks (
      id                TEXT    PRIMARY KEY,
      title             TEXT    NOT NULL,
      artist            TEXT    NOT NULL,
      domain            TEXT    NOT NULL,
      image_url         TEXT,
      media_type        TEXT    NOT NULL DEFAULT 'image'
                                CHECK (media_type IN ('image','pdf','video')),
      storage_path      TEXT,
      original_filename TEXT,
      mime_type         TEXT,
      file_size         BIGINT  CHECK (file_size IS NULL OR file_size <= 52428800),
      likes             INT     NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS artwork_likes (
      artwork_id  TEXT NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      roll_number TEXT NOT NULL,
      PRIMARY KEY (artwork_id, roll_number)
    );

    CREATE TABLE IF NOT EXISTS artwork_comments (
      id          TEXT        PRIMARY KEY,
      artwork_id  TEXT        NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      sender      TEXT        NOT NULL,
      text        TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS student_sessions (
      roll_number   TEXT PRIMARY KEY,
      unique_id     TEXT NOT NULL,
      registered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_watched_videos (
      roll_number TEXT NOT NULL,
      video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      PRIMARY KEY (roll_number, video_id)
    );

    CREATE TABLE IF NOT EXISTS student_completed_quizzes (
      roll_number TEXT NOT NULL,
      domain_id   TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
      PRIMARY KEY (roll_number, domain_id)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id               BIGSERIAL   PRIMARY KEY,
      name             TEXT        NOT NULL,
      designation      TEXT        NOT NULL,
      year             TEXT,
      bio              TEXT,
      color            TEXT        NOT NULL DEFAULT '#007AFF',
      photo_path       TEXT,
      display_order    INT         NOT NULL DEFAULT 0,
      social_instagram TEXT,
      social_linkedin  TEXT,
      social_email     TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

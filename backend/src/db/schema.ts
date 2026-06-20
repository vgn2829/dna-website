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
  `);

  await pool.query(`
    ALTER TABLE student_sessions
    ADD COLUMN IF NOT EXISTS name TEXT DEFAULT NULL
  `);

  await pool.query(`
    ALTER TABLE student_sessions
    ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL
  `);

  await pool.query(`

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

  // Clear old sessions that are missing email (pre-registration-form era)
  const hasOldEntries = await pool.query(
    `SELECT COUNT(*) FROM student_sessions WHERE email IS NULL`
  );
  if (parseInt((hasOldEntries.rows[0] as { count: string }).count) > 0) {
    await pool.query(`DELETE FROM student_sessions`);
    console.log('Cleared old student_sessions (missing email/name)');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      subject     TEXT NOT NULL,
      body        TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);

  const templateCount = await pool.query(`SELECT COUNT(*) FROM email_templates`);
  if (parseInt((templateCount.rows[0] as { count: string }).count) === 0) {
    const now = new Date().toISOString();

    const welcomeBody = `<h2 style="margin:0 0 12px;font-size:22px;color:#ffffff;">Welcome to DnA Club, {{name}}</h2>
        <p style="margin:0 0 12px;color:#cccccc;font-size:15px;line-height:1.7;">
          You are now part of the Design and Animation Club family at IIT Kanpur.
        </p>
        <p style="margin:0 0 12px;color:#cccccc;font-size:15px;line-height:1.7;">
          We are a community of designers, animators, and creative thinkers.
          Explore our gallery, attend our events, and be part of the creative
          journey at IITK.
        </p>
        <p style="margin:0;color:#cccccc;font-size:15px;line-height:1.7;">
          Stay tuned for updates on workshops, exhibitions, and events.
          We are glad to have you with us.
        </p>`;

    const artworkBody = `<h2 style="margin:0 0 8px;font-size:22px;color:#ffffff;">New Artwork: {{title}}</h2>
        <p style="margin:0 0 4px;color:#999;font-size:14px;">by {{artist}}</p>
        <p style="margin:0 0 16px;color:#999;font-size:14px;">{{domain}}</p>
        <p style="margin:16px 0;color:#cccccc;font-size:15px;line-height:1.7;">
          A new artwork has been added to the DnA Club gallery. Visit the
          website to explore the latest creative work from our members.
        </p>`;

    const eventBody = `<h2 style="margin:0 0 8px;font-size:22px;color:#ffffff;">New Event: {{title}}</h2>
        <p style="margin:0 0 4px;color:#999;font-size:14px;">Date: {{date}}</p>
        <p style="margin:0 0 16px;color:#999;font-size:14px;">Venue: {{venue}}</p>
        <p style="margin:16px 0;color:#cccccc;font-size:15px;line-height:1.7;">{{description}}</p>`;

    await pool.query(
      `INSERT INTO email_templates (id, name, subject, body, updated_at) VALUES ($1,$2,$3,$4,$5)`,
      ['welcome', 'Welcome Email', 'Welcome to Design and Animation Club, IIT Kanpur', welcomeBody, now]
    );
    await pool.query(
      `INSERT INTO email_templates (id, name, subject, body, updated_at) VALUES ($1,$2,$3,$4,$5)`,
      ['new_artwork', 'New Artwork', 'New Artwork: {{title}} by {{artist}} — DnA Club IITK', artworkBody, now]
    );
    await pool.query(
      `INSERT INTO email_templates (id, name, subject, body, updated_at) VALUES ($1,$2,$3,$4,$5)`,
      ['new_event', 'New Event', 'New Event: {{title}} — DnA Club IITK', eventBody, now]
    );
    console.log('Email templates seeded');
  }
}

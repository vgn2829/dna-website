import { pool } from './client';

export async function initSchema(): Promise<void> {
  // Tracks one-time migrations so destructive/backfill steps can't silently re-run.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      key        TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // All base tables are created first (below); ALTER TABLE migrations that
  // reference them run afterwards, so a fresh/empty database bootstraps cleanly.
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

  // Column migrations on the tables created above.
  // ALTER TABLE … ADD COLUMN IF NOT EXISTS is idempotent on re-runs.
  await pool.query(`
    ALTER TABLE artworks ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
  `);

  await pool.query(`
    ALTER TABLE artworks
    ADD COLUMN IF NOT EXISTS cover_url TEXT DEFAULT NULL
  `);

  // NULL = student notification not yet sent for this event/artwork. New records
  // default to NULL (creation no longer auto-sends); an admin sends explicitly
  // via the notify route, which stamps this. See the backfill migration below.
  await pool.query(`
    ALTER TABLE events   ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ DEFAULT NULL;
    ALTER TABLE artworks ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ DEFAULT NULL;
  `);

  // NULL = RSVP predates this column; the exact time is unrecoverable, so the
  // admin UI shows "—" rather than a fabricated timestamp. Existing rows stay
  // NULL (added with no default, so no rewrite backfills a fake "now"); the
  // default is set afterward so new RSVPs record accurately going forward.
  await pool.query(`
    ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
    ALTER TABLE event_rsvps ALTER COLUMN created_at SET DEFAULT NOW();
  `);

  // Add sequence column + back-fill by insertion order per domain.
  // The WHERE sequence = 0 guard makes the UPDATE idempotent too.
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
    ALTER TABLE student_sessions
    ADD COLUMN IF NOT EXISTS name TEXT DEFAULT NULL
  `);

  await pool.query(`
    ALTER TABLE student_sessions
    ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL
  `);

  // NULL = welcome email not yet sent. Existing rows default to NULL so students
  // who registered before email delivery worked still get one on next login.
  await pool.query(`
    ALTER TABLE student_sessions
    ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ DEFAULT NULL
  `);

  // One-time email verification codes for student login (OTP).
  // code_hash is a bcrypt hash; the plaintext code is never stored.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_otps (
      roll_number TEXT NOT NULL,
      email       TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      name        TEXT,
      expires_at  TIMESTAMPTZ NOT NULL,
      attempts    INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (roll_number)
    )
  `);

  // Pending email-change codes. Separate from login OTPs so the two flows can't
  // collide. The code is sent to new_email; student_sessions.email is only
  // updated once this code is verified.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_email_change_otps (
      roll_number TEXT NOT NULL,
      new_email   TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      attempts    INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (roll_number)
    )
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

  // One-time cleanup of pre-registration-form sessions (missing email/name).
  // Guarded by schema_migrations so it runs at most once and only removes the
  // incomplete rows — it can no longer wipe the whole table on every boot.
  const clearMigration = 'clear_pre_email_sessions_v1';
  const alreadyCleared = await pool.query(
    'SELECT 1 FROM schema_migrations WHERE key = $1', [clearMigration]
  );
  if (alreadyCleared.rows.length === 0) {
    await pool.query(`DELETE FROM student_sessions WHERE email IS NULL OR name IS NULL`);
    await pool.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT DO NOTHING',
      [clearMigration]
    );
    console.log('Migration applied: cleared pre-email student_sessions');
  }

  // One-time backfill: events/artworks created under the old auto-send behavior
  // already went out to students, so mark them as notified (using their creation
  // time) rather than leaving them misleadingly "Not sent". Guarded so it runs
  // once — it must NOT touch records created after this deploy, which legitimately
  // start life un-notified.
  const backfillNotified = 'backfill_notified_at_v1';
  const alreadyBackfilled = await pool.query(
    'SELECT 1 FROM schema_migrations WHERE key = $1', [backfillNotified]
  );
  if (alreadyBackfilled.rows.length === 0) {
    await pool.query(`UPDATE events   SET notified_at = created_at WHERE notified_at IS NULL`);
    await pool.query(`UPDATE artworks SET notified_at = created_at WHERE notified_at IS NULL`);
    await pool.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT DO NOTHING',
      [backfillNotified]
    );
    console.log('Migration applied: backfilled notified_at for pre-existing events/artworks');
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

    // Full standalone HTML document — sent as-is by sendWelcomeEmail (it does NOT
    // apply the getBaseTemplate shell). All styles are inlined so email clients
    // that strip <style> blocks still render the design.
    const welcomeBody = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to DnA Club</title>
</head>
<body style="margin:0; padding:0; background-color:#222; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#222; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:40px 20px;">

      <div style="background-color:#dced3e; padding:20px 20px 40px 20px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.6); max-width:450px; width:100%; margin:0 auto; text-align:left;">
        <div style="background-color:#f4f4f0; padding:45px 35px; box-shadow:2px 2px 10px rgba(0,0,0,0.1); position:relative; background-image:radial-gradient(#aaa 1px, transparent 1px); background-size:20px 20px; background-position:0 0;">
          <div style="font-family:monospace; font-size:16px; border-bottom:1.5px solid #222; display:inline-block; margin-bottom:35px; color:#222; text-transform:lowercase;">iit_kanpur</div>

          <h1 style="font-size:45px; font-weight:800; color:#111; line-height:1.05; margin:0 0 25px 0; letter-spacing:-1.5px;">Welcome to<br>DnA Club,<br>{{name}}.</h1>

          <p style="font-size:16px; line-height:1.6; color:#333; margin:0 0 18px 0; font-weight:500;">
            You are now part of the Design and Animation Club family.
          </p>

          <p style="font-size:16px; line-height:1.6; color:#333; margin:0 0 18px 0; font-weight:500;">
            We are a community of designers, animators, and creative thinkers. Explore our gallery, attend our events, and be part of the creative journey at IITK.
          </p>

          <p style="font-size:16px; line-height:1.6; color:#333; margin:0; font-weight:500;">
            <span style="background-color:#e0f55b; display:inline-block; padding:2px 6px; font-weight:700; color:#111; border-radius:2px;">Stay tuned</span> for updates on workshops, exhibitions, and events. We are glad to have you with us.
          </p>

          <a href="https://www.dnaiitk.site" style="display:inline-block; background-color:#e64298; color:#ffffff; padding:12px 24px; text-decoration:none; font-weight:bold; border-radius:25px; margin-top:15px;">Visit Website</a>
        </div>

        <div style="margin-top:25px; font-size:35px; font-weight:800; color:#111; text-align:center; letter-spacing:-1px;">Get creative.</div>
        <div style="text-align:center; color:#000; font-size:12px; margin-top:25px; font-weight:500; letter-spacing:0.5px; opacity:0.8;">designed by venugopal</div>
      </div>

    </td>
  </tr>
</table>

</body>
</html>`;

    // Full standalone HTML document (bypasses getBaseTemplate — see
    // STANDALONE_TEMPLATE_IDS). CSS inlined for email-client safety.
    const artworkBody = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>New Artwork — DnA Club</title>
</head>
<body style="margin:0; padding:0; background-color:#222; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#222; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:40px 20px;">

      <div style="background-color:#dced3e; padding:20px 20px 40px 20px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.6); max-width:450px; width:100%; margin:0 auto; text-align:left;">
        <div style="background-color:#f4f4f0; padding:45px 35px; box-shadow:2px 2px 10px rgba(0,0,0,0.1); position:relative; background-image:radial-gradient(#aaa 1px, transparent 1px); background-size:20px 20px; background-position:0 0;">
          <div style="font-family:monospace; font-size:16px; border-bottom:1.5px solid #222; display:inline-block; margin-bottom:35px; color:#222; text-transform:lowercase;">gallery_update</div>

          <h1 style="font-size:45px; font-weight:800; color:#111; line-height:1.05; margin:0 0 25px 0; letter-spacing:-1.5px;">New Artwork:<br>{{title}}</h1>

          <p style="font-size:16px; line-height:1.6; color:#333; margin:0 0 25px 0; font-weight:500;">
            <strong>by {{artist}}</strong> &nbsp;|&nbsp; <span style="background-color:#e0f55b; display:inline-block; padding:2px 6px; font-weight:700; color:#111; border-radius:2px;">{{domain}}</span>
          </p>

          <p style="font-size:16px; line-height:1.6; color:#333; margin:0; font-weight:500;">
            A new artwork has been added to the DnA Club gallery. Visit the website to explore the latest creative work from our members.
          </p>

          <a href="https://www.dnaiitk.site" style="display:inline-block; background-color:#e64298; color:#ffffff; padding:12px 24px; text-decoration:none; font-weight:bold; border-radius:25px; margin-top:15px;">Visit Website</a>
        </div>

        <div style="margin-top:25px; font-size:35px; font-weight:800; color:#111; text-align:center; letter-spacing:-1px;">Get creative.</div>
        <div style="text-align:center; color:#888; font-size:14px; margin-top:25px; font-weight:500; letter-spacing:0.5px;">designed by venugopal</div>
      </div>

    </td>
  </tr>
</table>

</body>
</html>`;

    const eventBody = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>New Event — DnA Club</title>
</head>
<body style="margin:0; padding:0; background-color:#222; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#222; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:40px 20px;">

      <div style="background-color:#dced3e; padding:20px 20px 40px 20px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.6); max-width:450px; width:100%; margin:0 auto; text-align:left;">
        <div style="background-color:#f4f4f0; padding:45px 35px; box-shadow:2px 2px 10px rgba(0,0,0,0.1); position:relative; background-image:radial-gradient(#aaa 1px, transparent 1px); background-size:20px 20px; background-position:0 0;">
          <div style="font-family:monospace; font-size:16px; border-bottom:1.5px solid #222; display:inline-block; margin-bottom:35px; color:#222; text-transform:lowercase;">event_update</div>

          <h1 style="font-size:45px; font-weight:800; color:#111; line-height:1.05; margin:0 0 25px 0; letter-spacing:-1.5px;">New Event:<br>{{title}}</h1>

          <p style="font-size:16px; line-height:1.6; color:#333; margin:0 0 25px 0; font-weight:500;">
            <strong>Date: {{date}}</strong> &nbsp;|&nbsp; <span style="background-color:#e0f55b; display:inline-block; padding:2px 6px; font-weight:700; color:#111; border-radius:2px;">Venue: {{venue}}</span>
          </p>

          <p style="font-size:16px; line-height:1.6; color:#333; margin:0; font-weight:500;">
            {{description}}
          </p>

          <a href="https://www.dnaiitk.site" style="display:inline-block; background-color:#e64298; color:#ffffff; padding:12px 24px; text-decoration:none; font-weight:bold; border-radius:25px; margin-top:15px;">Visit Website</a>
        </div>

        <div style="margin-top:25px; font-size:35px; font-weight:800; color:#111; text-align:center; letter-spacing:-1px;">Get creative.</div>
        <div style="text-align:center; color:#888; font-size:14px; margin-top:25px; font-weight:500; letter-spacing:0.5px;">designed by venugopal</div>
      </div>

    </td>
  </tr>
</table>

</body>
</html>`;

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audience_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audience_group_members (
      group_id    TEXT NOT NULL REFERENCES audience_groups(id)
                  ON DELETE CASCADE,
      roll_number TEXT NOT NULL,
      name        TEXT,
      added_at    TEXT NOT NULL,
      PRIMARY KEY (group_id, roll_number)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_sessions (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      host              TEXT NOT NULL,
      meet_link         TEXT NOT NULL,
      scheduled_at      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'upcoming',
      audience_group_id TEXT REFERENCES audience_groups(id)
                        ON DELETE SET NULL,
      description       TEXT,
      created_at        TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS session_joins (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES live_sessions(id)
                  ON DELETE CASCADE,
      roll_number TEXT NOT NULL,
      name        TEXT,
      joined_at   TEXT NOT NULL,
      UNIQUE(session_id, roll_number)
    )
  `);

  const groupCount = await pool.query(
    'SELECT COUNT(*) FROM audience_groups'
  );

  if (parseInt((groupCount.rows[0] as { count: string }).count) === 0) {
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO audience_groups (id, name, description, created_at)
      VALUES
      ('all_students', 'All Students', 'All registered students', $1),
      ('all_team', 'All Team', 'All DnA Club team members', $1)
    `, [now]);

    const teamMembers = [
      { roll: '250004', name: 'Aadi Kumar Jain' },
      { roll: '250080', name: 'Ajitesh Srivastavi' },
      { roll: '250098', name: 'Akshay Biju B N' },
      { roll: '250106', name: 'Aman' },
      { roll: '250135', name: 'Anindita Padhi' },
      { roll: '250147', name: 'Ankit Kumar Beh' },
      { roll: '250152', name: 'Anku Kumar' },
      { roll: '250174', name: 'Anushka' },
      { roll: '250667', name: 'Arsh Khan' },
      { roll: '250232', name: 'Atharv Narache' },
      { roll: '250258', name: 'Ayush Upadhyay' },
      { roll: '250299', name: 'Charmi Jain' },
      { roll: '250316', name: 'Deeksha Badhan' },
      { roll: '250317', name: 'Deeksha Jalan' },
      { roll: '250318', name: 'Deep Shekhar' },
      { roll: '250341', name: 'Dhanavade Sayal' },
      { roll: '250422', name: 'Harsh Singh' },
      { roll: '250423', name: 'Harshvardhan Mi' },
      { roll: '250440', name: 'Hemant Kumar M' },
      { roll: '250467', name: 'J Aryan' },
      { roll: '250472', name: 'Jahnavi Srikoti' },
      { roll: '250517', name: 'Kashish Varshne' },
      { roll: '250532', name: 'Keyuri Gangwar' },
      { roll: '250618', name: 'Krishiv Mahadeva' },
      { roll: '250580', name: 'Kumkum Sonawa' },
      { roll: '250648', name: 'Mayur Kumar Gal' },
      { roll: '250695', name: 'Naman Bansal' },
      { roll: '250713', name: 'Nikhat Parveen' },
      { roll: '250825', name: 'Pratham Sharma' },
      { roll: '250854', name: 'Pulkit Agarwal' },
      { roll: '250979', name: 'Sanidhya Tripath' },
      { roll: '250391', name: 'Shwethan' },
      { roll: '251055', name: 'Siddharth Muzalo' },
      { roll: '251097', name: 'Sunil Prajapati' },
      { roll: '251099', name: 'Surendar' },
      { roll: '251151', name: 'Utkarsh Shandily' },
      { roll: '250261', name: 'Vineel Reddy' },
      { roll: '251202', name: 'Yash Yadav' },
      { roll: '251222', name: 'Yuvasankar V.S' },
      { roll: '240007', name: 'Aaditya Kini' },
      { roll: '240039', name: 'Abhishek' },
      { roll: '240511', name: 'Kanak' },
      { roll: '240280', name: 'Boddupally Uthai' },
      { roll: '231140', name: 'Venu' },
      { roll: '230265', name: 'Ayush Rai' },
    ];

    for (const m of teamMembers) {
      await pool.query(`
        INSERT INTO audience_group_members
          (group_id, roll_number, name, added_at)
        VALUES ('all_team', $1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [m.roll, m.name, now]);
    }

    console.log('Audience groups seeded with 45 team members');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS boards (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT,
      owner_roll   TEXT NOT NULL,
      owner_name   TEXT,
      visibility   TEXT NOT NULL DEFAULT 'private',
      created_at   TEXT NOT NULL
    )
  `);

  await pool.query(`
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS room_id TEXT
  `);

  console.log('boards.room_id migration done');

  await pool.query(`
    UPDATE boards
    SET room_id = gen_random_uuid()::text
    WHERE room_id IS NULL
  `);

  console.log('Backfilled room_id for existing boards');

  await pool.query(`
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS edit_mode
    TEXT NOT NULL DEFAULT 'members_only'
  `);

  console.log('boards.edit_mode migration done');

  await pool.query(`
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS canvas_data TEXT DEFAULT NULL
  `);

  console.log('boards.canvas_data migration done');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_members (
      board_id    TEXT NOT NULL REFERENCES boards(id)
                  ON DELETE CASCADE,
      roll_number TEXT NOT NULL,
      name        TEXT,
      added_at    TEXT NOT NULL,
      PRIMARY KEY (board_id, roll_number)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_items (
      id            TEXT PRIMARY KEY,
      board_id      TEXT NOT NULL REFERENCES boards(id)
                    ON DELETE CASCADE,
      image_url     TEXT NOT NULL,
      note          TEXT,
      source_url    TEXT,
      added_by_roll TEXT NOT NULL,
      added_by_name TEXT,
      created_at    TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);

  const settingsCount = await pool.query('SELECT COUNT(*) FROM app_settings');
  if (parseInt((settingsCount.rows[0] as { count: string }).count) === 0) {
    const now = new Date().toISOString();
    // Feature ships DISABLED with NO default passcode. It stays unusable until an
    // admin explicitly sets one (via /settings) or PUBLIC_MEET_PASSCODE is provided.
    await pool.query(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('public_meet_enabled', 'false', $1)
    `, [now]);
    if (process.env.PUBLIC_MEET_PASSCODE) {
      await pool.query(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('public_meet_passcode', $2, $1)
      `, [now, process.env.PUBLIC_MEET_PASSCODE]);
    }
    console.log('App settings seeded');
  }

  await pool.query(`
    UPDATE team_members
    SET designation = TRIM(designation)
    WHERE designation != TRIM(designation)
  `);
  console.log('Fixed trailing spaces in designations');

  await pool.query(`
    INSERT INTO audience_groups
      (id, name, description, created_at)
    VALUES
      (
        'coordinators',
        'Coordinators',
        'DnA Club coordinators approved for meet scheduling',
        $1
      )
    ON CONFLICT (id) DO NOTHING
  `, [new Date().toISOString()]);

  console.log('Coordinators group ready');

  await pool.query(`
    ALTER TABLE audience_group_members
    ADD COLUMN IF NOT EXISTS approved
    BOOLEAN NOT NULL DEFAULT false
  `);

  console.log('audience_group_members.approved migration done');

  const coordinatorMembers = [
    { roll: '240007', name: 'Aaditya Kini'    },
    { roll: '240039', name: 'Abhishek'         },
    { roll: '240511', name: 'Kanak'            },
    { roll: '240280', name: 'Boddupally Uthai' },
    { roll: '231140', name: 'Venu'             },
    { roll: '230265', name: 'Ayush Rai'        },
  ];

  for (const m of coordinatorMembers) {
    await pool.query(`
      INSERT INTO audience_group_members
        (group_id, roll_number, name,
         added_at, approved)
      VALUES ('coordinators', $1, $2, $3, false)
      ON CONFLICT (group_id, roll_number)
      DO NOTHING
    `, [m.roll, m.name, new Date().toISOString()]);
  }

  console.log('6 coordinators seeded');
}

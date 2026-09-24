import { pool } from './client';
import { canvasSummaryColumns } from '../lib/canvasSummary';
import { MARK_PLACED_BOARD_ITEMS_SQL } from '../lib/boardRows';
import { checkSchemaInitAllowed } from './dbTarget';

export async function initSchema(): Promise<void> {
  // Refuse to run DDL/backfills against a database this process shouldn't
  // be migrating (e.g. a dev server whose .env points at the hosted DB) —
  // see db/dbTarget.ts for the exact rules and the explicit override.
  const check = checkSchemaInitAllowed(process.env);
  console.log(`Schema initialization target: ${check.target ? `${check.target.host} / ${check.target.database}` : '(none)'} — env ${process.env.NODE_ENV || 'development'} — ${check.allowed ? 'allowed' : 'REFUSED'} (${check.reason})`);
  if (!check.allowed) {
    throw new Error(check.reason);
  }
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

  // Audit trail only — NOT re-checked per-request. TRUE means the student's most
  // recent login used the temporary OTP-bypass path (no email ownership proven),
  // set by /auth/student/bypass-login and cleared back to FALSE by a real
  // verify-otp success. See studentAuth.ts's short-lived bypass token: the actual
  // "not trusted forever" guarantee comes from that token's 1-day expiry, not
  // from this column being checked at request time.
  await pool.query(`
    ALTER TABLE student_sessions
    ADD COLUMN IF NOT EXISTS otp_bypass BOOLEAN NOT NULL DEFAULT false
  `);

  // NULL = never logged in since this column existed (only registered_at is
  // known for such rows). Set on every successful verify-otp, not just the
  // first — this is what "active" is computed from in the admin overview.
  await pool.query(`
    ALTER TABLE student_sessions
    ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ DEFAULT NULL
  `);

  // Append-only login history — one row per successful verify-otp, never
  // overwritten (unlike student_sessions.last_login, which only tracks the
  // most recent login). Powers the admin overview's day-wise activity chart.
  // No FK to student_sessions, matching session_joins' precedent: an event
  // log shouldn't be coupled to the entity table's lifecycle. Indexed on
  // logged_in_at since every query against this table groups/filters by
  // date — the one event-log table here whose access pattern isn't by FK.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_events (
      id           TEXT        PRIMARY KEY,
      roll_number  TEXT        NOT NULL,
      logged_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_login_events_logged_in_at ON login_events(logged_in_at);
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
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false
  `);

  await pool.query(`
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS updated_at TEXT
  `);

  await pool.query(`
    UPDATE boards
    SET updated_at = created_at
    WHERE updated_at IS NULL
  `);

  await pool.query(`
    ALTER TABLE boards
    ALTER COLUMN updated_at SET NOT NULL
  `);

  // Not read/written anywhere yet — reserved so the thumbnails phase doesn't
  // need another migration. See board list/detail responses: this always
  // comes back null today, and clients already treat a missing thumbnail as
  // "show the placeholder".
  await pool.query(`
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS thumbnail_url TEXT DEFAULT NULL
  `);

  console.log('boards.is_archived / updated_at / thumbnail_url migration done');

  // Per-board opt-in for the realtime collaboration rollout (see realtime/).
  // Defaults false for both existing and newly created boards — a board only
  // gets the @tldraw/sync path if explicitly flipped, independent of the
  // REALTIME_ENABLED global kill switch (both must be true for a given
  // board to use realtime). Rollback never needs a migration: unset the env
  // var, or flip this back to false, and the board falls back to the
  // existing manual save/load path unchanged.
  await pool.query(`
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS realtime_enabled BOOLEAN NOT NULL DEFAULT false
  `);

  console.log('boards.realtime_enabled migration done');

  // Realtime graduates from opt-in pilot to the V1 default (production bug
  // report: two users on the same board never saw each other's edits
  // without a refresh — traced to REALTIME_ENABLED being unset AND every
  // board's realtime_enabled defaulting to false with NO route or UI ever
  // existing to flip it per-board, so no board could ever reach the
  // @tldraw/sync path regardless of the global switch). Changes the
  // column's default to true for boards created from now on, and
  // one-time-backfills every existing board to true — guarded by
  // schema_migrations so this UPDATE runs at most once, same pattern as
  // clear_pre_email_sessions_v1 above (an UPDATE that's safe to define
  // declaratively but NOT safe to blindly re-run every boot, since a user
  // could deliberately flip a specific board back to false later and this
  // must never overwrite that choice on the next deploy).
  await pool.query(`
    ALTER TABLE boards
    ALTER COLUMN realtime_enabled SET DEFAULT true
  `);

  const realtimeBackfillMigration = 'backfill_realtime_enabled_v1';
  const realtimeAlreadyBackfilled = await pool.query(
    'SELECT 1 FROM schema_migrations WHERE key = $1', [realtimeBackfillMigration]
  );
  if (realtimeAlreadyBackfilled.rows.length === 0) {
    await pool.query(`UPDATE boards SET realtime_enabled = true WHERE realtime_enabled = false`);
    await pool.query(
      'INSERT INTO schema_migrations (key) VALUES ($1) ON CONFLICT DO NOTHING',
      [realtimeBackfillMigration]
    );
    console.log('Migration applied: backfilled realtime_enabled to true for all existing boards');
  }

  // Per-user, not per-board: two students can independently star the same
  // shared board, so this can't be a column on boards.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_favorites (
      board_id    TEXT NOT NULL REFERENCES boards(id)
                  ON DELETE CASCADE,
      roll_number TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (board_id, roll_number)
    )
  `);

  console.log('board_favorites migration done');

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

  // Temporary Resend-quota-incident bypass flag, default OFF. Seeded
  // unconditionally (unlike the block above, which only runs once on first
  // boot) via ON CONFLICT DO NOTHING so it's added for existing deployments too.
  // Admin-toggleable via the Settings tab (PUT /api/settings) — no redeploy needed.
  await pool.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('student_otp_bypass_enabled', 'false', NOW()::text)
    ON CONFLICT (key) DO NOTHING
  `);

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

  // Resend free tier caps at 100 emails/day and 3,000/month, and every
  // To/CC/BCC recipient counts separately toward that quota — so a single
  // broadcast to the whole roster can consume most of a day's budget. This
  // table tracks how much has been sent on each UTC day so broadcast sends can
  // be gated to protect headroom for OTP/welcome mail (which must never be
  // blocked). One row per day; `sent_count` increments as mail actually goes out.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_usage (
      day        DATE PRIMARY KEY,
      sent_count INT  NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_campaigns (
      id                    TEXT PRIMARY KEY,
      event_id              TEXT REFERENCES events(id) ON DELETE SET NULL,
      artwork_id            TEXT REFERENCES artworks(id) ON DELETE SET NULL,
      title                 TEXT NOT NULL,
      subject               TEXT NOT NULL,
      audience_type         TEXT NOT NULL DEFAULT 'all',
      target_batch          TEXT,
      requested_limit       INT NOT NULL DEFAULT 50,
      excluded_campaign_ids TEXT[] DEFAULT '{}',
      excluded_event_ids    TEXT[] DEFAULT '{}',
      total_eligible        INT NOT NULL DEFAULT 0,
      sent_count            INT NOT NULL DEFAULT 0,
      queued_count          INT NOT NULL DEFAULT 0,
      status                TEXT NOT NULL DEFAULT 'draft',
      created_by_admin      TEXT NOT NULL DEFAULT 'admin',
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_recipients (
      id                  BIGSERIAL PRIMARY KEY,
      campaign_id         TEXT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
      event_id            TEXT REFERENCES events(id) ON DELETE SET NULL,
      roll_number         TEXT NOT NULL REFERENCES student_sessions(roll_number) ON DELETE CASCADE,
      email               TEXT NOT NULL,
      activity_score      INT NOT NULL DEFAULT 0,
      score_breakdown     JSONB,
      status              TEXT NOT NULL DEFAULT 'pending',
      provider_message_id TEXT,
      error_message       TEXT,
      queued_at           TIMESTAMPTZ,
      sent_at             TIMESTAMPTZ,
      delivered_at        TIMESTAMPTZ,
      failed_at           TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_email_recipients_event_roll ON email_recipients(event_id, roll_number, status);
    CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign ON email_recipients(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_email_recipients_roll ON email_recipients(roll_number);
    CREATE INDEX IF NOT EXISTS idx_student_sessions_batch ON student_sessions((SUBSTRING(roll_number FROM 1 FOR 2)));
    CREATE INDEX IF NOT EXISTS idx_student_sessions_last_login ON student_sessions(last_login DESC NULLS LAST);

    ALTER TABLE student_watched_videos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE student_completed_quizzes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
  `);

  // Broadcast sends (event/artwork notify, announcements, event reminders)
  // that can't fully fit in today's quota-gated budget are queued here instead
  // of failing. `remaining` shrinks as recipients are drained on each tick;
  // the row is done once it's empty. `kind` is informational (for admin
  // visibility / debugging), not used for dispatch logic.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_queue (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      subject      TEXT NOT NULL,
      html         TEXT NOT NULL,
      remaining    TEXT[] NOT NULL,
      total_count  INT  NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);

  // Machine-readable event start instant, alongside the existing free-text
  // `time` display label (kept as-is for the UI). NULL for events created
  // before this column existed, or where the admin hasn't set it yet — the
  // reminder job simply skips events with no starts_at rather than guessing.
  await pool.query(`
    ALTER TABLE events ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ DEFAULT NULL;
  `);

  // Per-RSVP dedup marker for the ~1-hour-before reminder job. NULL = not yet
  // reminded. Per-RSVP (not per-event) so a student who RSVPs after the first
  // reminder batch still gets their own reminder.
  await pool.query(`
    ALTER TABLE event_rsvps ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ DEFAULT NULL;
  `);

  // event_reminder is a 4th admin-editable template (same TemplateEditor
  // pattern as welcome/new_artwork/new_event), seeded idempotently so it
  // appears even on a DB where email_templates was already populated before
  // this feature existed.
  const reminderBody = `
    <h1 style="font-size:32px; font-weight:800; color:#111; line-height:1.1; margin:0 0 20px 0; letter-spacing:-1px;">Starting soon:<br>{{title}}</h1>
    <p style="font-size:16px; line-height:1.6; color:#333; margin:0 0 18px 0; font-weight:500;">
      Hi {{name}}, this is a reminder that <strong>{{title}}</strong> starts in about an hour.
    </p>
    <p style="font-size:16px; line-height:1.6; color:#333; margin:0 0 18px 0; font-weight:500;">
      <strong>Date:</strong> {{date}} &nbsp;|&nbsp; <strong>Time:</strong> {{time}}
    </p>
    <p style="font-size:16px; line-height:1.6; color:#333; margin:0; font-weight:500;">
      <span style="background-color:#e0f55b; display:inline-block; padding:2px 6px; font-weight:700; color:#111; border-radius:2px;">Venue: {{venue}}</span>
    </p>
  `;
  await pool.query(`
    INSERT INTO email_templates (id, name, subject, body, updated_at)
    VALUES ('event_reminder', 'Event Reminder', 'Reminder: {{title}} starts soon — DnA Club IITK', $1, $2)
    ON CONFLICT (id) DO NOTHING
  `, [reminderBody, new Date().toISOString()]);

  // Version history (Commit 5) — deliberately a separate table, not an
  // extension of boards.canvas_data. canvas_data holds exactly one thing
  // (the room's current live/persisted state); board_versions holds a
  // timeline of past states, unbounded in count, each a full standalone
  // snapshot. Mixing the two would mean every version read/write touches
  // the same row every live client's autosave also writes to, and would
  // cap "how much history" at "however big one TEXT column comfortably
  // gets" — see realtime/history/ for the service layer that owns writing
  // to this table; RoomManager and roomPersistence.ts never reference it.
  //
  // metadata is a JSON TEXT column reserved for future extensibility (e.g.
  // shape/document counts computed at checkpoint time, so a future compare/
  // diff view wouldn't need to re-parse every snapshot to show a summary) —
  // unused by this commit, present so a later feature doesn't need another
  // migration for it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_versions (
      id                      TEXT PRIMARY KEY,
      board_id                TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      snapshot                TEXT NOT NULL,
      created_by_roll         TEXT,
      created_by_name         TEXT,
      created_at              TEXT NOT NULL,
      trigger                 TEXT NOT NULL,
      description             TEXT,
      restored_from_version_id TEXT REFERENCES board_versions(id) ON DELETE SET NULL,
      metadata                TEXT
    )
  `);

  // Every timeline/pagination read in VersionTimeline filters by board_id
  // and orders by created_at — without this index that's a sequential scan
  // per board on every "open version history" click, which gets worse as
  // history accumulates for exactly the boards most likely to be inspected.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS board_versions_board_id_created_at_idx
    ON board_versions (board_id, created_at DESC)
  `);

  console.log('board_versions migration done');

  // Comments (Commit 6) — one table for both thread roots and replies:
  // parent_comment_id NULL means "this is a thread root", non-NULL means
  // "this is a reply to that root". A single table (not comments +
  // comment_replies) keeps read/list/broadcast logic uniform — every
  // comment event (create/edit/delete/resolve/reopen) is the same shape
  // regardless of depth, and a reply never needs its own resolve state
  // (resolving is a thread-level operation, applied to the root only; see
  // routes/comments.ts).
  //
  // anchor_type distinguishes a pin dropped on open canvas ('canvas', using
  // anchor_x/anchor_y in page-space coordinates — tldraw's own coordinate
  // system, so a pin stays correctly placed regardless of zoom) from a pin
  // attached to a specific shape ('shape', using anchor_shape_id — a
  // tldraw TLShapeId string, intentionally NOT a foreign key: shapes live
  // in the tldraw document/snapshot, not in Postgres relational tables, so
  // there is nothing here to reference; a comment on a since-deleted shape
  // is handled client-side by falling back to its last-known anchor_x/
  // anchor_y, which are always populated for both anchor types).
  //
  // Deliberately NOT stored in boards.canvas_data or as tldraw shape
  // records: comments are product/collaboration metadata, not document
  // content — they must never appear in a version-history snapshot/restore
  // (see history/versionHistoryService.ts) and must never be selectable/
  // draggable/deletable via tldraw's own shape tools. Keeping them in their
  // own table, read over their own REST/WS channel, is what makes "comment
  // actions never create board versions" true by construction rather than
  // something routes/comments.ts has to remember to avoid.
  //
  // mentions is a JSON TEXT column (array of roll numbers), unused by this
  // commit (notifications/mentions are explicitly out of scope) — reserved
  // so a future mentions feature doesn't need another migration.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_comments (
      id                TEXT PRIMARY KEY,
      board_id          TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      parent_comment_id TEXT REFERENCES board_comments(id) ON DELETE CASCADE,
      author_roll       TEXT NOT NULL,
      author_name       TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      resolved_at       TEXT,
      resolved_by_roll  TEXT,
      deleted_at        TEXT,
      anchor_type       TEXT NOT NULL,
      anchor_shape_id   TEXT,
      anchor_x          DOUBLE PRECISION NOT NULL,
      anchor_y          DOUBLE PRECISION NOT NULL,
      content           TEXT NOT NULL,
      mentions          TEXT
    )
  `);

  // Every list read filters by board_id (and, for the default view, checks
  // deleted_at/resolved_at) ordered by created_at — same rationale as
  // board_versions' own index above.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS board_comments_board_id_created_at_idx
    ON board_comments (board_id, created_at)
  `);

  // Thread reads (a root + all its replies) filter by parent_comment_id —
  // without this index, opening a single thread with many replies scans
  // every comment on the board.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS board_comments_parent_comment_id_idx
    ON board_comments (parent_comment_id)
  `);

  // PAGE-AWARE ANCHORS (V2.6 Phase B) — which tldraw page a comment's
  // anchor lives on.
  //
  // THE BUG THIS FIXES: nothing recorded a page, so every comment rendered
  // on every page of a multi-page board. A comment pinned on Page A showed
  // up at the same coordinates on Page B, C, ... — reproduced against the
  // real router (the create endpoint silently dropped an anchorPageId and
  // the list endpoint had no page dimension to filter on). tldraw's page
  // menu is available to users, so this is reachable in normal use.
  //
  // DELIBERATELY NULLABLE, with NO backfill. A NULL here means "legacy
  // comment, created before pages were tracked", and the renderer treats
  // those as belonging to whichever page is being viewed — i.e. exactly
  // the pre-existing behaviour, preserved. Backfilling every existing row
  // to the board's first page would be a guess (the comment may genuinely
  // have been made on another page) and would silently HIDE comments that
  // are visible today, which is strictly worse than leaving them global.
  // New comments always carry a page, so the ambiguity does not grow.
  await pool.query(`ALTER TABLE board_comments ADD COLUMN IF NOT EXISTS anchor_page_id TEXT`);

  // PERSISTENT COMMENT READ STATE (V2.6 Phase E) — one row per
  // (board, user), NOT one per comment.
  //
  // THE BUG THIS FIXES: "unread" lived only in BoardPage's
  // useState(() => Date.now()), so it reset on every mount. Refreshing the
  // page marked every thread read, and the state was per-tab rather than
  // per-user. There was no server-side read surface at all — no table, no
  // endpoint (verified: GET .../comments/read-state returned 404).
  //
  // WHY A WATERMARK, NOT A ROW PER COMMENT: a single last_seen_at per
  // (board, roll) answers the only question the UI actually asks — "has
  // this thread had activity since I last looked?" — by comparing against
  // the thread's newest updated_at. A row per comment would be orders of
  // magnitude more storage and writes for the same answer, which the phase
  // brief explicitly warned against. Per-thread granularity still works,
  // because each thread is compared against the same watermark
  // independently.
  //
  // No backfill: a missing row means "never looked", which correctly shows
  // existing activity as unread the first time a user opens a board.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_comment_reads (
      board_id     TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      roll_number  TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (board_id, roll_number)
    )
  `);

  console.log('board_comments migration done');

  // Workspaces (Commit 1 of the workspace/organization layer) — the
  // grouping unit every board now belongs to. Boards themselves stay a
  // flat table (no owner_roll/visibility/edit_mode changes here); this
  // only adds the membership layer above them. Deliberately NOT built on
  // audience_groups/audience_group_members (see those tables, further
  // above in this file) — those back event/meet scheduling only
  // (routes/liveSessions.ts, routes/coordinators.ts), zero references
  // from boards/realtime/comments/versions code, and entangling them
  // would couple two unrelated features for no benefit.
  //
  // is_personal marks the one-per-user workspace every student gets
  // automatically (lazily provisioned — see ensurePersonalWorkspace in
  // routes/workspaces.ts — or backfilled below for pre-existing boards):
  // it never appears in a "create workspace" flow, can't be renamed,
  // deleted, or left, and every route in routes/workspaces.ts that
  // mutates a workspace 400s if targeting one. This is an app-layer
  // invariant (no DB trigger enforcing it), matching how single board
  // ownership is already enforced by convention rather than a constraint
  // elsewhere in this file.
  //
  // owner_roll is a raw string, no FK — same convention as
  // boards.owner_roll (see that column's own history in this file): it
  // records who created the workspace, it is NOT the source of truth for
  // permissions after creation (workspace_members is), same relationship
  // boards.owner_roll has to board_members.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      is_personal  BOOLEAN NOT NULL DEFAULT false,
      owner_roll   TEXT NOT NULL,
      created_at   TEXT NOT NULL
    )
  `);

  // Role tiers: owner / admin / member — three, not RoomRole's four,
  // because a workspace role is only ever consulted by
  // realtime/roomAccess.ts as a CEILING that feeds into
  // classifyBoardAccess (see that function), never as a final per-board
  // role by itself. owner and admin and member all ceiling at 'editor' —
  // this table's role column is a workspace-MANAGEMENT-permission axis
  // (who can rename the workspace, add/remove members, change roles),
  // completely orthogonal to board access, which is why it doesn't need
  // to mirror RoomRole's tiering at all. Exactly one 'owner' per
  // workspace is enforced at the application layer (routes/workspaces.ts),
  // not a partial unique index — same reasoning as boards.owner_roll
  // needing no uniqueness constraint (1:1 by construction, checked in
  // code, not the DB).
  //
  // role is plain TEXT, validated by zod at the route layer — this file
  // never uses Postgres CHECK/enum types for this kind of field
  // (visibility, edit_mode follow the same pattern above); no reason to
  // introduce a new convention here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id)
                    ON DELETE CASCADE,
      roll_number   TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'member',
      name          TEXT,
      added_at      TEXT NOT NULL,
      PRIMARY KEY (workspace_id, roll_number)
    )
  `);

  console.log('workspaces / workspace_members migration done');

  // boards.workspace_id — added nullable first (existing rows have no
  // workspace yet, backfilled immediately below), same nullable ->
  // backfill -> NOT NULL rollout already used in this file for room_id
  // (above) and updated_at (above). ON DELETE RESTRICT (the default, no
  // ON DELETE clause needed beyond the bare REFERENCES) is deliberate:
  // a workspace can't be deleted while boards still point at it —
  // routes/workspaces.ts's DELETE handler pre-checks and returns a clean
  // 409 rather than ever hitting this constraint in normal operation, but
  // the constraint itself is what makes "a board can never end up
  // orphaned by a workspace delete" true even if that pre-check is ever
  // bypassed or races.
  await pool.query(`
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id)
  `);

  // Backfill: one personal workspace per distinct existing owner_roll.
  // Grouped by owner_roll ALONE, not (owner_roll, owner_name) — nothing
  // enforces owner_name is consistent across a given owner_roll's boards
  // (it's a denormalized display string, populated per-board at creation
  // time), so grouping by both could split one real owner into multiple
  // backfilled personal workspaces if their stored name ever varied.
  // WHERE workspace_id IS NULL makes this idempotent across repeated
  // boots (this file has no migration-version table — every migration
  // here is designed to be a safe no-op on a second run).
  await pool.query(`
    INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at)
    SELECT
      gen_random_uuid()::text,
      COALESCE(MIN(owner_name), owner_roll) || '''s Workspace',
      true,
      owner_roll,
      MIN(created_at)
    FROM boards
    WHERE workspace_id IS NULL
    GROUP BY owner_roll
  `);

  // Seed workspace_members with each backfilled personal workspace's
  // owner as role='owner' — without this, a pre-existing board's owner
  // would pass classifyBoardAccess via the isOwner branch (unaffected by
  // workspace role either way) but would not show up as a member of
  // their own personal workspace in routes/workspaces.ts's listing
  // endpoints.
  await pool.query(`
    INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at)
    SELECT w.id, w.owner_roll, 'owner', bn.owner_name, w.created_at
    FROM workspaces w
    LEFT JOIN LATERAL (
      SELECT owner_name FROM boards
      WHERE owner_roll = w.owner_roll AND owner_name IS NOT NULL
      LIMIT 1
    ) bn ON true
    WHERE w.is_personal
    ON CONFLICT (workspace_id, roll_number) DO NOTHING
  `);

  await pool.query(`
    UPDATE boards b
    SET workspace_id = w.id
    FROM workspaces w
    WHERE b.workspace_id IS NULL AND w.owner_roll = b.owner_roll AND w.is_personal
  `);

  await pool.query(`
    ALTER TABLE boards
    ALTER COLUMN workspace_id SET NOT NULL
  `);

  // Every scoped board list/lookup (routes/workspaces.ts, boards.ts's
  // workspace-filtered list routes, roomAccess.ts's workspace-ceiling
  // check) filters or joins on this column — without the index those
  // degrade to a sequential scan as boards grows. No separate index is
  // needed on workspace_members: its PRIMARY KEY (workspace_id,
  // roll_number) already covers the workspace-ceiling lookup's access
  // pattern (workspace_id leading).
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_boards_workspace_id
    ON boards (workspace_id)
  `);

  console.log('boards.workspace_id backfill migration done');

  // Asset Manager (Phase B) — a persistent, reusable file library, scoped
  // to a workspace, distinct from boards.ts's canvas-files upload (which
  // stores objects via the same StorageProvider but keeps no DB row of its
  // own — those are referenced only from a board's own canvas_data/tldraw
  // document JSON, never listed or reused across boards). An asset row
  // here is the thing a user can browse, preview, and re-insert onto ANY
  // board they can write to; canvas-files stays exactly as it is.
  //
  // workspace_id NOT NULL + ON DELETE CASCADE from day one (unlike
  // boards.workspace_id's nullable->backfill->NOT NULL rollout above) —
  // there is no pre-existing data to backfill here, this is a brand new
  // table, so it can start at the end state directly. Deleting a
  // workspace deletes its assets outright (no "move assets out first"
  // pre-check the way routes/workspaces.ts's DELETE has for boards,
  // since an orphaned asset with no workspace has no home in this
  // product's model — assets don't have a personal/global fallback the
  // way a board does).
  //
  // owner_roll/owner_name follow the same denormalized-pair convention as
  // boards.owner_roll/owner_name above (raw string, no FK) — owner_roll is
  // who uploaded it (delete permission), not re-derived from a join.
  //
  // storage_key is the StorageProvider path (e.g.
  // "assets/<workspace_id>/<uuid>.<ext>"), NOT a public URL — the public
  // URL is derived on read via getStorage().getPublicUrl(storage_key), so
  // switching storage providers (local disk <-> Supabase Storage) never
  // requires touching stored rows.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assets (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id)
                    ON DELETE CASCADE,
      owner_roll    TEXT NOT NULL,
      owner_name    TEXT,
      filename      TEXT NOT NULL,
      storage_key   TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL,
      width         INTEGER,
      height        INTEGER,
      created_at    TEXT NOT NULL
    )
  `);

  // Every list query filters on workspace_id (workspace-scoped library, see
  // routes/assets.ts) — without this index that degrades to a sequential
  // scan as the table grows, same reasoning as idx_boards_workspace_id above.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_assets_workspace_id
    ON assets (workspace_id)
  `);

  // Workspace Asset Library — assets are no longer image-only. kind is
  // 'image' (inline-previewable, insertable onto a board — the original
  // and still the only kind the board picker inserts), or 'file' (any
  // other design/document resource — PSD/AI/PDF/ZIP/... — stored and
  // served download-only, never parsed server-side). Additive and
  // idempotent: every pre-existing row was uploaded through the image
  // MIME allowlist, so the DEFAULT 'image' is exactly right for them with
  // no backfill. Plain TEXT validated at the route layer, same convention
  // as every other enum-shaped column in this file.
  await pool.query(`
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'image'
  `);

  // Asset collections ("asset packs") — a flat, workspace-scoped grouping
  // (Branding Pack, UI References, Mockups, ...), NOT a folder hierarchy:
  // an asset belongs to at most one collection (assets.collection_id),
  // and deleting a collection only un-groups its assets (ON DELETE SET
  // NULL), never deletes them. Workspace scoping mirrors assets exactly
  // (NOT NULL + ON DELETE CASCADE). created_by_roll follows the raw-roll,
  // no-FK convention of assets.owner_roll; it gates rename/delete the
  // same way owner_roll gates asset delete (routes/assetCollections.ts).
  // Names are unique per workspace, case-insensitively.
  //
  // That an asset's collection belongs to the SAME workspace as the asset
  // is enforced at the route layer (assets.ts's collectionInWorkspace) on
  // every write that sets collection_id.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_collections (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id)
                      ON DELETE CASCADE,
      name            TEXT NOT NULL,
      description     TEXT,
      created_by_roll TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_asset_collections_workspace_id
    ON asset_collections (workspace_id)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_collections_workspace_name
    ON asset_collections (workspace_id, lower(name))
  `);

  // Collection membership + external link assets. Additive/idempotent:
  //   collection_id — nullable; existing assets start ungrouped.
  //   link_url      — only set for kind='link' (an external http(s) URL,
  //                   stored as-is and NEVER fetched server-side).
  // A link has no stored object, so storage_key/mime_type/size_bytes
  // become nullable. DROP NOT NULL is a metadata-only change, a no-op on
  // re-run, and every existing row keeps its values.
  await pool.query(`
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS collection_id TEXT
      REFERENCES asset_collections(id) ON DELETE SET NULL
  `);
  await pool.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS link_url TEXT`);
  await pool.query(`ALTER TABLE assets ALTER COLUMN storage_key DROP NOT NULL`);
  await pool.query(`ALTER TABLE assets ALTER COLUMN mime_type DROP NOT NULL`);
  await pool.query(`ALTER TABLE assets ALTER COLUMN size_bytes DROP NOT NULL`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_assets_collection_id
    ON assets (collection_id)
  `);

  console.log('assets migration done');

  // Notifications (Phase C) — deliberately minimal: no read receipts
  // beyond a single read_at, no preferences, no digesting, no delivery
  // channels. recipient_roll is the only required identity column;
  // actor_roll/board_id/workspace_id/comment_id are all nullable because
  // no single notification type needs all four (a workspace-role-change
  // notification has no board_id or comment_id, a board-share notification
  // has no comment_id, etc.) — see routes/notifications.ts's own comment
  // on the exact type -> populated-columns mapping.
  //
  // type is plain TEXT (zod-validated at the route layer), matching every
  // other enum-shaped column in this file (boards.visibility,
  // workspace_members.role, etc.) — no new convention introduced here.
  //
  // No FK to boards/workspaces/board_comments (ON DELETE CASCADE would be
  // natural, but board_comments/boards can already be hard-deleted — see
  // boards.ts's DELETE /:id — and a notification instructively surviving
  // as "comment on a since-deleted board" is more useful than silently
  // vanishing; the frontend already has to handle a stale/missing target
  // gracefully for other reasons, e.g. a board deleted after being
  // favorited). recipient_roll/actor_roll follow the same raw-string,
  // no-FK convention boards.owner_roll already uses throughout this file.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id             TEXT PRIMARY KEY,
      recipient_roll TEXT NOT NULL,
      actor_roll     TEXT,
      actor_name     TEXT,
      type           TEXT NOT NULL,
      board_id       TEXT,
      board_name     TEXT,
      workspace_id   TEXT,
      workspace_name TEXT,
      comment_id     TEXT,
      read_at        TEXT,
      created_at     TEXT NOT NULL
    )
  `);

  // The notification list/unread-count read is ALWAYS scoped to one
  // recipient, ordered newest-first — this composite index covers both
  // "list mine" and "count my unread" (the latter via a read_at IS NULL
  // filter, which doesn't need its own index: recipient_roll leading is
  // what matters, Postgres can filter read_at cheaply from there).
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
    ON notifications (recipient_roll, created_at DESC)
  `);

  console.log('notifications migration done');

  // Projects (V2.2 — Workspace → Project → Moodboard organization layer).
  // A project is a pure organizational grouping ONE LEVEL BELOW a
  // workspace, ABOVE boards — it introduces no new identity/ownership
  // system: owner_roll is the same raw-string, no-FK convention
  // boards.owner_roll and workspaces.owner_roll already use throughout
  // this file (who created it, not the source of truth for permission —
  // see routes/projects.ts's own comment on why project authorization is
  // derived entirely from workspace_members, never a project-level role
  // table).
  //
  // workspace_id is NOT NULL + ON DELETE RESTRICT, matching
  // boards.workspace_id's own FK exactly (see that column's comment,
  // above in this file) — a workspace cannot be deleted while it still
  // has projects, same "no orphaned child" guarantee boards already get.
  // This is a deliberate DEVIATION from the V2 Foundation Architecture
  // Audit's draft (which proposed CASCADE here) — the V2.2 brief
  // explicitly calls for RESTRICT/explicit-protection over cascading
  // deletes, and matching boards.workspace_id's existing RESTRICT is more
  // consistent with this file's own precedent than introducing the only
  // CASCADE workspace-child relationship in the schema.
  //
  // is_archived mirrors boards.is_archived's own boolean-flag convention
  // (not a soft-delete/deleted_at column) — an archived project is a
  // normal, listable row with its boards still fully intact and
  // accessible, exactly like an archived board's canvas remains readable.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name         TEXT NOT NULL,
      description  TEXT,
      owner_roll   TEXT NOT NULL,
      owner_name   TEXT,
      created_at   TEXT NOT NULL,
      is_archived  BOOLEAN NOT NULL DEFAULT false
    )
  `);

  // Every project list/lookup (routes/projects.ts) filters on
  // workspace_id — without this index that degrades to a sequential scan
  // as the table grows, same reasoning as idx_boards_workspace_id below.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_projects_workspace_id
    ON projects (workspace_id)
  `);

  console.log('projects migration done');

  // boards.project_id — nullable from day one, no backfill (unlike
  // boards.workspace_id's nullable -> backfill -> NOT NULL rollout,
  // earlier in this file): NULL is a PERMANENT, valid state here
  // ("ungrouped, workspace-level board"), not a migration-in-progress
  // placeholder waiting to be forced NOT NULL later. Every existing V1/
  // V2.0 board stays NULL forever unless a user explicitly assigns it to
  // a project — this migration does not, and must never, backfill boards
  // into arbitrary projects (see the V2.2 brief's own explicit
  // requirement on this point).
  //
  // ON DELETE SET NULL (not RESTRICT, and NOT a cascading delete of the
  // board) — deleting a project un-groups its boards rather than
  // orphaning or destroying them. In practice routes/projects.ts's DELETE
  // handler pre-checks for attached boards and 409s before this
  // constraint would ever fire in normal operation (same
  // pre-check-then-clean-constraint pattern workspaces.ts's own DELETE
  // handler already uses for boards) — SET NULL here is defense-in-depth
  // ("a board can never be silently destroyed by a project delete") on
  // top of that route-level protection, not the primary mechanism.
  await pool.query(`
    ALTER TABLE boards
    ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
  `);

  // Every project-scoped board list (routes/projects.ts's board list,
  // and any future project_id filter on routes/boards.ts) filters on
  // this column — same reasoning as idx_boards_workspace_id.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_boards_project_id
    ON boards (project_id)
  `);

  console.log('boards.project_id migration done');

  // Templates (V2.3) — a reusable, frozen canvas snapshot a user can
  // instantiate into a new board. Deliberately workspace-scoped only, no
  // global/system-template concept: this codebase has no precedent for a
  // cross-workspace-visible content type anywhere (boards, assets, and
  // projects are all strictly workspace-scoped with zero exceptions —
  // confirmed by auditing every one of their schema/route definitions
  // before writing this table), and the V2.3 brief's own guidance is to
  // introduce a nullable/global workspace_id ONLY if a concrete existing
  // mechanism already justifies it. None does, so workspace_id here is
  // NOT NULL, same as assets.workspace_id (the most structurally similar
  // existing table — also a workspace-scoped, owner-tagged, reusable
  // content item with no member/role system of its own).
  //
  // canvas_data is a plain TEXT column holding the EXACT SAME raw JSON
  // string representation boards.canvas_data already uses — no second
  // snapshot schema. Confirmed by reading POST /:id/duplicate
  // (routes/boards.ts): it already copies a board's canvas_data into a
  // new board's canvas_data as an opaque string, no parsing, no shape
  // validation beyond what PUT /:id/canvas already requires (valid
  // JSON). Templates reuse that exact copy-as-opaque-string approach in
  // both directions (board -> template, template -> new board) — see
  // routes/templates.ts. Whatever shape a given board's canvas_data
  // happens to be in (legacy TLEditorSnapshot wrapper vs. flat
  // RoomSnapshot — see roomPersistence.ts's own extensive comment on why
  // both exist) is preserved as-is; the existing load-time unwrap logic
  // in roomPersistence.ts already handles both when a template-created
  // board is later opened, so nothing new needs to understand either
  // shape here.
  //
  // source_board_id is PROVENANCE ONLY (which board this template was
  // originally saved from) — never a live dependency. ON DELETE SET NULL
  // (not RESTRICT, not CASCADE): a template must survive its source
  // board being deleted, exactly the same reasoning
  // board_versions.restored_from_version_id already established for the
  // same kind of "this points at where it came from, not something it
  // depends on" relationship.
  //
  // owner_roll/owner_name follow the same denormalized-pair, no-FK
  // convention every other owner-tagged table in this file uses
  // (boards.owner_roll, workspaces.owner_roll, projects.owner_roll,
  // assets.owner_roll).
  //
  // No template_members/template_roles/template_permissions table — per
  // the V2.3 brief, template authorization is entirely derived from
  // workspace_members (see routes/templates.ts), identical to how
  // routes/projects.ts already has no project-level role system.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
      source_board_id TEXT REFERENCES boards(id) ON DELETE SET NULL,
      name            TEXT NOT NULL,
      description     TEXT,
      canvas_data     TEXT,
      thumbnail_url   TEXT,
      owner_roll      TEXT NOT NULL,
      owner_name      TEXT,
      created_at      TEXT NOT NULL,
      is_archived     BOOLEAN NOT NULL DEFAULT false
    )
  `);

  // Every template list/lookup (routes/templates.ts) filters on
  // workspace_id — same reasoning as idx_projects_workspace_id/
  // idx_assets_workspace_id above.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_templates_workspace_id
    ON templates (workspace_id)
  `);

  console.log('templates migration done');

  // Moodboard card item count + preview (lib/canvasSummary.ts). Derived
  // from canvas_data at WRITE time — every path that sets canvas_data
  // (realtime save, manual PUT /:id/canvas, duplicate, board-from-
  // template) also sets these — so board list endpoints never have to
  // ship or parse whole tldraw documents to render a card. Additive:
  //   canvas_item_count      — visible shapes (NULL = not yet summarized)
  //   canvas_preview         — small JSON preview primitives, or NULL
  //   canvas_placed_item_ids — shape ids of legacy board_items already
  //                            placed on the canvas (see canvasSummary.ts)
  await pool.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS canvas_item_count INTEGER`);
  await pool.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS canvas_preview TEXT`);
  await pool.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS canvas_placed_item_ids TEXT[] NOT NULL DEFAULT '{}'`);
  await backfillCanvasSummaries();

  console.log('boards canvas summary migration done');

  // Gallery item lifecycle (lib/boardRows.ts MARK_PLACED_BOARD_ITEMS_SQL):
  // placed_at NULL = never placed on the canvas, so still pending injection;
  // set once, never cleared. Additive and nullable — existing rows stay,
  // unplaced by default. Backfilled AFTER the canvas summary backfill above,
  // since it reads canvas_placed_item_ids.
  await pool.query(`ALTER TABLE board_items ADD COLUMN IF NOT EXISTS placed_at TIMESTAMPTZ`);
  await backfillBoardItemPlacement();

  console.log('board_items placement migration done');
}

// Idempotent backfill for board_items saved before placed_at existed: marks
// only rows whose shape is on the board's saved canvas right now (any page).
// A row whose shape the user already deleted can't be told apart from a
// never-placed one here, so it stays NULL — it is re-injected once, marked
// on that save, and a later delete then sticks. Never touches canvas_data,
// never deletes rows; already-marked rows are skipped.
export async function backfillBoardItemPlacement(): Promise<number> {
  const result = await pool.query(`
    WITH saved AS (SELECT id, canvas_placed_item_ids FROM boards)
    ${MARK_PLACED_BOARD_ITEMS_SQL}
  `);
  return result.rowCount ?? 0;
}

// One-time (idempotent) backfill for boards written before the summary
// columns existed: only rows whose canvas_item_count is still NULL are
// touched, a few at a time so a legacy board with multi-MB base64 images
// in canvas_data is never loaded alongside many others.
export async function backfillCanvasSummaries(): Promise<number> {
  let done = 0;
  for (;;) {
    const batch = await pool.query(
      'SELECT id, canvas_data FROM boards WHERE canvas_item_count IS NULL ORDER BY id LIMIT 10'
    );
    const rows = batch.rows as Array<{ id: string; canvas_data: string | null }>;
    if (rows.length === 0) return done;
    for (const row of rows) {
      const cols = canvasSummaryColumns(row.canvas_data);
      await pool.query(
        `UPDATE boards SET canvas_item_count = $2, canvas_preview = $3, canvas_placed_item_ids = $4 WHERE id = $1`,
        [row.id, cols.canvas_item_count, cols.canvas_preview, cols.canvas_placed_item_ids]
      );
      done++;
    }
  }
}

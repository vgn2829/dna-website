import type { Pool } from 'pg';

// Email Centre tables. Everything is prefixed `ec_` on purpose: the legacy
// email_templates / email_campaigns / email_recipients / mail_queue tables
// keep powering OTP, welcome, event/artwork notify, announcements and
// reminders untouched, and the roll-number-keyed legacy tables cannot hold
// arbitrary (non-student) addresses.
//
// Called from initSchema after its target guard, idempotent on every boot.
export async function initEmailCentreSchema(db: Pool): Promise<void> {
  await db.query(`
    -- Parent record: a draft while editing, then the immutable send record.
    -- subject_config/doc/settings are the message's OWN copy of the content
    -- (never a live reference to a template), so editing a template later can
    -- not change what a past send looked like.
    CREATE TABLE IF NOT EXISTS ec_messages (
      id               TEXT PRIMARY KEY,
      status           TEXT NOT NULL DEFAULT 'draft',
      mode             TEXT NOT NULL DEFAULT 'individual',
      title            TEXT,
      subject_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
      doc              JSONB NOT NULL DEFAULT '{}'::jsonb,
      settings         JSONB NOT NULL DEFAULT '{}'::jsonb,
      recipient_input  JSONB NOT NULL DEFAULT '{}'::jsonb,
      template_id      TEXT,
      template_version INT,
      idempotency_key  TEXT,
      content_hash     TEXT,
      revision         INT NOT NULL DEFAULT 0,
      total_recipients INT NOT NULL DEFAULT 0,
      created_by       TEXT NOT NULL DEFAULT 'admin',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      queued_at        TIMESTAMPTZ,
      completed_at     TIMESTAMPTZ,
      CONSTRAINT ec_messages_status_chk
        CHECK (status IN ('draft','queued','sending','completed','failed','cancelled')),
      CONSTRAINT ec_messages_mode_chk CHECK (mode IN ('normal','individual'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ec_messages_idem
      ON ec_messages(idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_ec_messages_status ON ec_messages(status, updated_at DESC);

    -- One Resend API call. Individual mode: one job per recipient. Normal
    -- mode: one job for the whole message. Holds the send-time rendered
    -- content so a retry resends exactly what was approved.
    CREATE TABLE IF NOT EXISTS ec_send_jobs (
      id                  BIGSERIAL PRIMARY KEY,
      message_id          TEXT NOT NULL REFERENCES ec_messages(id) ON DELETE CASCADE,
      status              TEXT NOT NULL DEFAULT 'queued',
      rendered_subject    TEXT NOT NULL,
      rendered_html       TEXT NOT NULL,
      rendered_text       TEXT,
      render_hash         TEXT NOT NULL,
      to_emails           TEXT[] NOT NULL,
      cc_emails           TEXT[] NOT NULL DEFAULT '{}',
      bcc_emails          TEXT[] NOT NULL DEFAULT '{}',
      quota_cost          INT NOT NULL DEFAULT 1,
      quota_reserved      INT NOT NULL DEFAULT 0,
      attempts            INT NOT NULL DEFAULT 0,
      send_generation     INT NOT NULL DEFAULT 0,
      provider_message_id TEXT,
      error_message       TEXT,
      error_kind          TEXT,
      next_attempt_at     TIMESTAMPTZ,
      locked_at           TIMESTAMPTZ,
      sent_at             TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ec_send_jobs_status_chk
        CHECK (status IN ('queued','sending','accepted','failed','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS idx_ec_jobs_queue ON ec_send_jobs(status, next_attempt_at, id);
    CREATE INDEX IF NOT EXISTS idx_ec_jobs_message ON ec_send_jobs(message_id, status);
    CREATE INDEX IF NOT EXISTS idx_ec_jobs_provider ON ec_send_jobs(provider_message_id)
      WHERE provider_message_id IS NOT NULL;

    -- Recipient snapshot + per-recipient delivery outcome.
    CREATE TABLE IF NOT EXISTS ec_message_recipients (
      id              BIGSERIAL PRIMARY KEY,
      message_id      TEXT NOT NULL REFERENCES ec_messages(id) ON DELETE CASCADE,
      job_id          BIGINT REFERENCES ec_send_jobs(id) ON DELETE SET NULL,
      position        INT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'to',
      email           TEXT NOT NULL,
      display_name    TEXT,
      source          TEXT NOT NULL,
      student_roll    TEXT,
      data            JSONB NOT NULL DEFAULT '{}'::jsonb,
      group_ref       JSONB,
      validation      TEXT NOT NULL DEFAULT 'valid',
      validation_note TEXT,
      status          TEXT NOT NULL DEFAULT 'queued',
      error_message   TEXT,
      delivered_at    TIMESTAMPTZ,
      failed_at       TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ec_recipients_role_chk CHECK (role IN ('to','cc','bcc')),
      CONSTRAINT ec_recipients_status_chk CHECK (status IN
        ('queued','sending','sent','delivered','bounced','suppressed','complained','failed','cancelled','excluded'))
    );
    CREATE INDEX IF NOT EXISTS idx_ec_recipients_message ON ec_message_recipients(message_id, position);
    CREATE INDEX IF NOT EXISTS idx_ec_recipients_job ON ec_message_recipients(job_id);

    -- Verified provider events (deduped on the svix delivery id).
    CREATE TABLE IF NOT EXISTS ec_delivery_events (
      id                  BIGSERIAL PRIMARY KEY,
      event_id            TEXT UNIQUE,
      provider_message_id TEXT NOT NULL,
      event_type          TEXT NOT NULL,
      payload             JSONB NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ec_events_provider ON ec_delivery_events(provider_message_id);

    -- Attachment metadata + bytes. Bytes live in Postgres (not the public
    -- storage bucket) so they have no URL at all and are only readable
    -- through admin-authenticated routes or the backend sender.
    CREATE TABLE IF NOT EXISTS ec_attachments (
      id          TEXT PRIMARY KEY,
      message_id  TEXT REFERENCES ec_messages(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      size_bytes  INT NOT NULL,
      inline      BOOLEAN NOT NULL DEFAULT false,
      content     BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ec_attachments_message ON ec_attachments(message_id);

    CREATE TABLE IF NOT EXISTS ec_templates (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT,
      category         TEXT NOT NULL DEFAULT 'custom',
      is_system        BOOLEAN NOT NULL DEFAULT false,
      archived         BOOLEAN NOT NULL DEFAULT false,
      current_version  INT NOT NULL DEFAULT 1,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Immutable snapshots: editing a template inserts a new version row.
    CREATE TABLE IF NOT EXISTS ec_template_versions (
      template_id     TEXT NOT NULL REFERENCES ec_templates(id) ON DELETE CASCADE,
      version         INT NOT NULL,
      mode            TEXT NOT NULL DEFAULT 'individual',
      subject_config  JSONB NOT NULL,
      doc             JSONB NOT NULL,
      settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (template_id, version)
    );

    CREATE TABLE IF NOT EXISTS ec_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      kind        TEXT NOT NULL DEFAULT 'static',
      filter      JSONB,
      created_by  TEXT NOT NULL DEFAULT 'admin',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ec_groups_kind_chk CHECK (kind IN ('static','dynamic'))
    );
    CREATE TABLE IF NOT EXISTS ec_group_members (
      group_id     TEXT NOT NULL REFERENCES ec_groups(id) ON DELETE CASCADE,
      email        TEXT NOT NULL,
      display_name TEXT,
      data         JSONB NOT NULL DEFAULT '{}'::jsonb,
      added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ec_group_members_uq
      ON ec_group_members(group_id, lower(email));

    CREATE TABLE IF NOT EXISTS ec_audit_logs (
      id          BIGSERIAL PRIMARY KEY,
      actor       TEXT NOT NULL DEFAULT 'admin',
      action      TEXT NOT NULL,
      entity_type TEXT,
      entity_id   TEXT,
      details     JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ec_audit_entity ON ec_audit_logs(entity_type, entity_id, created_at DESC);
  `);

  // These tables hold student names/emails and attachment bytes. The app reaches Postgres as
  // the table owner (which bypasses RLS), so enabling RLS with no policies changes nothing for
  // the backend while making Supabase's public REST API (anon/authenticated roles) see nothing.
  for (const t of ['ec_messages', 'ec_send_jobs', 'ec_message_recipients', 'ec_delivery_events', 'ec_attachments',
    'ec_templates', 'ec_template_versions', 'ec_groups', 'ec_group_members', 'ec_audit_logs']) {
    await db.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
  }

  // Built-in templates (seeded once per id; never overwrites admin edits).
  const { seedSystemTemplates } = await import('../services/emailCentre/store');
  await seedSystemTemplates();
}

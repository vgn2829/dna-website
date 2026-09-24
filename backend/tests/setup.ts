import { beforeAll, afterAll, afterEach } from 'vitest';

// Test environment must be fully configured before any app module is
// imported, since server.ts-style guards and the mailer/JWT modules read
// process.env at import/call time, not lazily behind a config object.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? 'postgresql://localhost:5432/dna_club_test';
process.env.JWT_SECRET = 'test-jwt-secret-not-for-production-use-only-in-ci';
process.env.ADMIN_PASSWORD = 'test-admin-password-123';
process.env.CORS_ORIGINS = 'http://localhost:5173';
// Leave RESEND_API_KEY unset — sendOtpEmail/sendWelcomeEmail intentionally no-op
// (and log to console) when it's absent, which is exactly the behavior tests want:
// no real network calls, no thrown errors, OTP flow still completes.
delete process.env.RESEND_API_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.INTERNAL_TICK_SECRET;

import { pool, query } from '../src/db/client';
import { initSchema } from '../src/db/schema';

beforeAll(async () => {
  await initSchema();

  // server.ts normally seeds admin_config.admin_password_hash from
  // ADMIN_PASSWORD on first boot (see server.ts main()); createApp() alone
  // doesn't do this, so tests exercising POST /api/auth/admin/login need it
  // done here once, against the fixed ADMIN_PASSWORD set above.
  const bcrypt = await import('bcryptjs');
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD!, 12);
  await query(
    `INSERT INTO admin_config(key,value) VALUES('admin_password_hash',$1)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [hash]
  );
});

afterAll(async () => {
  await pool.end();
});

// Tables written by the OTP/RSVP flows under test. Truncated after every test
// so each test starts from a clean slate without needing full schema teardown
// (which would be slow to re-run for every test file given fileParallelism
// is disabled and initSchema is idempotent but not free).
const TABLES_TO_CLEAN = [
  'email_recipients',
  'email_campaigns',
  'student_otps',
  'student_email_change_otps',
  'student_watched_videos',
  'student_completed_quizzes',
  'student_sessions',
  'event_rsvps',
  'events',
  'mail_usage',
  'mail_queue',
];

// DEADLOCK AVOIDANCE (test infrastructure only).
//
// This TRUNCATE takes an ACCESS EXCLUSIVE lock on every table listed, plus
// — because of CASCADE — every table with an FK to one of them.
// email_recipients is referenced by BOTH student_sessions and events, so
// the statement needs that lock along two different paths. Meanwhile the
// RSVP capacity test deliberately drives ten concurrent transactions that
// each take `SELECT ... FOR UPDATE` on events. When a teardown lands while
// those are still releasing, the lock orders invert and Postgres resolves
// it the only way it can: `deadlock detected`, killing the connection and
// failing whichever test happened to be running.
//
// Reproduced directly (error: deadlock detected at this line, with
// rsvp-capacity's concurrent RSVPs as the other party). Pre-existing —
// both this file and that test predate the V2 work — and the reason suite
// failures appeared to wander between unrelated files.
//
// The fix is a LOCK-ORDER GUARANTEE, not a timing hack: acquire every
// lock up front, in one fixed (sorted) order, in a single statement,
// inside the same transaction as the TRUNCATE. Postgres cannot deadlock
// when competing statements request locks in a consistent order, and a
// transaction that must wait simply waits.
//
// One statement rather than a loop: eleven separate LOCK round-trips would
// hold the earliest locks for the duration of the remaining ten,
// needlessly widening the window for another connection to queue behind
// them — which surfaced as a test blocking past its 15s timeout instead of
// deadlocking.
//
// No sleep, no retry, no lock_timeout, no change to any test's
// concurrency, and exactly the same tables are cleaned as before.
const TRUNCATE_LOCK_LIST = [...TABLES_TO_CLEAN].sort().map(t => `"${t}"`).join(', ');
const TRUNCATE_LIST = TABLES_TO_CLEAN.map(t => `"${t}"`).join(', ');

afterEach(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`LOCK TABLE ${TRUNCATE_LOCK_LIST} IN ACCESS EXCLUSIVE MODE`);
    await client.query(`TRUNCATE ${TRUNCATE_LIST} CASCADE`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

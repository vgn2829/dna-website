import { assertTestDatabaseTarget } from '../src/db/dbTarget';

// ─────────────────────────────────────────────────────────────────────────
// FIRST setup file (see vitest.config.mts). Establishes the test
// environment — above all the database target — before any application
// module is loaded. src/db/client.ts creates its pg Pool when it is first
// imported; ESM hoists imports above assignments, so doing this inside
// setup.ts (which itself imports the client) ran too late: the Pool was
// built from whatever DATABASE_URL the shell happened to have, falling
// back to libpq defaults (the OS user's own database). This file imports
// nothing that touches the database, and vitest finishes running it before
// setup.ts or any test file is evaluated.
//
// DATABASE_URL is always overwritten here (a hosted URL exported in the
// shell is never used), and the target must be a LOCAL database whose name
// marks it disposable — the suite TRUNCATEs tables.
// ─────────────────────────────────────────────────────────────────────────

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  // Local Postgres speaks plain TCP; client.ts's sslConfig() would
  // otherwise turn SSL on for any DATABASE_URL.
  ?? 'postgresql://localhost:5432/dna_club_test?sslmode=disable';
assertTestDatabaseTarget(process.env.DATABASE_URL);

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
delete process.env.ALLOW_REMOTE_SCHEMA_INIT;

// ─────────────────────────────────────────────────────────────────────────
// Which database is this process about to touch, and is that allowed?
//
// Two guards live here, both driven by the parsed DATABASE_URL rather than
// by anyone remembering which .env file was loaded:
//
//   assertSchemaInitAllowed() — called at the top of initSchema(). Schema
//     initialization (DDL + backfills) may run against:
//       - a LOCAL database (localhost / 127.0.0.1 / ::1 / unix socket), or
//       - any database when NODE_ENV=production (Render, Docker image), or
//       - a remote database the operator has named EXACTLY in
//         ALLOW_REMOTE_SCHEMA_INIT (its hostname — not "true"), for the
//         documented "run the seed against Supabase" workflow.
//     Anything else is refused with an explanation. This is what stops a
//     `tsx watch` dev server with a hosted DATABASE_URL in backend/.env
//     from silently migrating the hosted database on every file save.
//
//   assertTestDatabaseTarget() — called by tests/env.ts before any app
//     module (and so before the pg Pool) is loaded. The test suite
//     TRUNCATEs tables, so it only ever runs against a local database whose
//     name marks it as disposable (…_test).
//
// No hostname of any real deployment is hardcoded here.
// ─────────────────────────────────────────────────────────────────────────

export interface DbTarget {
  host: string;
  database: string;
  isLocal: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function describeDbTarget(url: string | undefined): DbTarget | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // A unix-socket connection string carries its directory in ?host=/path
  // and an empty URL host — local by definition.
  const socketHost = parsed.searchParams.get('host');
  const host = parsed.hostname || socketHost || '';
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const isLocal = LOCAL_HOSTS.has(host.toLowerCase()) || host === '' || host.startsWith('/');
  return { host: host || '(unix socket)', database, isLocal };
}

export function isDisposableTestDatabaseName(name: string): boolean {
  return /(^|_)test(_|$)/i.test(name);
}

export type Env = Record<string, string | undefined>;

export function checkSchemaInitAllowed(env: Env): { allowed: boolean; reason: string; target: DbTarget | null } {
  const target = describeDbTarget(env.DATABASE_URL);
  const envName = env.NODE_ENV || 'development';
  if (!target) return { allowed: false, reason: 'DATABASE_URL is not set or not a valid URL', target };
  const where = `database "${target.database}" on ${target.host}`;

  if (envName === 'test') {
    return target.isLocal && isDisposableTestDatabaseName(target.database)
      ? { allowed: true, reason: `test environment, local disposable ${where}`, target }
      : { allowed: false, reason: `test environment may only initialize a local database named *_test, not ${where}`, target };
  }
  if (envName === 'production') return { allowed: true, reason: `production environment, ${where}`, target };
  if (target.isLocal) return { allowed: true, reason: `${envName} environment, local ${where}`, target };
  if (env.ALLOW_REMOTE_SCHEMA_INIT && env.ALLOW_REMOTE_SCHEMA_INIT === target.host) {
    return { allowed: true, reason: `${envName} environment, remote ${where} explicitly allowed by ALLOW_REMOTE_SCHEMA_INIT`, target };
  }
  return {
    allowed: false,
    reason:
      `Refusing schema initialization against remote ${where} from a ${envName} environment. ` +
      `Point DATABASE_URL at a local database for development, run with NODE_ENV=production for a real deployment, ` +
      `or — only if you really mean to migrate that database from this machine — set ALLOW_REMOTE_SCHEMA_INIT=${target.host}.`,
    target,
  };
}

export function assertSchemaInitAllowed(env: Env = process.env): DbTarget {
  const check = checkSchemaInitAllowed(env);
  if (!check.allowed) throw new Error(check.reason);
  return check.target!;
}

export function assertTestDatabaseTarget(url: string | undefined): DbTarget {
  const target = describeDbTarget(url);
  if (!target) throw new Error('Test DATABASE_URL is not set or not a valid URL');
  if (!target.isLocal) {
    throw new Error(`Refusing to run the test suite against remote database "${target.database}" on ${target.host} — tests TRUNCATE tables. Use a local *_test database.`);
  }
  if (!isDisposableTestDatabaseName(target.database)) {
    throw new Error(`Refusing to run the test suite against "${target.database}" — tests TRUNCATE tables, so the database name must mark it as disposable (e.g. dna_club_test).`);
  }
  return target;
}

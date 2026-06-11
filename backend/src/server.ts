import 'dotenv/config';

// ── Startup guards ─────────────────────────────────────────────────────────────
const required = ['ADMIN_PASSWORD', 'JWT_SECRET', 'DATABASE_URL'];
for (const v of required) {
  if (!process.env[v]) {
    console.error(`FATAL: ${v} environment variable is not set.`);
    process.exit(1);
  }
}

const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL);
const hasSupabaseKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
if (hasSupabaseUrl !== hasSupabaseKey) {
  console.error('FATAL: Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or neither (local storage).');
  process.exit(1);
}

import { pool, query } from './db/client';
import { initSchema } from './db/schema';
import bcrypt from 'bcryptjs';
import { createApp } from './app';

async function main() {
  await initSchema();

  // Auto-seed admin password hash on first startup
  const rows = await query<{ value: string }>('SELECT value FROM admin_config WHERE key=$1', ['admin_password_hash']);
  if (rows.length === 0) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD!, 12);
    await query('INSERT INTO admin_config(key,value) VALUES($1,$2)', ['admin_password_hash', hash]);
    console.log('Admin password initialized from ADMIN_PASSWORD env var.');
  }

  const PORT = Number(process.env.PORT ?? 4000);
  const app = createApp();
  app.listen(PORT, () => {
    const storage = (hasSupabaseUrl && hasSupabaseKey) ? 'Supabase Storage' : 'local disk';
    console.log(`DnA Club API running on port ${PORT} [storage: ${storage}]`);
  });
}

main().catch(err => {
  console.error('FATAL startup error:', err);
  process.exit(1);
});

// Image derivative backfill (V3.2.3) — DRY RUN by default.
//
//   npx tsx scripts/storage-derivatives-backfill.ts [--apply] [--limit=N] [--json]
//
// Finds stored images under assets/ and canvas-files/ that have no usable
// t512 derivative yet (never generated, previously failed, or 'ready' but
// the object is missing) and — only with --apply — generates them, one at
// a time, oldest-key order, up to --limit. Re-running is safe: finished
// sources are skipped, failures are retried. Originals are only read.
// See src/storage/derivativeBackfill.ts for the exact rules.
//
// Without --apply this command writes NOTHING: the only storage calls are
// list(), and every database read runs on ONE connection inside an
// explicit BEGIN READ ONLY transaction that is verified before anything is
// read and rolled back at the end (same as scripts/storage-inventory.ts).
//
// Run against a local/disposable environment first. Running --apply
// against production storage requires an explicit, separate decision.
import 'dotenv/config';
import { pool, poolTarget } from '../src/db/client';
import { runDerivativeBackfill, type BackfillResult } from '../src/storage/derivativeBackfill';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const asJson = args.includes('--json');
const limitArg = args.find(a => a.startsWith('--limit='))?.slice('--limit='.length);
const limit = limitArg !== undefined ? Number(limitArg) : undefined;
if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
  console.error('--limit must be a non-negative integer');
  process.exit(1);
}

const storageLabel = process.env.SUPABASE_URL
  ? `supabase ${(() => { try { return new URL(process.env.SUPABASE_URL!).host; } catch { return '(invalid SUPABASE_URL)'; } })()} / ${process.env.SUPABASE_STORAGE_BUCKET ?? 'dna-media'}`
  : 'local disk (backend/uploads)';

async function main(): Promise<void> {
  let result: BackfillResult;
  if (apply) {
    result = await runDerivativeBackfill({ apply: true, limit });
  } else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const readOnly = (await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
      if (readOnly !== 'on') throw new Error(`Refusing to run: session is not read-only (transaction_read_only=${readOnly})`);
      result = await runDerivativeBackfill({ apply: false, limit, db: client });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ target: { database: poolTarget, storage: storageLabel }, ...result }, null, 2));
    return;
  }
  console.log(`IMAGE DERIVATIVE BACKFILL — ${result.apply ? 'APPLY' : 'DRY RUN (nothing will be written)'}   variant: ${result.variant}`);
  console.log(`database: ${poolTarget ? `${poolTarget.host} / ${poolTarget.database}` : '(unknown)'}   storage: ${storageLabel}   env: ${process.env.NODE_ENV || 'development'}`);
  console.log(`objects listed under assets/ + canvas-files/: ${result.sourcesListed}   derivable images: ${result.eligible}   already ready: ${result.alreadyReady}   skipped (served as original): ${result.alreadySkipped}`);
  console.log(`to process: missing ${result.toProcess['missing']}, retry failed ${result.toProcess['retry-failed']}, repair missing object ${result.toProcess['repair-missing-object']}   (limit: ${limit ?? 'none'})`);
  if (result.apply) {
    console.log(`processed ${result.processed}: ready ${result.outcomes.ready}, failed ${result.outcomes.failed}, skipped ${result.outcomes.skipped}   remaining ${result.remaining}`);
  } else {
    console.log(`would process ${result.items.length} now; ${result.remaining} in total. Re-run with --apply to generate.`);
  }
  for (const it of result.items) console.log(`  ${it.reason.padEnd(22)} ${it.outcome ?? '-'}  ${it.sourceKey}`);
}

main()
  .catch(err => { console.error('derivative backfill failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());

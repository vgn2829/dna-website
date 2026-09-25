// Storage inventory — DRY RUN ONLY (V3.0).
//
//   npx tsx scripts/storage-inventory.ts [--prefix=canvas-files/] [--all] [--json]
//
// Lists every stored object (via the configured StorageProvider: Supabase
// when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set, local disk
// otherwise) and classifies it with storage/inventory.ts. This command has
// NO deletion mode: the only storage call it makes is list(), and the only
// database statements are SELECTs — run on ONE connection inside an explicit
// BEGIN READ ONLY transaction that is verified (SHOW transaction_read_only)
// before anything is read and rolled back at the end, so even an
// accidental write would be rejected by Postgres. (Connection-level
// read-only options are not used: transaction-mode poolers such as
// Supabase's ignore them.) ORPHAN rows are candidates for a future,
// separately reviewed deletion step — nothing here acts on them.
//
// --all   also print LIVE_OWNER rows (default: only ORPHAN,
//         REFERENCED_WITHOUT_OWNER and UNKNOWN)
// --json  machine-readable output
import 'dotenv/config';
import { getStorage } from '../src/storage';
import { pool, poolTarget } from '../src/db/client';
import { classifyStorageObjects, summarizeInventory, type ClassifiedObject } from '../src/storage/inventory';

const args = process.argv.slice(2);
const prefix = args.find(a => a.startsWith('--prefix='))?.slice('--prefix='.length) ?? '';
const showAll = args.includes('--all');
const asJson = args.includes('--json');

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
const storageLabel = process.env.SUPABASE_URL
  ? `supabase ${(() => { try { return new URL(process.env.SUPABASE_URL!).host; } catch { return '(invalid SUPABASE_URL)'; } })()} / ${process.env.SUPABASE_STORAGE_BUCKET ?? 'dna-media'}`
  : 'local disk (backend/uploads)';

async function main(): Promise<void> {
  const client = await pool.connect();
  let items: ClassifiedObject[];
  try {
    await client.query('BEGIN READ ONLY');
    const readOnly = (await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only;
    if (readOnly !== 'on') throw new Error(`Refusing to run: session is not read-only (transaction_read_only=${readOnly})`);
    const objects = await getStorage().list(prefix);
    // A derivative (derived/...) is LIVE while its source object exists. A
    // full listing already contains every source; a narrower --prefix does
    // not, so list the source namespaces separately (still read-only).
    const sourcePaths = prefix === ''
      ? undefined
      : new Set([...await getStorage().list('assets/'), ...await getStorage().list('canvas-files/')].map(o => o.path));
    items = await classifyStorageObjects(objects, client, sourcePaths);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  const summary = summarizeInventory(items);
  const candidates = items.filter(i => i.classification === 'ORPHAN');

  if (asJson) {
    console.log(JSON.stringify({ dryRun: true, target: { database: poolTarget, storage: storageLabel, prefix }, summary, items: showAll ? items : items.filter(i => i.classification !== 'LIVE_OWNER') }, null, 2));
    return;
  }

  console.log('STORAGE INVENTORY — DRY RUN (read-only; this command cannot delete anything)');
  console.log(`database: ${poolTarget ? `${poolTarget.host} / ${poolTarget.database}` : '(unknown)'}   storage: ${storageLabel}   env: ${process.env.NODE_ENV || 'development'}   prefix: ${prefix || '(all)'}`);
  console.log(`objects: ${summary.totalObjects} (${mb(summary.totalBytes)})`);
  for (const [cls, v] of Object.entries(summary.byClass)) console.log(`  ${cls.padEnd(26)} ${String(v.count).padStart(6)}  ${mb(v.bytes)}`);
  for (const [ns, v] of Object.entries(summary.orphansByNamespace)) console.log(`  ORPHAN in ${ns.padEnd(15)} ${String(v.count).padStart(6)}  ${mb(v.bytes)}`);
  for (const [reason, v] of Object.entries(summary.unknownByReason)) console.log(`  UNKNOWN: ${reason} — ${v.count} (${mb(v.bytes)})`);

  const rows: ClassifiedObject[] = showAll ? items : items.filter(i => i.classification !== 'LIVE_OWNER');
  console.log('\nclassification             size       refs  types / reason  path');
  for (const r of rows) {
    const refs = r.referenceCountCapped ? `${r.referenceCount}+` : String(r.referenceCount);
    console.log(`${r.classification.padEnd(26)} ${String(r.size).padStart(10)} ${refs.padStart(5)}  ${r.referenceTypes.join(',') || '-'} / ${r.reason}  ${r.path}`);
  }
  console.log(`\n${candidates.length} ORPHAN candidate(s), ${mb(candidates.reduce((n, c) => n + c.size, 0))}. Nothing was deleted.`);
}

main()
  .catch(err => { console.error('storage inventory failed:', err); process.exitCode = 1; })
  .finally(() => pool.end());

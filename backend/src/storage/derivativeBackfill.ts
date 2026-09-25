import { pool } from '../db/client';
import { getStorage } from './index';
import type { DbExecutor } from './references';
import { derivativeKey, generateDerivative, isDerivableSourceKey, parseSourceKey, THUMB_VARIANT, type Variant, DERIVED_ROOT } from './derivatives';

// ─────────────────────────────────────────────────────────────────────────
// Image derivative backfill (V3.2.3) — the logic behind
// scripts/storage-derivatives-backfill.ts.
//
// Sources are discovered by LISTING storage (assets/ and canvas-files/),
// not from database rows: canvas files have no row. Work is decided purely
// from current state, which is what makes it resumable and idempotent:
//
//   ready row AND derivative object present  → skip (already done)
//   skipped row (e.g. animated GIF)          → skip (served as the original)
//   no row                                   → generate
//   failed row                               → retry
//   ready row but derivative object missing  → regenerate (repair)
//
// Dry run (the default) only lists and reads — no storage write, no
// database write. --apply processes up to `limit` sources, one at a time,
// via generateDerivative(): the original is only ever read; the
// derivative is written to its own deterministic key and the row upserted;
// a failure is recorded ('failed') and processing continues.
// SVG and non-image files are never candidates; a multi-frame GIF is
// examined and skipped (served as the original).
// ─────────────────────────────────────────────────────────────────────────

export type PlanReason = 'missing' | 'retry-failed' | 'repair-missing-object';

export interface BackfillItem { sourceKey: string; reason: PlanReason; outcome?: 'ready' | 'failed' | 'skipped' | 'ineligible' }

export interface BackfillResult {
  apply: boolean;
  variant: Variant;
  sourcesListed: number;
  eligible: number;
  alreadyReady: number;
  alreadySkipped: number;
  toProcess: Record<PlanReason, number>;
  processed: number;
  outcomes: { ready: number; failed: number; skipped: number };
  remaining: number;
  items: BackfillItem[];
}

export async function runDerivativeBackfill(opts: { apply?: boolean; limit?: number; variant?: Variant; db?: DbExecutor } = {}): Promise<BackfillResult> {
  const apply = opts.apply === true;
  const variant = opts.variant ?? THUMB_VARIANT;
  const limit = opts.limit !== undefined && opts.limit >= 0 ? opts.limit : Infinity;
  const db = opts.db ?? pool;

  const listed = [...await getStorage().list('assets/'), ...await getStorage().list('canvas-files/')];
  const sources = listed.map(o => o.path).filter(p => parseSourceKey(p) && isDerivableSourceKey(p)).sort();
  const derivedObjects = new Set((await getStorage().list(`${DERIVED_ROOT}/`)).map(o => o.path));
  const rows = (await db.query(`SELECT source_key, status FROM storage_derivatives WHERE variant = $1`, [variant])).rows as Array<{ source_key: string; status: string }>;
  const status = new Map(rows.map(r => [r.source_key, r.status]));

  const plan: BackfillItem[] = [];
  let alreadyReady = 0;
  let alreadySkipped = 0;
  for (const sourceKey of sources) {
    const st = status.get(sourceKey);
    const hasObject = derivedObjects.has(derivativeKey(sourceKey, variant));
    if (st === 'ready' && hasObject) { alreadyReady++; continue; }
    if (st === 'skipped') { alreadySkipped++; continue; }
    plan.push({ sourceKey, reason: st === 'ready' ? 'repair-missing-object' : st === 'failed' ? 'retry-failed' : 'missing' });
  }

  const toProcess: Record<PlanReason, number> = { 'missing': 0, 'retry-failed': 0, 'repair-missing-object': 0 };
  for (const p of plan) toProcess[p.reason]++;
  const batch = plan.slice(0, Math.min(plan.length, limit));
  const outcomes = { ready: 0, failed: 0, skipped: 0 };

  if (apply) {
    for (const item of batch) { // concurrency 1: one 12 MP decode at a time
      item.outcome = await generateDerivative(item.sourceKey, undefined, variant);
      if (item.outcome === 'ready') outcomes.ready++;
      else if (item.outcome === 'failed') outcomes.failed++;
      else outcomes.skipped++;
    }
  }

  return {
    apply, variant,
    sourcesListed: listed.length,
    eligible: sources.length,
    alreadyReady,
    alreadySkipped,
    toProcess,
    processed: apply ? batch.length : 0,
    outcomes,
    remaining: plan.length - (apply ? batch.length : 0),
    items: batch,
  };
}

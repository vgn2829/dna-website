import sharp from 'sharp';
import { pool } from '../db/client';
import { getStorage } from './index';
import type { DbExecutor } from './references';

// ─────────────────────────────────────────────────────────────────────────
// Image derivatives (V3.2.3) — small, server-generated copies of images we
// already store, for thumbnail-sized UI (asset cards, board previews).
//
// DERIVED DATA ONLY. A derivative is never an asset, an owner or a
// reference. The ORIGINAL stays the source of truth: it is only ever read
// here, never modified, replaced, or deleted because a derivative exists.
//
//   source key      assets/<workspaceId>/<assetId>.<ext>
//                   canvas-files/<boardId>/<fileId>.<ext>
//   derivative key  derived/<source key>/<variant>.webp
//                   e.g. derived/assets/<ws>/<id>.jpg/t512.webp
//
// Keys are deterministic (same source + variant → same key), so
// regeneration overwrites in place; changing a variant's settings means a
// NEW variant name, never new bytes under an old key — which is what makes
// the long immutable cache below safe.
//
// Derivative URLs are NEVER written into canvas_data, board_versions,
// templates, board_items or canvas_preview. Saved content keeps the
// original URL; resolveDerivativeUrls() maps source → derivative at READ
// time. That is why a derivative can never count as a reference
// (storage/references.ts only searches persisted content) and can never
// keep an asset alive.
//
// State lives in storage_derivatives (db/schema.ts): 'ready', 'failed', or
// 'skipped' (deliberately served as the original, e.g. an animated GIF).
// No row = never generated (yet). Every consumer falls back to the
// original for anything that isn't 'ready'.
// ─────────────────────────────────────────────────────────────────────────

// The managed source shapes — identical to the ones storage/inventory.ts
// proves ownership for (it imports these).
export const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const SAFE_FILE = /^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9]{1,12}$/;
const SOURCE_NAMESPACES = new Set(['assets', 'canvas-files']);

export const DERIVED_ROOT = 'derived';

export const VARIANTS = {
  // Short edge 512 px (fit: outside, never enlarged), WebP q75. Sized from
  // measured card/preview dimensions — see the V3.2.3 design report.
  t512: { shortEdge: 512, quality: 75 },
} as const;
export type Variant = keyof typeof VARIANTS;
export const THUMB_VARIANT: Variant = 't512';
const DERIVATIVE_EXT = 'webp';
const DERIVATIVE_MIME = 'image/webp';

// Derivative bytes never change for a given key (see above).
export const DERIVATIVE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DERIVATIVE_CACHE_SECONDS = '31536000';

// Raster formats a derivative is made from. SVG is vector and served as-is;
// anything else stored under assets/ or canvas-files/ is a general file.
// (HEIF is decodable by sharp but no upload path stores it today.)
const DERIVABLE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const DERIVABLE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif']);

export interface SourceKey { namespace: 'assets' | 'canvas-files'; ownerId: string; file: string; ext: string }

// Strict parse of a managed source storage key. Anything else — extra or
// missing segments, "..", encoded characters, other namespaces — is null.
export function parseSourceKey(key: unknown): SourceKey | null {
  if (typeof key !== 'string' || key.length > 300) return null;
  const parts = key.split('/');
  if (parts.length !== 3 || !SOURCE_NAMESPACES.has(parts[0])) return null;
  if (!SAFE_ID.test(parts[1]) || !SAFE_FILE.test(parts[2])) return null;
  return { namespace: parts[0] as SourceKey['namespace'], ownerId: parts[1], file: parts[2], ext: parts[2].slice(parts[2].lastIndexOf('.') + 1).toLowerCase() };
}

export function isDerivableSourceKey(key: unknown): boolean {
  const parsed = parseSourceKey(key);
  return !!parsed && DERIVABLE_EXTENSIONS.has(parsed.ext);
}

// The only way a derivative path is ever built. Throws for anything that
// isn't a valid managed source key, so client strings can't reach storage.
export function derivativeKey(sourceKey: string, variant: Variant = THUMB_VARIANT): string {
  if (!parseSourceKey(sourceKey)) throw new Error('Invalid derivative source key');
  if (!(variant in VARIANTS)) throw new Error('Unknown derivative variant');
  return `${DERIVED_ROOT}/${sourceKey}/${variant}.${DERIVATIVE_EXT}`;
}

export function parseDerivativeKey(key: unknown): { sourceKey: string; variant: Variant } | null {
  if (typeof key !== 'string') return null;
  const parts = key.split('/');
  if (parts.length !== 5 || parts[0] !== DERIVED_ROOT) return null;
  const sourceKey = parts.slice(1, 4).join('/');
  if (!parseSourceKey(sourceKey)) return null;
  const variant = (Object.keys(VARIANTS) as Variant[]).find(v => parts[4] === `${v}.${DERIVATIVE_EXT}`);
  return variant ? { sourceKey, variant } : null;
}

// ── rendering ────────────────────────────────────────────────────────────

export type RenderResult =
  | { kind: 'ready'; buffer: Buffer; width: number; height: number }
  | { kind: 'skipped'; reason: string };

// Pure: bytes in, derivative bytes out. Throws on undecodable input.
// input: the image bytes, or a path to it on local disk (a large upload's
// temp file — sharp/libvips then reads it from disk, never all into memory).
export async function renderVariant(input: Buffer | string, variant: Variant = THUMB_VARIANT): Promise<RenderResult> {
  const meta = await sharp(input).metadata();
  if (meta.format === 'svg') return { kind: 'skipped', reason: 'svg is served as the original' };
  if (!meta.format || !DERIVABLE_FORMATS.has(meta.format)) return { kind: 'skipped', reason: `unsupported format ${meta.format ?? 'unknown'}` };
  if ((meta.pages ?? 1) > 1) return { kind: 'skipped', reason: 'multi-frame image (animated) is served as the original' };
  const { shortEdge, quality } = VARIANTS[variant];
  const { data, info } = await sharp(input)
    .rotate() // apply EXIF orientation before resizing
    .resize({ width: shortEdge, height: shortEdge, fit: 'outside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return { kind: 'ready', buffer: data, width: info.width, height: info.height };
}

// ── state ────────────────────────────────────────────────────────────────

export type DerivativeState =
  | { status: 'ready'; width: number; height: number; bytes: number }
  | { status: 'failed' | 'skipped'; error: string };

export async function recordDerivative(sourceKey: string, variant: Variant, state: DerivativeState, db: DbExecutor = pool): Promise<void> {
  const ready = state.status === 'ready';
  await db.query(
    `INSERT INTO storage_derivatives (source_key, variant, derivative_key, status, width, height, bytes, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (source_key, variant) DO UPDATE SET
       derivative_key = EXCLUDED.derivative_key, status = EXCLUDED.status, width = EXCLUDED.width,
       height = EXCLUDED.height, bytes = EXCLUDED.bytes, error = EXCLUDED.error, created_at = now()`,
    [sourceKey, variant, derivativeKey(sourceKey, variant), state.status,
     ready ? state.width : null, ready ? state.height : null, ready ? state.bytes : null,
     ready ? null : state.error.slice(0, 500)]
  );
}

export type GenerateOutcome = 'ready' | 'failed' | 'skipped' | 'ineligible';

// Best-effort: never throws. Reads the original (from `source` when the
// caller already has the bytes, else from storage), writes the derivative
// object, then records 'ready'; any failure records 'failed' instead.
export async function generateDerivative(sourceKey: string, source?: Buffer | string, variant: Variant = THUMB_VARIANT): Promise<GenerateOutcome> {
  if (!isDerivableSourceKey(sourceKey)) return 'ineligible';
  try {
    const input = source ?? await getStorage().download(sourceKey);
    const result = await renderVariant(input, variant);
    if (result.kind === 'skipped') {
      await recordDerivative(sourceKey, variant, { status: 'skipped', error: result.reason });
      return 'skipped';
    }
    await getStorage().upload(derivativeKey(sourceKey, variant), result.buffer, DERIVATIVE_MIME, { cacheControl: DERIVATIVE_CACHE_SECONDS });
    await recordDerivative(sourceKey, variant, { status: 'ready', width: result.width, height: result.height, bytes: result.buffer.length });
    return 'ready';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await recordDerivative(sourceKey, variant, { status: 'failed', error: message });
    } catch (recordErr) {
      console.error(`Derivative ${variant} for ${sourceKey} failed and could not be recorded:`, message, recordErr);
    }
    return 'failed';
  }
}

// ── upload-time generation (accounted, serial) ───────────────────────────
//
// Uploads schedule generation AFTER the original is stored and its
// metadata persisted, without holding the response. Jobs run one at a
// time (each 12 MP decode is ~35 MB of memory) on a single chain and are
// tracked in `pending`, so callers/tests can wait for them
// (settleDerivativeJobs) and nothing is an untracked promise. A job lost
// to a process restart simply leaves no 'ready' row — the backfill
// (scripts/storage-derivatives-backfill.ts) regenerates it.

let chain: Promise<unknown> = Promise.resolve();
const pending = new Set<Promise<GenerateOutcome>>();

// onSettled runs once the job is done either way — used to remove the temp
// file a disk-streamed upload handed over as `source`.
export function scheduleDerivative(sourceKey: string, source: Buffer | string, variant: Variant = THUMB_VARIANT, onSettled?: () => void): void {
  if (!isDerivableSourceKey(sourceKey)) { onSettled?.(); return; }
  const job = chain.then(() => generateDerivative(sourceKey, source, variant)).finally(() => onSettled?.());
  chain = job.catch(() => undefined);
  pending.add(job);
  void job.finally(() => pending.delete(job)).catch(() => undefined);
}

export async function settleDerivativeJobs(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

// ── deletion ─────────────────────────────────────────────────────────────

// Removes every variant object and row for a source whose ORIGINAL has
// been deleted. Best-effort per step: a row is removed even if its object
// delete failed (inventory then classifies the leftover object as an
// ORPHAN derivative, since its source is gone).
export async function deleteDerivatives(sourceKey: string, db: DbExecutor = pool): Promise<void> {
  if (!parseSourceKey(sourceKey)) return;
  for (const variant of Object.keys(VARIANTS) as Variant[]) {
    try {
      await getStorage().delete(derivativeKey(sourceKey, variant));
    } catch (err) {
      console.error(`Could not delete derivative ${variant} of ${sourceKey}:`, err);
    }
  }
  await db.query('DELETE FROM storage_derivatives WHERE source_key = $1', [sourceKey]);
}

// ── read-time URL mapping ────────────────────────────────────────────────

// Recognizes ONLY our own public storage URLs, by the exact prefix the
// configured provider produces (…/uploads/<key> locally,
// …/object/public/<bucket>/<key> on Supabase), then requires the rest to be
// a strict managed source key. Never fetches anything; external URLs and
// anything malformed are null.
const SENTINEL = '__derivative_prefix_probe__';
export function sourceKeyFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  const probe = getStorage().getPublicUrl(SENTINEL);
  if (!probe.endsWith(SENTINEL)) return null;
  const prefix = probe.slice(0, -SENTINEL.length);
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  return parseSourceKey(key) ? key : null;
}

// For each input (one of OUR public URLs, or a managed source key) returns
// the URL a thumbnail-sized surface should load: the derivative's public
// URL when its row is 'ready', otherwise the original. External URLs and
// unrecognized strings map to themselves; a failed lookup maps everything
// to its original. One query for the whole batch.
export async function resolveDerivativeUrls(inputs: string[], variant: Variant = THUMB_VARIANT, db: DbExecutor = pool): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const keyed = new Map<string, string>(); // input → source key
  for (const input of inputs) {
    if (typeof input !== 'string') continue;
    const key = parseSourceKey(input) ? input : sourceKeyFromUrl(input);
    if (key && isDerivableSourceKey(key)) keyed.set(input, key);
    out.set(input, parseSourceKey(input) ? getStorage().getPublicUrl(input) : input);
  }
  if (keyed.size === 0) return out;
  try {
    const rows = (await db.query(
      `SELECT source_key, derivative_key FROM storage_derivatives WHERE variant = $1 AND status = 'ready' AND source_key = ANY($2)`,
      [variant, [...new Set(keyed.values())]]
    )).rows as Array<{ source_key: string; derivative_key: string }>;
    const ready = new Map(rows.map(r => [r.source_key, r.derivative_key]));
    for (const [input, key] of keyed) {
      const derived = ready.get(key);
      // derivative_key is re-derived rather than trusted from the row.
      if (derived && derived === derivativeKey(key, variant)) out.set(input, getStorage().getPublicUrl(derived));
    }
  } catch (err) {
    console.error('Derivative lookup failed; serving originals:', err);
  }
  return out;
}

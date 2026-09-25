import { pool } from '../db/client';
import type { StoredObject } from './index';
import { findStorageReferences, type DbExecutor } from './references';
import { SAFE_ID, SAFE_FILE, DERIVED_ROOT, parseDerivativeKey } from './derivatives';

// ─────────────────────────────────────────────────────────────────────────
// Storage inventory (V3.0) — READ-ONLY classification of stored objects.
// Nothing in this module deletes or modifies anything; it only lists what
// it is given and queries the database.
//
// Managed namespaces (ownership provable from the path):
//   canvas-files/<boardId>/<fileId>.<ext>   owner: boards.id = <boardId>
//       written by POST /api/boards/:id/canvas-files; never deleted today
//       (board deletion leaves them). Other boards/templates/versions can
//       still reference them after the board is gone (duplicate and
//       template copy canvas_data verbatim).
//   assets/<workspaceId>/<assetId>.<ext>    owner: the assets row whose
//       storage_key is exactly this path. Since 3e8fba3 an asset row may be
//       deleted while its file is kept because saved content references it.
//
//   derived/<source key>/<variant>.webp   image derivative (V3.2.3,
//       storage/derivatives.ts). Owned by nothing: it is DERIVED from its
//       source object and lives exactly as long as that object exists in
//       storage. It never owns its source, never counts as a reference, and
//       never keeps an asset alive.
//
// Everything else (gallery/, thumbs/, covers/ — artworks; team/ — team
// members; anything unexpected) is UNKNOWN: retained, never a candidate.
//
// Classification:
//   LIVE_OWNER                owner record exists (a derivative: its source
//                             object exists)
//   REFERENCED_WITHOUT_OWNER  owner gone, but saved content references it
//   ORPHAN                    owner gone AND nothing references it — the
//                             ONLY class that may ever be a deletion
//                             candidate
//   UNKNOWN                   not safely classifiable (malformed path,
//                             unmanaged namespace) — always retained
//
// "Referenced" is exactly findStorageReferences() (storage/references.ts),
// the same definition asset deletion uses — not a second implementation.
// ─────────────────────────────────────────────────────────────────────────

export type StorageClass = 'LIVE_OWNER' | 'REFERENCED_WITHOUT_OWNER' | 'ORPHAN' | 'UNKNOWN';
export type Namespace = 'canvas-files' | 'assets' | 'derived' | 'other';

export interface ClassifiedObject extends StoredObject {
  namespace: Namespace;
  classification: StorageClass;
  owner: string | null;
  ownerExists: boolean | null;
  // Capped at REFERENCE_LIMIT; referenceCountCapped says whether it hit it.
  referenceCount: number;
  referenceCountCapped: boolean;
  referenceTypes: string[];
  reason: string;
}

export const REFERENCE_LIMIT = 50;


function unknown(obj: StoredObject, namespace: Namespace, reason: string): ClassifiedObject {
  return { ...obj, namespace, classification: 'UNKNOWN', owner: null, ownerExists: null, referenceCount: 0, referenceCountCapped: false, referenceTypes: [], reason };
}

// `db` defaults to the shared pool; the inventory command passes a single
// client inside a verified BEGIN READ ONLY transaction.
//
// `sourcePaths`: every existing assets/ and canvas-files/ object path, used
// to decide whether a derivative's source still exists. Defaults to the
// paths in `objects`, which is only complete when `objects` is a full
// listing — a caller classifying a narrower prefix (e.g. derived/ alone)
// must pass the source listing, or live derivatives would look orphaned.
export async function classifyStorageObjects(objects: StoredObject[], db: DbExecutor = pool, sourcePaths?: Set<string>): Promise<ClassifiedObject[]> {
  const existingSources = sourcePaths ?? new Set(objects.map(o => o.path));
  const boardIds = new Set(((await db.query('SELECT id FROM boards')).rows as Array<{ id: string }>).map(r => r.id));
  const assetKeys = new Set(((await db.query('SELECT storage_key FROM assets WHERE storage_key IS NOT NULL')).rows as Array<{ storage_key: string }>).map(r => r.storage_key));

  const sorted = [...objects].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const out: ClassifiedObject[] = [];
  for (const obj of sorted) {
    const parts = obj.path.split('/');
    const root = parts[0];
    if (root === DERIVED_ROOT) {
      out.push(await classifyDerivative(obj, existingSources, db));
      continue;
    }
    if (root !== 'canvas-files' && root !== 'assets') {
      out.push(unknown(obj, 'other', `namespace "${root || '(root)'}" is not managed by storage cleanup`));
      continue;
    }
    const namespace: Namespace = root;
    if (parts.length !== 3 || !SAFE_ID.test(parts[1]) || !SAFE_FILE.test(parts[2])) {
      out.push(unknown(obj, namespace, `malformed ${namespace} path — ownership cannot be proven`));
      continue;
    }

    const owner = namespace === 'canvas-files' ? `board ${parts[1]}` : `asset record for ${obj.path}`;
    const ownerExists = namespace === 'canvas-files' ? boardIds.has(parts[1]) : assetKeys.has(obj.path);
    const refs = await findStorageReferences(obj.path, REFERENCE_LIMIT, db);
    const base = {
      ...obj, namespace, owner, ownerExists,
      referenceCount: refs.length,
      referenceCountCapped: refs.length >= REFERENCE_LIMIT,
      referenceTypes: [...new Set(refs.map(r => r.surface))].sort(),
    };
    if (ownerExists) {
      out.push({ ...base, classification: 'LIVE_OWNER', reason: `${owner} exists` });
    } else if (refs.length > 0) {
      out.push({ ...base, classification: 'REFERENCED_WITHOUT_OWNER', reason: `${owner} is gone but saved content still references it` });
    } else {
      out.push({ ...base, classification: 'ORPHAN', reason: `${owner} is gone and no saved content references it` });
    }
  }
  return out;
}

async function classifyDerivative(obj: StoredObject, existingSources: Set<string>, db: DbExecutor): Promise<ClassifiedObject> {
  const parsed = parseDerivativeKey(obj.path);
  if (!parsed) return unknown(obj, 'derived', 'malformed derived path — source cannot be proven');
  const owner = `source object ${parsed.sourceKey}`;
  const ownerExists = existingSources.has(parsed.sourceKey);
  // Derivative URLs are never persisted, so this is expected to be empty;
  // checked anyway so that a derivative which somehow IS referenced is
  // never offered as a deletion candidate.
  const refs = await findStorageReferences(obj.path, REFERENCE_LIMIT, db);
  const base = {
    ...obj, namespace: 'derived' as const, owner, ownerExists,
    referenceCount: refs.length,
    referenceCountCapped: refs.length >= REFERENCE_LIMIT,
    referenceTypes: [...new Set(refs.map(r => r.surface))].sort(),
  };
  if (ownerExists) return { ...base, classification: 'LIVE_OWNER', reason: `derivative of ${owner}, which exists` };
  if (refs.length > 0) return { ...base, classification: 'REFERENCED_WITHOUT_OWNER', reason: `${owner} is gone but saved content references this derivative` };
  return { ...base, classification: 'ORPHAN', reason: `derivative of ${owner}, which is gone` };
}

export interface InventorySummary {
  totalObjects: number;
  totalBytes: number;
  byClass: Record<StorageClass, { count: number; bytes: number }>;
  orphansByNamespace: Record<string, { count: number; bytes: number }>;
  unknownByReason: Record<string, { count: number; bytes: number }>;
}

export function summarizeInventory(items: ClassifiedObject[]): InventorySummary {
  const byClass = {
    LIVE_OWNER: { count: 0, bytes: 0 },
    REFERENCED_WITHOUT_OWNER: { count: 0, bytes: 0 },
    ORPHAN: { count: 0, bytes: 0 },
    UNKNOWN: { count: 0, bytes: 0 },
  } as InventorySummary['byClass'];
  const orphansByNamespace: InventorySummary['orphansByNamespace'] = {};
  const unknownByReason: InventorySummary['unknownByReason'] = {};
  const add = (m: Record<string, { count: number; bytes: number }>, k: string, size: number) => {
    m[k] = m[k] ?? { count: 0, bytes: 0 }; m[k].count++; m[k].bytes += size;
  };
  for (const it of items) {
    add(byClass, it.classification, it.size);
    if (it.classification === 'ORPHAN') add(orphansByNamespace, it.namespace, it.size);
    if (it.classification === 'UNKNOWN') add(unknownByReason, it.reason, it.size);
  }
  return {
    totalObjects: items.length,
    totalBytes: items.reduce((n, it) => n + it.size, 0),
    byClass, orphansByNamespace, unknownByReason,
  };
}

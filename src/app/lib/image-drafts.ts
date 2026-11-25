/** Image drafts: session memory by default, explicit 24-hour device retention when requested. */
export interface ImageDraft { version: 1; file: Blob; name: string; saved: number; retain: boolean; mask?: Uint8ClampedArray; model?: 'general' | 'portrait' | 'detail' }
type StoredDraft = Omit<ImageDraft, 'file' | 'version'> & { version: 2; fileData: ArrayBuffer; mime: string };
const drafts = new Map<string, ImageDraft>();
const LIMIT = 60 * 1024 * 1024;
const writes = new Map<string, Promise<boolean>>();
function enqueue(key: string, operation: () => Promise<boolean>) {
  const next = (writes.get(key) || Promise.resolve(true)).then(operation, operation);
  writes.set(key, next);
  void next.finally(() => { if (writes.get(key) === next) writes.delete(key); });
  return next;
}
const DAY = 24 * 60 * 60 * 1000;
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dna-studio-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Image storage is blocked by another tab'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode), request = operation(tx.objectStore('drafts'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Image storage failed')); };
  });
}
export async function readImageDraft(key: string): Promise<ImageDraft | null> {
  const cached = drafts.get(key); if (cached) return cached;
  await writes.get(key);
  try {
    const value: unknown = await transaction('readonly', store => store.get(key));
    const stored = value as StoredDraft | ImageDraft | undefined;
    let draft: ImageDraft | undefined;
    if (stored?.version === 2 && stored.fileData instanceof ArrayBuffer && stored.fileData.byteLength <= 25 * 1024 * 1024 && typeof stored.mime === 'string') {
      const { fileData, mime, version, ...metadata } = stored;
      draft = { ...metadata, version: 1, file: new Blob([fileData], { type: mime }) };
    } else if (stored?.version === 1) draft = stored;
    if (!draft || draft.version !== 1 || !(draft.file instanceof Blob) || draft.file.size > 25 * 1024 * 1024 || typeof draft.name !== 'string' || !Number.isFinite(draft.saved) || draft.saved > Date.now() + 300000 || Date.now() - draft.saved > DAY || !draft.retain) {
      await transaction('readwrite', store => store.delete(key)); return null;
    }
    if (draft.model && draft.model !== "general" && draft.model !== "portrait" && draft.model !== "detail") return null;
    if (draft.mask && (!(draft.mask instanceof Uint8ClampedArray) || draft.mask.byteLength > 2560 * 2560)) return null;
    drafts.set(key, draft); return draft;
  } catch { return null; }
}
export async function saveImageDraft(key: string, value: ImageDraft): Promise<boolean> {
  const bytes = value.file.size + (value.mask?.byteLength || 0);
  if (bytes > LIMIT) return false;
  const snapshot = { ...value };
  drafts.delete(key);
  let used = bytes + [...drafts.values()].reduce((sum, draft) => sum + draft.file.size + (draft.mask?.byteLength || 0), 0);
  for (const [other, draft] of drafts) {
    if (used <= LIMIT) break;
    used -= draft.file.size + (draft.mask?.byteLength || 0); drafts.delete(other);
  }
  drafts.set(key, snapshot);
  return enqueue(key, async () => {
  try {
    if (snapshot.retain) {
      // WebKit can reject Blob/File structured clones; ArrayBuffer storage works across tested engines.
      const { file, version, ...metadata } = snapshot;
      const stored: StoredDraft = { ...metadata, version: 2, mime: file.type, fileData: await file.arrayBuffer() };
      await transaction('readwrite', store => store.put(stored, key));
    }
    else await transaction('readwrite', store => store.delete(key));
    return true;
  } catch { return false; }
  });
}
export async function clearImageDraft(key: string): Promise<boolean> {
  drafts.delete(key);
  return enqueue(key, async () => {
    try { await transaction('readwrite', store => store.delete(key)); return true; } catch { return false; }
  });
}

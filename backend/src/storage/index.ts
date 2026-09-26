import { LocalStorageProvider } from './local';
import { SupabaseStorageProvider } from './supabase';

export interface StoredObject {
  path: string;
  size: number;
}

export interface StorageProvider {
  // opts.cacheControl: max-age in seconds for providers that store it with
  // the object (Supabase). The local provider serves /uploads through
  // express.static, where app.ts sets headers instead. Only image
  // derivatives (storage/derivatives.ts) pass it; originals never do.
  upload(path: string, buffer: Buffer, mimeType: string, opts?: { cacheControl?: string }): Promise<void>;
  // Store a file that is already on local disk (a multer temp file) without
  // reading it all into memory — the large-upload path (lib/uploadLimits.ts
  // allows 300 MB). Throws StorageTooLargeError when the storage service
  // refuses the object for its size.
  uploadFile(path: string, localFilePath: string, mimeType: string): Promise<void>;
  // Read one object's bytes. Used by the derivative backfill to read an
  // original (never to modify it).
  download(path: string): Promise<Buffer>;
  // opts.download: serve the object as an attachment (Content-Disposition)
  // under the given filename rather than inline — used for non-image
  // library files so an uploaded HTML/PDF/etc. can never render as a page
  // on the storage origin.
  getPublicUrl(path: string, opts?: { download?: string }): string;
  delete(path: string): Promise<void>;
  // Read-only enumeration of every object whose path starts with `prefix`
  // ('' = everything), recursively, sorted by path. Used by the storage
  // inventory (storage/inventory.ts); never deletes.
  list(prefix: string): Promise<StoredObject[]>;
}

// The storage service refused an object because of its size (e.g. a
// Supabase project whose global file size limit is below the app's own).
export class StorageTooLargeError extends Error {
  constructor(message = 'The file is larger than the storage service allows') {
    super(message);
    this.name = 'StorageTooLargeError';
  }
}

let _provider: StorageProvider | null = null;

// Static imports (not the lazy require() this used to do) — neither
// provider module has a load-time side effect (SupabaseStorageProvider's
// client() factory only runs inside its methods, never at import), and a
// runtime require() here breaks under vitest's Vite-based ESM transform
// (module resolution at test time differs from tsc's CommonJS output),
// which surfaced as every asset-upload integration test failing with
// "Cannot find module './local'" despite `npm run build`/`node dist/...`
// working fine — the two module systems just resolve relative requires
// differently. A static import works correctly under both.
export function getStorage(): StorageProvider {
  if (_provider) return _provider;

  const hasUrl = Boolean(process.env.SUPABASE_URL);
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  _provider = hasUrl && hasKey ? new SupabaseStorageProvider() : new LocalStorageProvider();
  return _provider;
}

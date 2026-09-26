import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { StorageTooLargeError, type StorageProvider, type StoredObject } from './index';

// Files up to this size keep the original buffered upload (the path every
// existing upload has always used); larger ones stream from disk so a
// 300 MB upload never has to be held in memory.
const BUFFERED_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

function isTooLarge(error: { message?: string; statusCode?: string | number } | null | undefined): boolean {
  if (!error) return false;
  return String(error.statusCode ?? '') === '413' || /maximum allowed size|payload too large|too large/i.test(error.message ?? '');
}

function client() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET ?? 'dna-media';

export class SupabaseStorageProvider implements StorageProvider {
  async upload(path: string, buffer: Buffer, mimeType: string, opts?: { cacheControl?: string }): Promise<void> {
    const { error } = await client().storage
      .from(bucket())
      .upload(path, buffer, { contentType: mimeType, upsert: true, ...(opts?.cacheControl ? { cacheControl: opts.cacheControl } : {}) });
    if (error) {
      console.error('Supabase storage upload error:', error);
      if (isTooLarge(error as { message?: string; statusCode?: string })) throw new StorageTooLargeError();
      throw new Error(`Storage upload failed: ${error.message}`);
    }
  }

  async uploadFile(path: string, localFilePath: string, mimeType: string): Promise<void> {
    const { size } = await fs.promises.stat(localFilePath);
    if (size <= BUFFERED_UPLOAD_MAX_BYTES) {
      return this.upload(path, await fs.promises.readFile(localFilePath), mimeType);
    }
    // storage-js sends a Node stream with duplex: 'half' (chunked), so the
    // server's memory use stays at a few stream chunks, not the file size.
    const { error } = await client().storage
      .from(bucket())
      .upload(path, fs.createReadStream(localFilePath), { contentType: mimeType, upsert: true, duplex: 'half' });
    if (error) {
      console.error('Supabase storage streamed upload error:', error);
      if (isTooLarge(error as { message?: string; statusCode?: string })) throw new StorageTooLargeError();
      throw new Error(`Storage upload failed: ${error.message}`);
    }
  }

  async download(path: string): Promise<Buffer> {
    const { data, error } = await client().storage.from(bucket()).download(path);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`);
    return Buffer.from(await data.arrayBuffer());
  }

  getPublicUrl(path: string, opts?: { download?: string }): string {
    const { data } = client().storage.from(bucket()).getPublicUrl(
      path,
      opts?.download ? { download: opts.download } : undefined,
    );
    return data.publicUrl;
  }

  async delete(path: string): Promise<void> {
    const { error } = await client().storage.from(bucket()).remove([path]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }

  // Supabase's list() is one folder at a time (folders come back with a
  // null id), paginated — walk it recursively. Read-only.
  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    const cut = prefix.lastIndexOf('/');
    const folders = [cut >= 0 ? prefix.slice(0, cut) : ''];
    const PAGE = 1000;
    while (folders.length) {
      const folder = folders.pop()!;
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await client().storage.from(bucket()).list(folder, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw new Error(`Storage list failed for "${folder}": ${error.message}`);
        for (const entry of data ?? []) {
          const full = folder ? `${folder}/${entry.name}` : entry.name;
          if (entry.id === null) {
            if (prefix.startsWith(`${full}/`) || `${full}/`.startsWith(prefix)) folders.push(full);
          } else if (full.startsWith(prefix)) {
            out.push({ path: full, size: Number((entry.metadata as { size?: number } | null)?.size ?? 0) });
          }
        }
        if (!data || data.length < PAGE) break;
      }
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}

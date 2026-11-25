import fs from 'fs';
import path from 'path';
import type { StorageProvider, StoredObject } from './index';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Resolve a storage-relative path and guarantee it stays inside UPLOADS_DIR,
// so a maliciously crafted path (e.g. containing "../") can't escape.
function resolveWithin(filePath: string): string {
  const full = path.resolve(UPLOADS_DIR, filePath);
  const root = path.resolve(UPLOADS_DIR);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Invalid storage path');
  }
  return full;
}

export class LocalStorageProvider implements StorageProvider {
  async upload(filePath: string, buffer: Buffer): Promise<void> {
    const full = resolveWithin(filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
  }

  // copyFile streams in the kernel/libuv — the file never sits in JS memory.
  async uploadFile(filePath: string, localFilePath: string): Promise<void> {
    const full = resolveWithin(filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    await fs.promises.copyFile(localFilePath, full);
  }

  async download(filePath: string): Promise<Buffer> {
    return fs.readFileSync(resolveWithin(filePath));
  }

  // opts is accepted for interface parity only: app.ts already serves every
  // /uploads object with Content-Disposition: attachment.
  getPublicUrl(filePath: string, _opts?: { download?: string }): string {
    const base = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    return `${base}/uploads/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    const full = resolveWithin(filePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const root = path.resolve(UPLOADS_DIR);
    if (!fs.existsSync(root)) return [];
    const out: StoredObject[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) {
          const rel = path.relative(root, full).split(path.sep).join('/');
          if (rel.startsWith(prefix)) out.push({ path: rel, size: fs.statSync(full).size });
        }
      }
    };
    walk(root);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}

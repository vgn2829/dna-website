import fs from 'fs';
import path from 'path';
import type { StorageProvider } from './index';

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

  getPublicUrl(filePath: string): string {
    const base = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    return `${base}/uploads/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    const full = resolveWithin(filePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}

import fs from 'fs';
import path from 'path';
import type { StorageProvider } from './index';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

export class LocalStorageProvider implements StorageProvider {
  async upload(filePath: string, buffer: Buffer): Promise<void> {
    const full = path.join(UPLOADS_DIR, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
  }

  getPublicUrl(filePath: string): string {
    const base = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    return `${base}/uploads/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    const full = path.join(UPLOADS_DIR, filePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}

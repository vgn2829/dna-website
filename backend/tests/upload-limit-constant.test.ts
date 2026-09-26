import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, exceedsUploadLimit } from '../src/lib/uploadLimits';

// 5: the one application upload limit, and proof the frontend reads the same
// module instead of a copy (src/app/lib/uploadLimits.ts re-exports it).
describe('upload limit constant', () => {
  it('is exactly 300 MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(300 * 1024 * 1024);
    expect(MAX_UPLOAD_LABEL).toBe('300 MB');
    expect(exceedsUploadLimit(MAX_UPLOAD_BYTES)).toBe(false);
    expect(exceedsUploadLimit(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });

  it('the frontend re-exports this module rather than redefining the number', () => {
    const frontend = fs.readFileSync(path.resolve(__dirname, '../../src/app/lib/uploadLimits.ts'), 'utf8');
    expect(frontend).toMatch(/export \* from '\.\.\/\.\.\/\.\.\/backend\/src\/lib\/uploadLimits';/);
    expect(frontend).not.toMatch(/1024\s*\*\s*1024/);
  });

  it('both upload routes use the shared disk-streaming helper, not an in-memory multer', () => {
    for (const route of ['assets.ts', 'artworks.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '../src/routes', route), 'utf8');
      expect(src, route).not.toMatch(/memoryStorage/);
      expect(src, route).toMatch(/diskUpload(Single|Fields)\(/);
    }
  });
});

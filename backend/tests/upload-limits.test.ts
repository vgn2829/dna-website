import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────
// Upload size limit at the exact boundary — asset library AND gallery —
// through the real routes, multer disk streaming and handlers.
//
// The limit is MAX_UPLOAD_BYTES (300 MB) in lib/uploadLimits.ts. Streaming
// 300 MB through every test would be slow and pointless, so this file swaps
// that ONE shared constant for 64 KiB before any route module loads; the
// code under test (multer's fileSize ceiling, the handlers' re-checks, the
// 413 responses, temp-file cleanup) is exactly the production code. The
// real value is asserted separately in upload-limit-constant.test.ts.
// ─────────────────────────────────────────────────────────────────────────

const TEST_LIMIT = 64 * 1024;
vi.mock('../src/lib/uploadLimits', () => ({
  MAX_UPLOAD_BYTES: TEST_LIMIT,
  MAX_UPLOAD_LABEL: '300 MB',
  exceedsUploadLimit: (bytes: number) => bytes > TEST_LIMIT,
}));

const { localRequest } = await import('./localServer');
const { createApp } = await import('../src/app');
const { query } = await import('../src/db/client');
const { signStudentToken } = await import('../src/middleware/studentAuth');
const storageModule = await import('../src/storage');
const { settleDerivativeJobs } = await import('../src/storage/derivatives');

const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const TMP_DIR = path.join(os.tmpdir(), 'dna-uploads');
const tempFiles = () => (fs.existsSync(TMP_DIR) ? fs.readdirSync(TMP_DIR) : []);

// A file of exactly `size` bytes that passes the JPEG magic-number check.
const jpegOfSize = (size: number) => { const b = Buffer.alloc(size, 7); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; return b; };

let adminToken: string;
let ws: string;

beforeAll(async () => {
  const res = await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD });
  adminToken = res.body.token;
});

beforeEach(async () => {
  await query('TRUNCATE "assets", "workspace_members", "workspaces", "artworks" CASCADE');
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ('UPL1', 'IITK-DnA-UPL1-AAAA', '01 Jan 2026', 'Uploader', 'upl1@iitk.ac.in') ON CONFLICT DO NOTHING`
  );
  ws = (await request(app).post('/api/workspaces').set(auth('UPL1')).send({ name: 'Uploads' })).body.id;
});

afterEach(async () => { await settleDerivativeJobs(); vi.restoreAllMocks(); });

const uploadAsset = (buf: Buffer, name = 'big.zip', kind: 'file' | undefined = 'file') => {
  const req = request(app).post('/api/assets').set(auth('UPL1')).field('workspace_id', ws);
  if (kind) req.field('kind', kind);
  return req.attach('file', buf, { filename: name, contentType: 'application/zip' });
};
const uploadArtwork = (buf: Buffer) =>
  request(app).post('/api/artworks').set('Authorization', `Bearer ${adminToken}`)
    .field('title', 'Poster').field('artist', 'A').field('domain', 'UI/UX')
    .attach('file', buf, { filename: 'poster.jpg', contentType: 'image/jpeg' });

describe('asset library uploads', () => {
  it('1: a file exactly at the limit is accepted', async () => {
    const res = await uploadAsset(Buffer.alloc(TEST_LIMIT, 1));
    expect(res.status).toBe(201);
    expect(res.body.size_bytes).toBe(TEST_LIMIT);
  });

  it('2: one byte over the limit is rejected with 413 before anything is stored', async () => {
    const uploadSpy = vi.spyOn(storageModule.getStorage(), 'uploadFile');
    const res = await uploadAsset(Buffer.alloc(TEST_LIMIT + 1, 1));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('File exceeds the 300 MB limit');
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(await query('SELECT 1 FROM assets')).toHaveLength(0);
  });

  it('images share the same limit', async () => {
    expect((await uploadAsset(jpegOfSize(TEST_LIMIT), 'photo.jpg', undefined)).status).toBe(201);
    expect((await uploadAsset(jpegOfSize(TEST_LIMIT + 1), 'photo2.jpg', undefined)).status).toBe(413);
  });

  it('a storage-service size refusal becomes a clear 413, not a 500', async () => {
    vi.spyOn(storageModule.getStorage(), 'uploadFile').mockRejectedValue(new storageModule.StorageTooLargeError());
    const res = await uploadAsset(Buffer.alloc(1024, 1));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/storage service/);
    expect(await query('SELECT 1 FROM assets')).toHaveLength(0);
  });

  it('temp files never outlive the request (accepted, rejected, and after the thumbnail job)', async () => {
    const before = new Set(tempFiles());
    await uploadAsset(Buffer.alloc(TEST_LIMIT, 1));
    await uploadAsset(Buffer.alloc(TEST_LIMIT + 1, 1));
    await uploadAsset(jpegOfSize(2048), 'thumb-me.jpg', undefined);
    await settleDerivativeJobs();
    await new Promise(r => setTimeout(r, 100));
    expect(tempFiles().filter(f => !before.has(f))).toEqual([]);
  });
});

describe('gallery artwork uploads', () => {
  it('3: a file exactly at the limit is accepted', async () => {
    const res = await uploadArtwork(jpegOfSize(TEST_LIMIT));
    expect(res.status).toBe(201);
    const row = await query<{ file_size: string }>('SELECT file_size FROM artworks'); // BIGINT → string
    expect(Number(row[0].file_size)).toBe(TEST_LIMIT);
  });

  it('4: one byte over the limit is rejected with 413 and nothing is stored', async () => {
    const uploadSpy = vi.spyOn(storageModule.getStorage(), 'uploadFile');
    const res = await uploadArtwork(jpegOfSize(TEST_LIMIT + 1));
    expect(res.status).toBe(413);
    expect(res.body.message).toBe('File exceeds the 300 MB limit');
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(await query('SELECT 1 FROM artworks')).toHaveLength(0);
  });

  it('content is still checked against the extension (magic bytes read from disk)', async () => {
    const res = await uploadArtwork(Buffer.alloc(2048, 7));
    expect(res.status).toBe(400);
  });

  it('a storage-service size refusal becomes a clear 413', async () => {
    vi.spyOn(storageModule.getStorage(), 'uploadFile').mockRejectedValue(new storageModule.StorageTooLargeError());
    const res = await uploadArtwork(jpegOfSize(1024));
    expect(res.status).toBe(413);
    expect(await query('SELECT 1 FROM artworks')).toHaveLength(0);
  });

  it('only admins can upload to the gallery', async () => {
    const res = await request(app).post('/api/artworks').set(auth('UPL1'))
      .field('title', 'x').field('domain', 'UI/UX').attach('file', jpegOfSize(1024), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });
});

describe('route-specific: other endpoints keep their small body limits', () => {
  it('a JSON body far below 300 MB is still refused by the general 100 KB parser', async () => {
    const res = await request(app).post('/api/workspaces').set(auth('UPL1'))
      .set('Content-Type', 'application/json').send(JSON.stringify({ name: 'x'.repeat(200 * 1024) }));
    expect(res.status).toBe(413);
  });
});

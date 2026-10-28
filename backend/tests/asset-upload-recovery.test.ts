import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';
import { settleDerivativeJobs } from '../src/storage/derivatives';

// Real HTTP, isolated Postgres and local storage. These checks prove the
// application lifecycle, not the deployed Supabase project's size settings.
const app = createApp();
const request = localRequest(app);
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const OWNER = 'RECOVERY1';
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

function upload(roll: string, ws: string, opts: { visibility?: string; clientUploadId?: string; name?: string; bytes?: Buffer; type?: string; kind?: string } = {}) {
  const req = request(app).post('/api/assets').set(auth(roll)).field('workspace_id', ws);
  if (opts.visibility) req.field('visibility', opts.visibility);
  if (opts.clientUploadId) req.field('client_upload_id', opts.clientUploadId);
  if (opts.kind) req.field('kind', opts.kind);
  return req.attach('file', opts.bytes ?? PNG_1PX, { filename: opts.name ?? 'mark.png', contentType: opts.type ?? (opts.kind === 'file' ? 'application/octet-stream' : 'image/png') });
}

const rowOf = async (id: string) => (await query<{ owner_roll: string; workspace_id: string; storage_key: string; visibility: string; status: string }>(
  'SELECT owner_roll, workspace_id, storage_key, visibility, status FROM assets WHERE id = $1', [id]))[0];
const objectExists = (key: string) => fs.existsSync(path.join(UPLOADS_DIR, key));

let ws: string;
beforeEach(async () => {
  await query('TRUNCATE "assets", "workspaces" CASCADE');
  await registerStudent(OWNER);
  ws = (await request(app).post('/api/workspaces').set(auth(OWNER)).send({ name: 'Upload recovery' })).body.id as string;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleDerivativeJobs();
});

describe('large uploads and connection recovery', () => {
  it('the local pipeline accepts the full 300 MiB limit without buffering the request', async () => {
    const os = await import('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dna-large-test-'));
    const file = path.join(dir, 'limit.zip');
    const size = 300 * 1024 * 1024;
    fs.writeFileSync(file, '');
    fs.truncateSync(file, size);
    try {
      const res = await request(app).post('/api/assets').set(auth(OWNER))
        .field('workspace_id', ws).field('kind', 'file')
        .attach('file', file);
      expect(res.status).toBe(201);
      expect(res.body.size_bytes).toBe(size);
      expect(fs.statSync(path.join(UPLOADS_DIR, (await rowOf(res.body.id)).storage_key)).size).toBe(size);
    } finally { fs.rmSync(dir, { recursive: true }); }
  }, 30000);

  it('a storage failure creates no metadata, reports its stage and retries safely', async () => {
    const store = vi.spyOn(storageModule.getStorage(), 'uploadFile').mockRejectedValueOnce(new Error('test storage outage'));
    const opts = { clientUploadId: uuidv4(), name: 'design.psd', kind: 'file' };
    const failed = await upload(OWNER, ws, opts);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/storage service/);
    expect(await query('SELECT id FROM assets')).toHaveLength(0);
    const retry = await upload(OWNER, ws, opts);
    expect(retry.status).toBe(201);
    expect(await query('SELECT id FROM assets')).toHaveLength(1);
    await vi.waitFor(() => expect(fs.existsSync(store.mock.calls[0][1])).toBe(false));
  });

  it('a storage write followed by a lost acknowledgement is cleaned up before retry', async () => {
    const storage = storageModule.getStorage();
    const original = storage.uploadFile.bind(storage);
    const store = vi.spyOn(storage, 'uploadFile').mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('test lost storage acknowledgement');
    });
    const opts = { clientUploadId: uuidv4(), name: 'design.psd', kind: 'file' };
    expect((await upload(OWNER, ws, opts)).status).toBe(502);
    expect(await query('SELECT id FROM assets')).toHaveLength(0);
    expect(objectExists(store.mock.calls[0][0])).toBe(false);
    const retry = await upload(OWNER, ws, opts);
    expect(retry.status).toBe(201);
    expect(await query('SELECT id FROM assets')).toHaveLength(1);
    expect(fs.readdirSync(path.join(UPLOADS_DIR, 'assets', ws))).toHaveLength(1);
  });

  it('a metadata failure removes the stored object and temp file before a safe retry', async () => {
    const { pool } = await import('../src/db/client');
    const original = pool.query.bind(pool);
    const spy = vi.spyOn(pool, 'query').mockImplementation(((sql: unknown, ...args: unknown[]) => {
      if (typeof sql === 'string' && /INSERT INTO assets\s/.test(sql)) return Promise.reject(new Error('test metadata outage'));
      return (original as (...params: unknown[]) => unknown)(sql, ...args);
    }) as typeof pool.query);
    const store = vi.spyOn(storageModule.getStorage(), 'uploadFile');
    const opts = { clientUploadId: uuidv4(), name: 'design.pdf', kind: 'file', type: 'application/pdf' };
    const failed = await upload(OWNER, ws, opts);
    spy.mockRestore();
    expect(failed.status).toBe(500);
    expect(failed.body.error).toMatch(/metadata failed/);
    expect(await query('SELECT id FROM assets')).toHaveLength(0);
    expect(objectExists(store.mock.calls[0][0])).toBe(false);
    await vi.waitFor(() => expect(fs.existsSync(store.mock.calls[0][1])).toBe(false));
    expect((await upload(OWNER, ws, opts)).status).toBe(201);
    expect(await query('SELECT id FROM assets')).toHaveLength(1);
  });

  it('a 70.9 MB PSD completes, and retry returns the same stored asset', async () => {
    const bytes = Buffer.alloc(70_900_000, 3);
    const opts = { clientUploadId: uuidv4(), name: 'large.psd', type: 'image/vnd.adobe.photoshop', kind: 'file', bytes };
    const first = await upload(OWNER, ws, opts);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ kind: 'file', size_bytes: bytes.length, extension: 'psd' });
    expect((await upload(OWNER, ws, opts)).body.id).toBe(first.body.id);
    expect(await query('SELECT id FROM assets')).toHaveLength(1);
    expect(fs.statSync(path.join(UPLOADS_DIR, (await rowOf(first.body.id)).storage_key)).size).toBe(bytes.length);
  }, 30000);

  it('an incomplete incoming multipart upload leaves no row or temp file', async () => {
    const http = await import('http');
    const os = await import('os');
    const tmp = path.join(os.tmpdir(), 'dna-uploads');
    const before = new Set(fs.existsSync(tmp) ? fs.readdirSync(tmp) : []);
    const added = () => fs.existsSync(tmp) ? fs.readdirSync(tmp).filter(f => !before.has(f)) : [];
    const server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as import('net').AddressInfo).port;
    const clientUploadId = uuidv4();
    const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: '/api/assets',
      headers: { ...auth(OWNER), 'Content-Type': 'multipart/form-data; boundary=dna-test' } });
    req.on('error', () => {});
    try {
      req.write(`--dna-test\r\nContent-Disposition: form-data; name="workspace_id"\r\n\r\n${ws}\r\n`);
      req.write(`--dna-test\r\nContent-Disposition: form-data; name="client_upload_id"\r\n\r\n${clientUploadId}\r\n`);
      req.write('--dna-test\r\nContent-Disposition: form-data; name="file"; filename="partial.psd"\r\nContent-Type: application/octet-stream\r\n\r\n');
      req.write(Buffer.alloc(32 * 1024, 3));
      await vi.waitFor(() => expect(added()).toHaveLength(1));
      req.destroy();
      await vi.waitFor(() => expect(added()).toHaveLength(0));
      expect(await query('SELECT id FROM assets')).toHaveLength(0);
      const retry = await upload(OWNER, ws, { clientUploadId, name: 'partial.psd', kind: 'file' });
      expect(retry.status).toBe(201);
    } finally {
      req.destroy();
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('a disconnected response during storage does not delete the temp file out from under the handler', async () => {
    const storage = storageModule.getStorage();
    const original = storage.uploadFile.bind(storage);
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let completed!: () => void;
    const finished = new Promise<void>(r => { completed = r; });
    let tempExists = false;
    vi.spyOn(storage, 'uploadFile').mockImplementation(async (...args) => {
      entered();
      await gate;
      tempExists = fs.existsSync(args[1]);
      try { await original(...args); } finally { completed(); }
    });
    const opts = { clientUploadId: uuidv4(), name: 'interrupted.psd', kind: 'file', type: 'application/octet-stream' };
    const req = upload(OWNER, ws, opts);
    req.end(() => {});
    await started;
    req.abort();
    // Give the server the socket close before allowing storage to read.
    await new Promise(r => setTimeout(r, 100));
    release();
    await finished;
    expect(tempExists).toBe(true);
    // Retry may race the original INSERT; the unique key must resolve it.
    const retry = await upload(OWNER, ws, opts);
    expect([200, 201]).toContain(retry.status);
    expect(await query('SELECT id FROM assets')).toHaveLength(1);
    expect(objectExists((await rowOf(retry.body.id)).storage_key)).toBe(true);
  });

});

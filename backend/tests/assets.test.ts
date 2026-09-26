import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { pool, query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import * as storageModule from '../src/storage';

// ─────────────────────────────────────────────────────────────────────────
// Integration tests against the real (local test) Postgres DB, through the
// actual HTTP router — same style as workspaces.test.ts/boards.test.ts.
// File uploads go through the real LocalStorageProvider (SUPABASE_URL/
// SUPABASE_SERVICE_ROLE_KEY are unset in tests/setup.ts, so getStorage()
// resolves to local disk under backend/uploads/, which is gitignored) —
// never against Supabase. The two storage-FAILURE tests mock '../src/storage'
// directly (this suite's first use of vi.mock — every other test here is a
// real end-to-end integration test) since a real storage failure isn't
// reproducible against a healthy local disk.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4)
     ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

function tokenFor(roll: string): string {
  return signStudentToken(roll);
}

async function createWorkspace(roll: string, name: string): Promise<string> {
  const res = await request(app)
    .post('/api/workspaces')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .send({ name });
  return res.body.id as string;
}

async function uploadPng(roll: string, workspaceId: string, filename = 'test.png', visibility?: 'personal' | 'community') {
  const req = request(app)
    .post('/api/assets')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .field('workspace_id', workspaceId);
  if (visibility) req.field('visibility', visibility);
  return req.attach('file', PNG_1PX, { filename, contentType: 'image/png' });
}

beforeEach(async () => {
  await query('TRUNCATE "assets", "workspace_members", "workspaces", "boards" CASCADE');
});

describe('POST /api/assets — upload', () => {
  it('uploads an asset into a workspace the caller belongs to', async () => {
    await registerStudent('UP1');
    const workspaceId = await createWorkspace('UP1', 'Design');

    const res = await uploadPng('UP1', workspaceId);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspace_id: workspaceId,
      owner_roll: 'UP1',
      filename: 'test.png',
      mime_type: 'image/png',
      width: 1,
      height: 1,
    });
    expect(res.body.url).toBeTruthy();
    expect(res.body.storage_key).toBeUndefined();
  });

  it('rejects unauthenticated upload', async () => {
    await registerStudent('UP2');
    const workspaceId = await createWorkspace('UP2', 'Design');

    const res = await request(app)
      .post('/api/assets')
      .field('workspace_id', workspaceId)
      .attach('file', PNG_1PX, { filename: 'x.png', contentType: 'image/png' });

    expect(res.status).toBe(401);
  });

  it('rejects upload to a workspace the caller is not a member of', async () => {
    await registerStudent('UP3');
    await registerStudent('UP4');
    const workspaceId = await createWorkspace('UP3', 'Design');

    const res = await uploadPng('UP4', workspaceId);

    expect(res.status).toBe(403);
  });

  it('rejects an unsupported MIME type', async () => {
    await registerStudent('UP5');
    const workspaceId = await createWorkspace('UP5', 'Design');

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${tokenFor('UP5')}`)
      .field('workspace_id', workspaceId)
      .attach('file', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
  });

  // The old 15 MB image cap is gone: every library upload shares the 300 MB
  // limit (lib/uploadLimits.ts). The over-limit rejection itself is covered
  // at the boundary in upload-limits.test.ts without allocating 300 MB.
  it('accepts an image above the old 15 MB cap', async () => {
    await registerStudent('UP6');
    const workspaceId = await createWorkspace('UP6', 'Design');

    const large = Buffer.alloc(16 * 1024 * 1024, 1);
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${tokenFor('UP6')}`)
      .field('workspace_id', workspaceId)
      .attach('file', large, { filename: 'large.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.size_bytes).toBe(large.length);
  });

  it('requires workspace_id', async () => {
    await registerStudent('UP7');

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${tokenFor('UP7')}`)
      .attach('file', PNG_1PX, { filename: 'x.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/assets — list', () => {
  it('lists only assets in the requested workspace, newest first', async () => {
    await registerStudent('LIST1');
    const wsA = await createWorkspace('LIST1', 'A');
    const wsB = await createWorkspace('LIST1', 'B');

    await uploadPng('LIST1', wsA, 'first.png');
    await uploadPng('LIST1', wsA, 'second.png');
    await uploadPng('LIST1', wsB, 'other-workspace.png');

    const res = await request(app)
      .get(`/api/assets?workspace_id=${wsA}`)
      .set('Authorization', `Bearer ${tokenFor('LIST1')}`);

    expect(res.status).toBe(200);
    expect(res.body.assets).toHaveLength(2);
    expect(res.body.assets.map((a: { filename: string }) => a.filename)).toEqual(['second.png', 'first.png']);
  });

  it('rejects listing a workspace the caller is not a member of', async () => {
    await registerStudent('LIST2');
    await registerStudent('LIST3');
    const workspaceId = await createWorkspace('LIST2', 'Private');

    const res = await request(app)
      .get(`/api/assets?workspace_id=${workspaceId}`)
      .set('Authorization', `Bearer ${tokenFor('LIST3')}`);

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated list', async () => {
    const res = await request(app).get('/api/assets?workspace_id=whatever');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/assets/:id — metadata', () => {
  it('returns asset metadata for a workspace member', async () => {
    await registerStudent('GET1');
    const workspaceId = await createWorkspace('GET1', 'Design');
    const uploadRes = await uploadPng('GET1', workspaceId);

    const res = await request(app)
      .get(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('GET1')}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(uploadRes.body.id);
  });

  it('404s for a nonexistent asset', async () => {
    await registerStudent('GET2');
    const res = await request(app)
      .get('/api/assets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenFor('GET2')}`);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/assets/:id', () => {
  it('lets the uploader delete their own asset', async () => {
    await registerStudent('DEL1');
    const workspaceId = await createWorkspace('DEL1', 'Design');
    const uploadRes = await uploadPng('DEL1', workspaceId);

    const res = await request(app)
      .delete(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL1')}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const after = await request(app)
      .get(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL1')}`);
    expect(after.status).toBe(404);
  });

  // Shared Creative Library: deletion is the asset OWNER's only — not even
  // a workspace owner/admin may remove a member's asset. A community asset
  // they can see answers 403; a personal one they can't see answers 404.
  it('does not let a workspace owner delete a member-uploaded asset', async () => {
    await registerStudent('DEL2');
    await registerStudent('DEL3');
    const workspaceId = await createWorkspace('DEL2', 'Design');
    await request(app)
      .post(`/api/workspaces/${workspaceId}/members`)
      .set('Authorization', `Bearer ${tokenFor('DEL2')}`)
      .send({ roll_number: 'DEL3' });

    const uploadRes = await uploadPng('DEL3', workspaceId, 'shared.png', 'community');
    const personalRes = await uploadPng('DEL3', workspaceId, 'mine.png');

    const res = await request(app)
      .delete(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL2')}`);
    expect(res.status).toBe(403);

    const hidden = await request(app)
      .delete(`/api/assets/${personalRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL2')}`);
    expect(hidden.status).toBe(404);

    const own = await request(app)
      .delete(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL3')}`);
    expect(own.status).toBe(200);
  });

  it('rejects delete by a plain member who does not own the asset', async () => {
    await registerStudent('DEL4');
    await registerStudent('DEL5');
    const workspaceId = await createWorkspace('DEL4', 'Design');
    await request(app)
      .post(`/api/workspaces/${workspaceId}/members`)
      .set('Authorization', `Bearer ${tokenFor('DEL4')}`)
      .send({ roll_number: 'DEL5' });

    const uploadRes = await uploadPng('DEL4', workspaceId, 'test.png', 'community');

    const res = await request(app)
      .delete(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL5')}`);

    expect(res.status).toBe(403);
  });

  it('rejects delete from a non-member entirely', async () => {
    await registerStudent('DEL6');
    await registerStudent('DEL7');
    const workspaceId = await createWorkspace('DEL6', 'Design');
    const uploadRes = await uploadPng('DEL6', workspaceId);

    const res = await request(app)
      .delete(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL7')}`);

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated delete', async () => {
    await registerStudent('DEL8');
    const workspaceId = await createWorkspace('DEL8', 'Design');
    const uploadRes = await uploadPng('DEL8', workspaceId);

    const res = await request(app).delete(`/api/assets/${uploadRes.body.id}`);
    expect(res.status).toBe(401);
  });

  it('404s deleting a nonexistent asset', async () => {
    await registerStudent('DEL9');
    const res = await request(app)
      .delete('/api/assets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenFor('DEL9')}`);
    expect(res.status).toBe(404);
  });
});

describe('storage failure consistency', () => {
  // These two spy on getStorage() directly — the only tests in this file
  // (or this suite) that mock anything, since a real storage failure isn't
  // reproducible against a healthy local disk. Every other test above
  // exercises the real LocalStorageProvider end-to-end. Spying (not
  // vi.doMock + vi.resetModules) keeps using the same `app`/pool singleton
  // every other test in this file shares, avoiding the module-reset trap
  // where a re-imported db/client picks a fresh, unconfigured pool.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cleans up the uploaded object when the DB insert fails', async () => {
    await registerStudent('SF1');
    const workspaceId = await createWorkspace('SF1', 'Design');

    const deleteSpy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(storageModule, 'getStorage').mockReturnValue({
      upload: vi.fn().mockResolvedValue(undefined),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      getPublicUrl: (p: string) => `http://test/${p}`,
      delete: deleteSpy,
    });

    // Force a deterministic DB insert failure: the route's SELECT
    // (membership check) and INSERT both go through pool.query — reject
    // only statements starting with "INSERT INTO assets", so the
    // membership check above it still succeeds normally and the failure
    // happens exactly where the route's own try/catch expects it (after
    // storage upload, at the DB insert step).
    const originalQuery = pool.query.bind(pool);
    vi.spyOn(pool, 'query').mockImplementation(((text: string, params?: unknown[]) => {
      if (typeof text === 'string' && text.trim().startsWith('INSERT INTO assets')) {
        return Promise.reject(new Error('simulated DB insert failure'));
      }
      return originalQuery(text, params);
    }) as typeof pool.query);

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${tokenFor('SF1')}`)
      .field('workspace_id', workspaceId)
      .attach('file', PNG_1PX, { filename: 'colliding.png', contentType: 'image/png' });

    expect(res.status).toBe(500);
    // The just-uploaded (now-orphaned) object was deleted before the
    // error was surfaced to the client.
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0]).toContain(`assets/${workspaceId}/`);
  });

  it('reports a storage warning (not a bare success) when the object delete fails after the DB row is removed', async () => {
    await registerStudent('SF2');
    const workspaceId = await createWorkspace('SF2', 'Design');
    const uploadRes = await uploadPng('SF2', workspaceId);

    vi.spyOn(storageModule, 'getStorage').mockReturnValue({
      upload: vi.fn().mockResolvedValue(undefined),
      getPublicUrl: (p: string) => `http://test/${p}`,
      delete: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    });

    const res = await request(app)
      .delete(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('SF2')}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storageWarning).toBeTruthy();

    // The DB row is gone regardless of the storage failure — deleting it
    // again 404s, confirming the row-delete-then-storage-delete ordering.
    vi.restoreAllMocks();
    const after = await request(app)
      .get(`/api/assets/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('SF2')}`);
    expect(after.status).toBe(404);
  });
});

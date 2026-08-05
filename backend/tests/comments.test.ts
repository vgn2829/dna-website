import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { CommentBroadcaster } from '../src/realtime/comments/commentBroadcaster';
import type { VersionHistoryService } from '../src/realtime/history/versionHistoryService';
import type { RestoreService } from '../src/realtime/history/restoreService';

// ─────────────────────────────────────────────────────────────────────────
// Integration tests against the real (local test) Postgres DB, through the
// actual HTTP router — same style as tests/rsvp-capacity.test.ts. Comments
// has no interesting timing/decision logic the way VersionHistoryService
// does (see tests/version-history.test.ts's own comment on why THAT suite
// uses fakes) — the thing worth testing here is the permission model and
// the CRUD/resolve/reopen state machine actually enforced by
// routes/comments.ts, which is best proven by hitting the real endpoints.
//
// versionHistoryService/restoreService are passed as unused stubs purely
// so createApp() mounts the realtime routers at all (see app.ts's optional
// `realtime` param) — nothing in this file calls a versions/restore
// endpoint, and commentBroadcaster is a real instance so broadcast() calls
// inside routes/comments.ts run for real (against zero connected sockets,
// which is a documented no-op — see commentBroadcaster.ts).
// ─────────────────────────────────────────────────────────────────────────

const commentBroadcaster = new CommentBroadcaster();
const app = createApp({
  versionHistoryService: {} as VersionHistoryService,
  restoreService: {} as RestoreService,
  commentBroadcaster,
});

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

async function createBoard(opts: {
  ownerRoll: string;
  visibility?: 'private' | 'shared';
  editMode?: 'members_only' | 'anyone';
}): Promise<string> {
  const id = `board-test-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id)
     VALUES ($1, 'Test Board', $2, 'Owner', $3, $4, $5, $5, $6)`,
    [id, opts.ownerRoll, opts.visibility ?? 'private', opts.editMode ?? 'members_only', now, `room-${id}`]
  );
  return id;
}

async function addMember(boardId: string, roll: string): Promise<void> {
  await query(
    `INSERT INTO board_members (board_id, roll_number, name, added_at)
     VALUES ($1, $2, $3, $4)`,
    [boardId, roll, `Student ${roll}`, new Date().toISOString()]
  );
}

beforeEach(async () => {
  await query('TRUNCATE "board_comments", "board_members", "boards" CASCADE');
});

describe('Comments — creation and reading', () => {
  it('lets the owner create a canvas-anchored thread root', async () => {
    await registerStudent('OWNER01');
    const boardId = await createBoard({ ownerRoll: 'OWNER01' });

    const res = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('OWNER01')}`)
      .send({ content: 'First comment', anchorType: 'canvas', anchorX: 100, anchorY: 200 });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe('First comment');
    expect(res.body.anchorType).toBe('canvas');
    expect(res.body.anchorX).toBe(100);
    expect(res.body.parentCommentId).toBeNull();
    expect(res.body.resolvedAt).toBeNull();
  });

  it('lets a shape-anchored comment carry its shape id', async () => {
    await registerStudent('OWNER02');
    const boardId = await createBoard({ ownerRoll: 'OWNER02' });

    const res = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('OWNER02')}`)
      .send({ content: 'On this shape', anchorType: 'shape', anchorShapeId: 'shape:abc123', anchorX: 10, anchorY: 20 });

    expect(res.status).toBe(201);
    expect(res.body.anchorType).toBe('shape');
    expect(res.body.anchorShapeId).toBe('shape:abc123');
  });

  it('rejects a new thread with no anchor', async () => {
    await registerStudent('OWNER03');
    const boardId = await createBoard({ ownerRoll: 'OWNER03' });

    const res = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('OWNER03')}`)
      .send({ content: 'No anchor' });

    expect(res.status).toBe(400);
  });

  it('a reply inherits the root thread\'s anchor', async () => {
    await registerStudent('OWNER04');
    const boardId = await createBoard({ ownerRoll: 'OWNER04' });

    const root = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('OWNER04')}`)
      .send({ content: 'Root', anchorType: 'canvas', anchorX: 55, anchorY: 66 });

    const reply = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('OWNER04')}`)
      .send({ content: 'A reply', parentCommentId: root.body.id });

    expect(reply.status).toBe(201);
    expect(reply.body.parentCommentId).toBe(root.body.id);
    expect(reply.body.anchorX).toBe(55);
    expect(reply.body.anchorY).toBe(66);
  });

  it('rejects a reply to a nonexistent thread', async () => {
    await registerStudent('OWNER05');
    const boardId = await createBoard({ ownerRoll: 'OWNER05' });

    const res = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('OWNER05')}`)
      .send({ content: 'orphan reply', parentCommentId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
  });

  it('lists comments in creation order, excluding resolved threads by default', async () => {
    await registerStudent('OWNER06');
    const boardId = await createBoard({ ownerRoll: 'OWNER06' });
    const auth = { Authorization: `Bearer ${tokenFor('OWNER06')}` };

    const a = await request(app).post(`/api/boards/${boardId}/comments`).set(auth)
      .send({ content: 'A', anchorType: 'canvas', anchorX: 0, anchorY: 0 });
    await request(app).post(`/api/boards/${boardId}/comments`).set(auth)
      .send({ content: 'B', anchorType: 'canvas', anchorX: 1, anchorY: 1 });

    await request(app).post(`/api/boards/${boardId}/comments/${a.body.id}/resolve`).set(auth).send({});

    const list = await request(app).get(`/api/boards/${boardId}/comments`).set(auth);
    expect(list.status).toBe(200);
    expect(list.body.comments.map((c: { content: string }) => c.content)).toEqual(['B']);

    const listAll = await request(app).get(`/api/boards/${boardId}/comments?includeResolved=true`).set(auth);
    expect(listAll.body.comments.map((c: { content: string }) => c.content)).toEqual(['A', 'B']);
  });
});

describe('Comments — permissions', () => {
  it('denies a non-member on a private board from reading or creating', async () => {
    await registerStudent('OWNER10');
    await registerStudent('STRANGER10');
    const boardId = await createBoard({ ownerRoll: 'OWNER10', visibility: 'private' });

    const read = await request(app)
      .get(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('STRANGER10')}`);
    expect(read.status).toBe(403);

    const create = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('STRANGER10')}`)
      .send({ content: 'Sneaky', anchorType: 'canvas', anchorX: 0, anchorY: 0 });
    expect(create.status).toBe(403);
  });

  it('lets any signed-in student comment on a shared board even without membership (Viewer/Commenter tier)', async () => {
    await registerStudent('OWNER11');
    await registerStudent('VIEWER11');
    const boardId = await createBoard({ ownerRoll: 'OWNER11', visibility: 'shared', editMode: 'members_only' });

    const res = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER11')}`)
      .send({ content: 'Nice board!', anchorType: 'canvas', anchorX: 5, anchorY: 5 });

    expect(res.status).toBe(201);
  });

  it('does NOT let a read-only viewer resolve a thread (requires board-edit access)', async () => {
    await registerStudent('OWNER12');
    await registerStudent('VIEWER12');
    const boardId = await createBoard({ ownerRoll: 'OWNER12', visibility: 'shared', editMode: 'members_only' });

    const root = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER12')}`)
      .send({ content: 'Root', anchorType: 'canvas', anchorX: 0, anchorY: 0 });

    const resolve = await request(app)
      .post(`/api/boards/${boardId}/comments/${root.body.id}/resolve`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER12')}`)
      .send({});

    expect(resolve.status).toBe(403);
  });

  it('lets a board member (editor) resolve and reopen a thread created by someone else', async () => {
    await registerStudent('OWNER13');
    await registerStudent('MEMBER13');
    const boardId = await createBoard({ ownerRoll: 'OWNER13', visibility: 'shared' });
    await addMember(boardId, 'MEMBER13');

    const root = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('OWNER13')}`)
      .send({ content: 'Root', anchorType: 'canvas', anchorX: 0, anchorY: 0 });

    const resolve = await request(app)
      .post(`/api/boards/${boardId}/comments/${root.body.id}/resolve`)
      .set('Authorization', `Bearer ${tokenFor('MEMBER13')}`)
      .send({});
    expect(resolve.status).toBe(200);
    expect(resolve.body.resolvedAt).not.toBeNull();
    expect(resolve.body.resolvedByRoll).toBe('MEMBER13');

    const reopen = await request(app)
      .post(`/api/boards/${boardId}/comments/${root.body.id}/reopen`)
      .set('Authorization', `Bearer ${tokenFor('MEMBER13')}`)
      .send({});
    expect(reopen.status).toBe(200);
    expect(reopen.body.resolvedAt).toBeNull();
  });

  it('rejects resolving a reply (only thread roots can be resolved)', async () => {
    await registerStudent('OWNER14');
    const boardId = await createBoard({ ownerRoll: 'OWNER14' });
    const auth = { Authorization: `Bearer ${tokenFor('OWNER14')}` };

    const root = await request(app).post(`/api/boards/${boardId}/comments`).set(auth)
      .send({ content: 'Root', anchorType: 'canvas', anchorX: 0, anchorY: 0 });
    const reply = await request(app).post(`/api/boards/${boardId}/comments`).set(auth)
      .send({ content: 'Reply', parentCommentId: root.body.id });

    const resolve = await request(app).post(`/api/boards/${boardId}/comments/${reply.body.id}/resolve`).set(auth).send({});
    expect(resolve.status).toBe(400);
  });

  it('lets a comment\'s own author edit and delete it even without board-edit access', async () => {
    await registerStudent('OWNER15');
    await registerStudent('VIEWER15');
    const boardId = await createBoard({ ownerRoll: 'OWNER15', visibility: 'shared', editMode: 'members_only' });

    const created = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER15')}`)
      .send({ content: 'My own comment', anchorType: 'canvas', anchorX: 0, anchorY: 0 });

    const edit = await request(app)
      .put(`/api/boards/${boardId}/comments/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER15')}`)
      .send({ content: 'Edited by author' });
    expect(edit.status).toBe(200);
    expect(edit.body.content).toBe('Edited by author');

    const del = await request(app)
      .delete(`/api/boards/${boardId}/comments/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER15')}`);
    expect(del.status).toBe(200);

    const list = await request(app)
      .get(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('OWNER15')}`);
    expect(list.body.comments).toHaveLength(0);
  });

  it('does NOT let a different non-editing viewer edit or delete someone else\'s comment', async () => {
    await registerStudent('OWNER16');
    await registerStudent('VIEWER16A');
    await registerStudent('VIEWER16B');
    const boardId = await createBoard({ ownerRoll: 'OWNER16', visibility: 'shared', editMode: 'members_only' });

    const created = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER16A')}`)
      .send({ content: 'Not yours', anchorType: 'canvas', anchorX: 0, anchorY: 0 });

    const edit = await request(app)
      .put(`/api/boards/${boardId}/comments/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER16B')}`)
      .send({ content: 'Hijacked' });
    expect(edit.status).toBe(403);

    const del = await request(app)
      .delete(`/api/boards/${boardId}/comments/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER16B')}`);
    expect(del.status).toBe(403);
  });

  it('the board owner can delete any comment, including one they did not author', async () => {
    await registerStudent('OWNER17');
    await registerStudent('VIEWER17');
    const boardId = await createBoard({ ownerRoll: 'OWNER17', visibility: 'shared', editMode: 'members_only' });

    const created = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('VIEWER17')}`)
      .send({ content: 'Will be moderated', anchorType: 'canvas', anchorX: 0, anchorY: 0 });

    const del = await request(app)
      .delete(`/api/boards/${boardId}/comments/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('OWNER17')}`);
    expect(del.status).toBe(200);
  });
});

describe('Comments — soft delete preserves reply threads', () => {
  it('keeps replies visible (and their parent resolvable via history) after the root is soft-deleted', async () => {
    await registerStudent('OWNER20');
    const boardId = await createBoard({ ownerRoll: 'OWNER20' });
    const auth = { Authorization: `Bearer ${tokenFor('OWNER20')}` };

    const root = await request(app).post(`/api/boards/${boardId}/comments`).set(auth)
      .send({ content: 'Root', anchorType: 'canvas', anchorX: 0, anchorY: 0 });
    const reply = await request(app).post(`/api/boards/${boardId}/comments`).set(auth)
      .send({ content: 'Reply', parentCommentId: root.body.id });

    const del = await request(app).delete(`/api/boards/${boardId}/comments/${root.body.id}`).set(auth);
    expect(del.status).toBe(200);

    // The root is gone from the default (non-deleted) list, but the reply
    // row itself was never touched — soft-deleting the root must not
    // cascade-delete or orphan its replies (see commentsStorage.ts's own
    // comment on why this is a soft delete, not a hard one).
    const list = await request(app).get(`/api/boards/${boardId}/comments?includeResolved=true`).set(auth);
    const ids = list.body.comments.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(root.body.id);
    expect(ids).toContain(reply.body.id);
  });
});

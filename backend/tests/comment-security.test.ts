import { describe, it, expect, beforeEach } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { CommentBroadcaster } from '../src/realtime/comments/commentBroadcaster';
import type { VersionHistoryService } from '../src/realtime/history/versionHistoryService';
import type { RestoreService } from '../src/realtime/history/restoreService';

// ─────────────────────────────────────────────────────────────────────────
// COMMENT MUTATION AUTHORIZATION (V2.6 Phase A).
//
// THE VULNERABILITY THIS LOCKS DOWN, reproduced against this exact router
// before it was fixed: PUT and DELETE checked `isAuthor` FIRST and skipped
// getBoardRole entirely when it was true. A user whose board access had
// been revoked could therefore keep editing and soft-deleting their own
// comments indefinitely — both returned 200, and the database row was
// genuinely mutated (content replaced, deleted_at set) — with each
// mutation also broadcasting to every collaborator still on the board.
//
// The rule is now: CURRENT board access is verified unconditionally, THEN
// the pre-existing author/moderator policy is applied on top. Authorship
// narrows an existing permission; it never substitutes for one. This is
// the comment-channel half of the same invariant V2.5 established for
// canvas writes.
//
// These tests run against the real router and the real test database, in
// the style of the existing comments.test.ts suite.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp({
  versionHistoryService: {} as VersionHistoryService,
  restoreService: {} as RestoreService,
  commentBroadcaster: new CommentBroadcaster(),
});
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);

const tokenFor = (roll: string) => signStudentToken(roll);
const auth = (roll: string) => ({ Authorization: `Bearer ${tokenFor(roll)}` });

const OWNER = '230437';
const MEMBER = '240280';
const OUTSIDER = '999999';

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

async function createBoard(opts: {
  ownerRoll: string; visibility?: 'private' | 'shared'; editMode?: 'members_only' | 'anyone';
}): Promise<string> {
  const id = `board-sec-${Math.random().toString(36).slice(2, 10)}`;
  const wsId = `ws-sec-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1,'WS',true,$2,$3)`,
    [wsId, opts.ownerRoll, now]
  );
  await query(
    `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1,$2,'owner','Owner',$3)`,
    [wsId, opts.ownerRoll, now]
  );
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, workspace_id)
     VALUES ($1,'Sec Board',$2,'Owner',$3,$4,$5,$5,$6,$7)`,
    [id, opts.ownerRoll, opts.visibility ?? 'private', opts.editMode ?? 'members_only', now, `room-${id}`, wsId]
  );
  return id;
}

const addMember = (boardId: string, roll: string) => query(
  `INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1,$2,$3,$4)`,
  [boardId, roll, `Student ${roll}`, new Date().toISOString()]
);

const revoke = (boardId: string, roll: string) =>
  query('DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2', [boardId, roll]);

async function postComment(boardId: string, roll: string, content = 'hello'): Promise<string> {
  const res = await request(app)
    .post(`/api/boards/${boardId}/comments`).set(auth(roll))
    .send({ content, anchorType: 'canvas', anchorX: 5, anchorY: 5 });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

beforeEach(async () => {
  await query('TRUNCATE "board_comments","board_members","boards","workspace_members","workspaces" CASCADE');
  process.env.REALTIME_ENABLED = 'true';
  await Promise.all([registerStudent(OWNER), registerStudent(MEMBER), registerStudent(OUTSIDER)]);
});

describe('comment mutation authorization', () => {
  // (1)(2)(3) the authorized happy path must keep working.
  it('lets an authorized member create, edit and delete their own comment', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER });
    await addMember(boardId, MEMBER);
    const id = await postComment(boardId, MEMBER);

    const edit = await request(app)
      .put(`/api/boards/${boardId}/comments/${id}`).set(auth(MEMBER))
      .send({ content: 'edited by author' });
    expect(edit.status).toBe(200);
    expect(edit.body.content).toBe('edited by author');

    const del = await request(app)
      .delete(`/api/boards/${boardId}/comments/${id}`).set(auth(MEMBER));
    expect(del.status).toBe(200);
  });

  // (4) THE FIX — edit own comment after revocation.
  it('blocks a revoked author from editing their own comment', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER });
    await addMember(boardId, MEMBER);
    const id = await postComment(boardId, MEMBER, 'original');

    await revoke(boardId, MEMBER);

    const edit = await request(app)
      .put(`/api/boards/${boardId}/comments/${id}`).set(auth(MEMBER))
      .send({ content: 'EDITED AFTER REVOCATION' });
    expect(edit.status).toBe(403);

    // And the row is genuinely untouched, not merely a rejected response.
    const rows = await query<{ content: string }>(
      'SELECT content FROM board_comments WHERE id = $1', [id]
    );
    expect(rows[0].content).toBe('original');
  });

  // (5) THE FIX — delete own comment after revocation.
  it('blocks a revoked author from deleting their own comment', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER });
    await addMember(boardId, MEMBER);
    const id = await postComment(boardId, MEMBER);

    await revoke(boardId, MEMBER);

    const del = await request(app)
      .delete(`/api/boards/${boardId}/comments/${id}`).set(auth(MEMBER));
    expect(del.status).toBe(403);

    const rows = await query<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM board_comments WHERE id = $1', [id]
    );
    expect(rows[0].deleted_at).toBeNull();
  });

  // (6)(7) pre-existing correct behaviour — asserted so a future change
  // to the shared authorization path cannot silently regress it.
  it('blocks a revoked user from creating or reading comments', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER });
    await addMember(boardId, MEMBER);
    await postComment(boardId, MEMBER);
    await revoke(boardId, MEMBER);

    const create = await request(app)
      .post(`/api/boards/${boardId}/comments`).set(auth(MEMBER))
      .send({ content: 'nope', anchorType: 'canvas', anchorX: 1, anchorY: 1 });
    expect(create.status).toBe(403);

    const read = await request(app)
      .get(`/api/boards/${boardId}/comments`).set(auth(MEMBER));
    expect(read.status).toBe(403);
  });

  // (8) editor moderation over ANY comment is unchanged.
  it('still lets a board member (editor) edit and delete another user\'s comment', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER });
    await addMember(boardId, MEMBER);
    const ownersComment = await postComment(boardId, OWNER, 'owner text');

    const edit = await request(app)
      .put(`/api/boards/${boardId}/comments/${ownersComment}`).set(auth(MEMBER))
      .send({ content: 'moderated by editor' });
    expect(edit.status).toBe(200);

    const del = await request(app)
      .delete(`/api/boards/${boardId}/comments/${ownersComment}`).set(auth(MEMBER));
    expect(del.status).toBe(200);
  });

  // (9) owner moderation is unchanged.
  it('still lets the owner edit and delete another user\'s comment', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER });
    await addMember(boardId, MEMBER);
    const membersComment = await postComment(boardId, MEMBER, 'member text');

    const edit = await request(app)
      .put(`/api/boards/${boardId}/comments/${membersComment}`).set(auth(OWNER))
      .send({ content: 'moderated by owner' });
    expect(edit.status).toBe(200);

    const del = await request(app)
      .delete(`/api/boards/${boardId}/comments/${membersComment}`).set(auth(OWNER));
    expect(del.status).toBe(200);
  });

  // (10)(11) a commenter (read access via a SHARED board, no membership,
  // members_only edit mode → 'commenter') may manage only their own.
  it('does not let a commenter edit or delete another user\'s comment', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER, visibility: 'shared' });
    const ownersComment = await postComment(boardId, OWNER, 'owner text');

    // OUTSIDER has read access (shared board) but no membership.
    const own = await postComment(boardId, OUTSIDER, 'outsider text');

    const editOthers = await request(app)
      .put(`/api/boards/${boardId}/comments/${ownersComment}`).set(auth(OUTSIDER))
      .send({ content: 'should fail' });
    expect(editOthers.status).toBe(403);

    const delOthers = await request(app)
      .delete(`/api/boards/${boardId}/comments/${ownersComment}`).set(auth(OUTSIDER));
    expect(delOthers.status).toBe(403);

    // ...but may still manage their own.
    const editOwn = await request(app)
      .put(`/api/boards/${boardId}/comments/${own}`).set(auth(OUTSIDER))
      .send({ content: 'own edit ok' });
    expect(editOwn.status).toBe(200);
  });

  // (12) resolve/reopen permissions unchanged.
  it('keeps resolve/reopen restricted to board-edit access', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER, visibility: 'shared' });
    const root = await postComment(boardId, OWNER, 'thread root');

    // A commenter (shared-board read access, not a member) cannot resolve.
    const denied = await request(app)
      .post(`/api/boards/${boardId}/comments/${root}/resolve`).set(auth(OUTSIDER));
    expect(denied.status).toBe(403);

    // The owner can.
    const ok = await request(app)
      .post(`/api/boards/${boardId}/comments/${root}/resolve`).set(auth(OWNER));
    expect(ok.status).toBe(200);

    const reopened = await request(app)
      .post(`/api/boards/${boardId}/comments/${root}/reopen`).set(auth(OWNER));
    expect(reopened.status).toBe(200);
  });

  it('blocks a revoked user from resolving or reopening', async () => {
    const boardId = await createBoard({ ownerRoll: OWNER });
    await addMember(boardId, MEMBER);
    const root = await postComment(boardId, MEMBER, 'root');
    await revoke(boardId, MEMBER);

    const resolve = await request(app)
      .post(`/api/boards/${boardId}/comments/${root}/resolve`).set(auth(MEMBER));
    expect(resolve.status).toBe(403);
  });

  it('does not let a comment id from another board be mutated through this board\'s path', async () => {
    // getComment is board-scoped; this asserts that scoping stays intact
    // now that the authorization order has changed around it.
    const boardA = await createBoard({ ownerRoll: OWNER });
    const boardB = await createBoard({ ownerRoll: MEMBER });
    const commentOnA = await postComment(boardA, OWNER, 'on A');

    const cross = await request(app)
      .put(`/api/boards/${boardB}/comments/${commentOnA}`).set(auth(MEMBER))
      .send({ content: 'cross-board' });
    expect(cross.status).toBe(404);
  });
});

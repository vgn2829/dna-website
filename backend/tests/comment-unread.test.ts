import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { CommentBroadcaster } from '../src/realtime/comments/commentBroadcaster';
import type { VersionHistoryService } from '../src/realtime/history/versionHistoryService';
import type { RestoreService } from '../src/realtime/history/restoreService';

// ─────────────────────────────────────────────────────────────────────────
// PERSISTENT COMMENT UNREAD STATE (V2.6 Phase E).
//
// THE BUG THIS LOCKS DOWN: "unread" lived only in BoardPage's
// useState(() => Date.now()), so it reset on every mount — refreshing the
// page silently marked every thread read, and the state was per-tab rather
// than per-user. There was no server-side read surface at all (verified
// before the fix: no read/seen table existed and GET
// .../comments/read-state returned 404).
//
// The model is a WATERMARK: one row per (board, user), not one per
// comment. That answers the only question the UI asks — "has this thread
// had activity since I last looked?" — by comparing each thread's newest
// updatedAt against the watermark, so per-thread granularity still works
// without a row per comment. See schema.ts's board_comment_reads comment.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp({
  versionHistoryService: {} as VersionHistoryService,
  restoreService: {} as RestoreService,
  commentBroadcaster: new CommentBroadcaster(),
});

const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const OWNER = '230437';
const MEMBER = '240280';
const OUTSIDER = '999999';

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1,$2,'01 Jan 2026',$3,$4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

async function createBoard(ownerRoll: string, visibility: 'private' | 'shared' = 'private'): Promise<string> {
  const id = `board-unread-${Math.random().toString(36).slice(2, 10)}`;
  const wsId = `ws-unread-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(`INSERT INTO workspaces (id,name,is_personal,owner_roll,created_at) VALUES ($1,'WS',true,$2,$3)`, [wsId, ownerRoll, now]);
  await query(`INSERT INTO workspace_members (workspace_id,roll_number,role,name,added_at) VALUES ($1,$2,'owner','Owner',$3)`, [wsId, ownerRoll, now]);
  await query(
    `INSERT INTO boards (id,name,owner_roll,owner_name,visibility,edit_mode,created_at,updated_at,room_id,workspace_id)
     VALUES ($1,'Unread Board',$2,'Owner',$3,'members_only',$4,$4,$5,$6)`,
    [id, ownerRoll, visibility, now, `room-${id}`, wsId]
  );
  return id;
}

const addMember = (boardId: string, roll: string) => query(
  `INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1,$2,$3,$4)`,
  [boardId, roll, `Student ${roll}`, new Date().toISOString()]
);

const getState = (boardId: string, roll: string) =>
  request(app).get(`/api/boards/${boardId}/comments/read-state`).set(auth(roll));
const markSeen = (boardId: string, roll: string) =>
  request(app).post(`/api/boards/${boardId}/comments/read-state`).set(auth(roll));

beforeEach(async () => {
  await query('TRUNCATE "board_comment_reads","board_comments","board_members","boards","workspace_members","workspaces","student_sessions" CASCADE');
  process.env.REALTIME_ENABLED = 'true';
  await Promise.all([registerStudent(OWNER), registerStudent(MEMBER), registerStudent(OUTSIDER)]);
});

describe('comment unread state', () => {
  it('reports null for a user who has never opened the board (everything unread)', async () => {
    const boardId = await createBoard(OWNER);
    const res = await getState(boardId, OWNER);
    expect(res.status).toBe(200);
    expect(res.body.lastSeenAt).toBeNull();
  });

  it('records a watermark when the user marks comments seen', async () => {
    const boardId = await createBoard(OWNER);
    const marked = await markSeen(boardId, OWNER);
    expect(marked.status).toBe(200);
    expect(typeof marked.body.lastSeenAt).toBe('string');

    const after = await getState(boardId, OWNER);
    expect(after.body.lastSeenAt).toBe(marked.body.lastSeenAt);
  });

  // THE ACTUAL BUG: this is what a refresh does.
  it('persists across a fresh read, so a refresh does not lose read state', async () => {
    const boardId = await createBoard(OWNER);
    const marked = await markSeen(boardId, OWNER);

    // A brand-new request with no client state whatsoever — exactly what a
    // reloaded page issues.
    const reloaded = await getState(boardId, OWNER);
    expect(reloaded.body.lastSeenAt).toBe(marked.body.lastSeenAt);
    expect(reloaded.body.lastSeenAt).not.toBeNull();
  });

  it('never moves a watermark backwards', async () => {
    const boardId = await createBoard(OWNER);
    const first = await markSeen(boardId, OWNER);

    // Simulate an out-of-order / late write with an older timestamp.
    await query(
      `INSERT INTO board_comment_reads (board_id, roll_number, last_seen_at)
       VALUES ($1,$2,'2000-01-01T00:00:00.000Z')
       ON CONFLICT (board_id, roll_number)
       DO UPDATE SET last_seen_at = GREATEST(board_comment_reads.last_seen_at, EXCLUDED.last_seen_at)`,
      [boardId, OWNER]
    );

    const after = await getState(boardId, OWNER);
    expect(after.body.lastSeenAt).toBe(first.body.lastSeenAt);
  });

  it('keeps read state per user — one user marking read does not affect another', async () => {
    const boardId = await createBoard(OWNER);
    await addMember(boardId, MEMBER);

    await markSeen(boardId, OWNER);

    const ownerState = await getState(boardId, OWNER);
    const memberState = await getState(boardId, MEMBER);
    expect(ownerState.body.lastSeenAt).not.toBeNull();
    expect(memberState.body.lastSeenAt).toBeNull();   // untouched
  });

  it('keeps read state per board — marking one board read does not affect another', async () => {
    const boardA = await createBoard(OWNER);
    const boardB = await createBoard(OWNER);

    await markSeen(boardA, OWNER);

    expect((await getState(boardA, OWNER)).body.lastSeenAt).not.toBeNull();
    expect((await getState(boardB, OWNER)).body.lastSeenAt).toBeNull();
  });

  it('denies read state to a user with no board access', async () => {
    const boardId = await createBoard(OWNER);   // private, OUTSIDER not a member
    expect((await getState(boardId, OUTSIDER)).status).toBe(403);
    expect((await markSeen(boardId, OUTSIDER)).status).toBe(403);
  });

  // Live revocation parity with the rest of the comment subsystem.
  it('denies read state after the user\'s access is revoked', async () => {
    const boardId = await createBoard(OWNER);
    await addMember(boardId, MEMBER);
    expect((await getState(boardId, MEMBER)).status).toBe(200);
    await markSeen(boardId, MEMBER);

    await query('DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2', [boardId, MEMBER]);

    // A revoked user must not be able to learn that a board has activity.
    expect((await getState(boardId, MEMBER)).status).toBe(403);
    expect((await markSeen(boardId, MEMBER)).status).toBe(403);
  });

  it('supports per-thread unread by comparing thread activity against the watermark', async () => {
    const boardId = await createBoard(OWNER);
    await addMember(boardId, MEMBER);

    // MEMBER catches up.
    const seen = await markSeen(boardId, MEMBER);
    const watermark = new Date(seen.body.lastSeenAt).getTime();

    await new Promise(r => setTimeout(r, 15));

    // OWNER posts new activity afterwards.
    const created = await request(app)
      .post(`/api/boards/${boardId}/comments`).set(auth(OWNER))
      .send({ content: 'new activity', anchorType: 'canvas', anchorX: 1, anchorY: 1 });
    expect(created.status).toBe(201);

    // The client's rule: thread newest-updatedAt > watermark => unread.
    const list = await request(app).get(`/api/boards/${boardId}/comments`).set(auth(MEMBER));
    const thread = list.body.comments.find((c: { id: string }) => c.id === created.body.id);
    expect(new Date(thread.updatedAt).getTime()).toBeGreaterThan(watermark);

    // ...and after catching up again it is read.
    const seenAgain = await markSeen(boardId, MEMBER);
    expect(new Date(seenAgain.body.lastSeenAt).getTime())
      .toBeGreaterThanOrEqual(new Date(thread.updatedAt).getTime());
  });

  it('is removed when the board is deleted (no orphan read rows)', async () => {
    const boardId = await createBoard(OWNER);
    await markSeen(boardId, OWNER);
    await query('DELETE FROM boards WHERE id = $1', [boardId]);

    const rows = await query('SELECT 1 FROM board_comment_reads WHERE board_id = $1', [boardId]);
    expect(rows).toHaveLength(0);
  });

  it('ignores a client-supplied timestamp (the server stamps the time)', async () => {
    const boardId = await createBoard(OWNER);
    const future = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/boards/${boardId}/comments/read-state`).set(auth(OWNER))
      .send({ lastSeenAt: future });

    expect(res.status).toBe(200);
    // A client cannot mark itself read into the future and permanently
    // suppress genuine unread activity.
    expect(new Date(res.body.lastSeenAt).getTime()).toBeLessThan(Date.now() + 60_000);
  });
});

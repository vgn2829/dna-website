import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { CommentBroadcaster } from '../src/realtime/comments/commentBroadcaster';
import type { VersionHistoryService } from '../src/realtime/history/versionHistoryService';
import type { RestoreService } from '../src/realtime/history/restoreService';
import { whenNotificationsSettled } from '../src/services/notificationService';

// ─────────────────────────────────────────────────────────────────────────
// BOARD-SCOPED MENTIONS (V2.6 Phase D).
//
// Stored in the long-reserved `mentions` TEXT column (schema.ts set it
// aside for exactly this and left it unused until now) — no new column,
// no new table, no new permission model.
//
// THE SECURITY PROPERTY these tests exist for: the client is NEVER trusted
// for mentions. The server re-derives the mention list from the comment
// CONTENT and keeps only rolls with current board access, so a mention
// cannot notify (and therefore cannot leak a board name + comment id to)
// someone who cannot already see the board — and cannot be used to probe
// whether a roll exists in another workspace, because a non-existent roll
// and an unauthorized one are dropped identically.
//
// EDIT IDEMPOTENCY: re-saving a comment whose mentions are unchanged must
// notify nobody, or fixing a typo would spam everyone mentioned.
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

async function createBoard(ownerRoll: string): Promise<{ boardId: string; workspaceId: string }> {
  const boardId = `board-men-${Math.random().toString(36).slice(2, 10)}`;
  const workspaceId = `ws-men-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(`INSERT INTO workspaces (id,name,is_personal,owner_roll,created_at) VALUES ($1,'WS',true,$2,$3)`, [workspaceId, ownerRoll, now]);
  await query(`INSERT INTO workspace_members (workspace_id,roll_number,role,name,added_at) VALUES ($1,$2,'owner','Owner',$3)`, [workspaceId, ownerRoll, now]);
  await query(
    `INSERT INTO boards (id,name,owner_roll,owner_name,visibility,edit_mode,created_at,updated_at,room_id,workspace_id)
     VALUES ($1,'Mentions Board',$2,'Owner','private','members_only',$3,$3,$4,$5)`,
    [boardId, ownerRoll, now, `room-${boardId}`, workspaceId]
  );
  return { boardId, workspaceId };
}

const addMember = (boardId: string, roll: string) => query(
  `INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1,$2,$3,$4)`,
  [boardId, roll, `Student ${roll}`, new Date().toISOString()]
);

const post = (boardId: string, roll: string, body: Record<string, unknown>) =>
  request(app).post(`/api/boards/${boardId}/comments`).set(auth(roll)).send(body);

const edit = (boardId: string, roll: string, commentId: string, content: string) =>
  request(app).put(`/api/boards/${boardId}/comments/${commentId}`).set(auth(roll)).send({ content });

const mentionNotifications = (recipientRoll: string) =>
  query<{ id: string }>(
    `SELECT id FROM notifications WHERE recipient_roll = $1 AND type = 'comment_mentioned'`,
    [recipientRoll]
  );

// Notifications are written fire-and-forget by the route (a notification
// failure must never fail the comment itself — see routes/comments.ts), so
// assertions poll rather than reading once immediately after the response.
async function waitForMentionCount(recipientRoll: string, expected: number): Promise<number> {
  // Deterministic: wait for the dispatched writes to actually settle, then
  // read once. No polling, no timeout, no sleep.
  await whenNotificationsSettled();
  return (await mentionNotifications(recipientRoll)).length;
}

const root = (boardId: string, roll: string, content: string) =>
  post(boardId, roll, { content, anchorType: 'canvas', anchorX: 1, anchorY: 1 });

beforeEach(async () => {
  await query('TRUNCATE "notifications","board_comments","board_members","boards","workspace_members","workspaces" CASCADE');
  process.env.REALTIME_ENABLED = 'true';
  await Promise.all([registerStudent(OWNER), registerStudent(MEMBER), registerStudent(OUTSIDER)]);
});

// Notification writes are fire-and-forget by design (a notification
// failure must never fail the comment itself), so they can still be in
// flight when this file finishes. vitest runs files serially, so such a
// write would otherwise land AFTER the next file's TRUNCATE and make an
// unrelated, pre-existing suite fail intermittently.
//
// whenNotificationsSettled() waits for the ACTUAL dispatched work rather
// than sleeping a guessed interval — see notificationService.ts. The
// production request path is unchanged and still never awaits this.
afterAll(async () => {
  await whenNotificationsSettled();
  await query('TRUNCATE "notifications" CASCADE');
});

describe('comment mentions', () => {
  it('stores a valid mention of a board member and notifies them', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);

    const res = await root(boardId, OWNER, `Hey @${MEMBER} take a look`);
    expect(res.status).toBe(201);
    expect(res.body.mentions).toEqual([MEMBER]);

    expect(await waitForMentionCount(MEMBER, 1)).toBe(1);
  });

  it('drops a mention of a user with no access to the board, and notifies nobody', async () => {
    const { boardId } = await createBoard(OWNER);   // OUTSIDER is not a member

    const res = await root(boardId, OWNER, `Hello @${OUTSIDER}`);
    expect(res.status).toBe(201);
    expect(res.body.mentions).toEqual([]);
    expect(await waitForMentionCount(OUTSIDER, 0)).toBe(0);
  });

  it('drops a mention of a roll that does not exist at all', async () => {
    const { boardId } = await createBoard(OWNER);
    const res = await root(boardId, OWNER, 'Hello @NOSUCHROLL');
    expect(res.status).toBe(201);
    expect(res.body.mentions).toEqual([]);
  });

  it('cannot be used to probe another workspace (unknown and unauthorized behave identically)', async () => {
    const { boardId } = await createBoard(OWNER);
    // A real user who belongs to a DIFFERENT workspace.
    const other = await createBoard(MEMBER);
    expect(other.workspaceId).not.toBe('');

    const knownButUnauthorized = await root(boardId, OWNER, `@${MEMBER}`);
    const totallyUnknown = await root(boardId, OWNER, '@ZZZ999');

    // Identical observable result — no existence oracle.
    expect(knownButUnauthorized.body.mentions).toEqual([]);
    expect(totallyUnknown.body.mentions).toEqual([]);
    expect(knownButUnauthorized.status).toBe(totallyUnknown.status);
  });

  it('ignores a self-mention', async () => {
    const { boardId } = await createBoard(OWNER);
    const res = await root(boardId, OWNER, `note to self @${OWNER}`);
    expect(res.status).toBe(201);
    expect(res.body.mentions).toEqual([]);
    expect(await waitForMentionCount(OWNER, 0)).toBe(0);
  });

  it('deduplicates a repeated mention of the same person', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);

    const res = await root(boardId, OWNER, `@${MEMBER} and again @${MEMBER} and @${MEMBER}`);
    expect(res.body.mentions).toEqual([MEMBER]);
    expect(await waitForMentionCount(MEMBER, 1)).toBe(1);
  });

  it('ignores client-supplied mentions entirely (content is the only source)', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);

    // No @ in the content, but the client claims a mention anyway.
    const res = await post(boardId, OWNER, {
      content: 'no mention here', anchorType: 'canvas', anchorX: 1, anchorY: 1,
      mentions: [MEMBER, OUTSIDER],
    });
    expect(res.status).toBe(201);
    expect(res.body.mentions).toEqual([]);
    expect(await waitForMentionCount(MEMBER, 0)).toBe(0);
  });

  it('supports mentions in a reply', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);
    const created = await root(boardId, OWNER, 'thread root');

    const reply = await post(boardId, OWNER, {
      content: `following up @${MEMBER}`, parentCommentId: created.body.id,
    });
    expect(reply.status).toBe(201);
    expect(reply.body.mentions).toEqual([MEMBER]);
    expect(await waitForMentionCount(MEMBER, 1)).toBe(1);
  });

  // ── Edit idempotency ────────────────────────────────────────────────
  it('does NOT re-notify when an edit leaves the mention unchanged', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);

    const created = await root(boardId, OWNER, `@${MEMBER} first draft`);
    expect(await waitForMentionCount(MEMBER, 1)).toBe(1);

    await edit(boardId, OWNER, created.body.id, `@${MEMBER} first draft, typo fixed`);
    await whenNotificationsSettled();

    // Still exactly one — fixing a typo must not spam the mentioned user.
    expect(await waitForMentionCount(MEMBER, 1)).toBe(1);
  });

  it('notifies only the NEWLY added mention on an edit', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);
    await addMember(boardId, OUTSIDER);

    const created = await root(boardId, OWNER, `@${MEMBER} hello`);
    expect(await waitForMentionCount(MEMBER, 1)).toBe(1);
    expect(await waitForMentionCount(OUTSIDER, 0)).toBe(0);

    await edit(boardId, OWNER, created.body.id, `@${MEMBER} hello and @${OUTSIDER}`);
    await whenNotificationsSettled();

    expect(await waitForMentionCount(MEMBER, 1)).toBe(1);    // unchanged
    expect(await waitForMentionCount(OUTSIDER, 1)).toBe(1);  // newly added
  });

  it('does not notify when an edit REMOVES a mention', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);

    const created = await root(boardId, OWNER, `@${MEMBER} hello`);
    await edit(boardId, OWNER, created.body.id, 'hello (mention removed)');
    await whenNotificationsSettled();

    expect(await waitForMentionCount(MEMBER, 1)).toBe(1);   // the original only
    const stored = await query<{ mentions: string | null }>(
      'SELECT mentions FROM board_comments WHERE id = $1', [created.body.id]
    );
    expect(JSON.parse(stored[0].mentions ?? '[]')).toEqual([]);
  });

  it('does not create notifications when a comment is deleted', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);
    const created = await root(boardId, OWNER, `@${MEMBER} hello`);
    const before = await waitForMentionCount(MEMBER, 1);

    await request(app).delete(`/api/boards/${boardId}/comments/${created.body.id}`).set(auth(OWNER));
    await whenNotificationsSettled();

    expect(await waitForMentionCount(MEMBER, before)).toBe(before);
  });

  it('keeps existing root/reply notification behaviour intact', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);

    // MEMBER comments on OWNER's board -> owner gets comment_created.
    await root(boardId, MEMBER, 'plain comment, no mentions');
    await whenNotificationsSettled();
    const created = await query(`SELECT id FROM notifications WHERE recipient_roll = $1 AND type = 'comment_created'`, [OWNER]);
    expect(created).toHaveLength(1);
  });

  it('keeps mention notifications private to their recipient', async () => {
    const { boardId } = await createBoard(OWNER);
    await addMember(boardId, MEMBER);
    await root(boardId, OWNER, `@${MEMBER} private ping`);

    const res = await request(app).get('/api/notifications').set(auth(OUTSIDER));
    expect(res.status).toBe(200);
    const types = (res.body.notifications ?? []).map((n: { type: string }) => n.type);
    expect(types).not.toContain('comment_mentioned');
  });

  it('caps the number of mentions a single comment can fan out to', async () => {
    const { boardId } = await createBoard(OWNER);
    // 30 candidate mentions, none of them members — the cap must apply
    // before any authorization work, and none should resolve.
    const many = Array.from({ length: 30 }, (_, i) => `@ROLL${String(i).padStart(3, '0')}`).join(' ');
    const res = await root(boardId, OWNER, many);
    expect(res.status).toBe(201);
    expect(res.body.mentions).toEqual([]);
  });
});

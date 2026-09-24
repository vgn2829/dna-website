import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { whenNotificationsSettled } from '../src/services/notificationService';
import { CommentBroadcaster } from '../src/realtime/comments/commentBroadcaster';
import type { VersionHistoryService } from '../src/realtime/history/versionHistoryService';
import type { RestoreService } from '../src/realtime/history/restoreService';

// ─────────────────────────────────────────────────────────────────────────
// Integration tests against the real (local test) Postgres DB, through the
// actual HTTP routers that both CREATE notifications (boards.ts,
// workspaces.ts, comments.ts) and READ them (routes/notifications.ts) —
// same style/fixtures as comments.test.ts and workspaces.test.ts.
// createApp() needs the same realtime stubs comments.test.ts already uses
// so POST /api/boards/:id/comments is mounted at all (see app.ts's
// optional `realtime` param).
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

async function createWorkspace(roll: string, name: string): Promise<string> {
  const res = await request(app)
    .post('/api/workspaces')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .send({ name });
  return res.body.id as string;
}

async function createBoard(roll: string, workspaceId: string): Promise<string> {
  const res = await request(app)
    .post('/api/boards')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .send({ name: 'Test Board', workspace_id: workspaceId });
  return res.body.id as string;
}

async function getNotifications(roll: string, query_ = '') {
  // Notification writes are dispatched fire-and-forget by the routes (a
  // notification failure must never fail the request that triggered it),
  // so reading the inbox immediately after a mutation raced the INSERT.
  // Waiting for the dispatched work to settle makes every assertion below
  // deterministic without changing production behaviour or adding sleeps.
  await whenNotificationsSettled();
  return request(app)
    .get(`/api/notifications${query_}`)
    .set('Authorization', `Bearer ${tokenFor(roll)}`);
}

beforeEach(async () => {
  await query('TRUNCATE "notifications", "board_comments", "board_members", "boards", "workspace_members", "workspaces" CASCADE');
});

describe('board_shared notification', () => {
  it('notifies the added member, not the owner', async () => {
    await registerStudent('BS_OWNER');
    await registerStudent('BS_MEMBER');
    const ws = await createWorkspace('BS_OWNER', 'WS');
    const boardId = await createBoard('BS_OWNER', ws);

    await request(app)
      .post(`/api/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${tokenFor('BS_OWNER')}`)
      .send({ roll_number: 'BS_MEMBER' });

    const memberRes = await getNotifications('BS_MEMBER');
    expect(memberRes.status).toBe(200);
    expect(memberRes.body.notifications).toHaveLength(1);
    expect(memberRes.body.notifications[0]).toMatchObject({
      type: 'board_shared',
      actorRoll: 'BS_OWNER',
      boardId,
      read: false,
    });
    expect(memberRes.body.unreadCount).toBe(1);

    const ownerRes = await getNotifications('BS_OWNER');
    expect(ownerRes.body.notifications).toHaveLength(0);
  });

  it('does not create a duplicate notification when the same member is re-added', async () => {
    await registerStudent('BS2_OWNER');
    await registerStudent('BS2_MEMBER');
    const ws = await createWorkspace('BS2_OWNER', 'WS');
    const boardId = await createBoard('BS2_OWNER', ws);

    const add = () => request(app)
      .post(`/api/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${tokenFor('BS2_OWNER')}`)
      .send({ roll_number: 'BS2_MEMBER' });

    await add();
    await add();

    const res = await getNotifications('BS2_MEMBER');
    expect(res.body.notifications).toHaveLength(1);
  });
});

describe('workspace_added notification', () => {
  it('notifies the added member', async () => {
    await registerStudent('WA_OWNER');
    await registerStudent('WA_MEMBER');
    const ws = await createWorkspace('WA_OWNER', 'Team');

    await request(app)
      .post(`/api/workspaces/${ws}/members`)
      .set('Authorization', `Bearer ${tokenFor('WA_OWNER')}`)
      .send({ roll_number: 'WA_MEMBER' });

    const res = await getNotifications('WA_MEMBER');
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0]).toMatchObject({
      type: 'workspace_added',
      workspaceId: ws,
      actorRoll: 'WA_OWNER',
    });
  });
});

describe('workspace_role_changed notification', () => {
  it('notifies the promoted member, and only fires on an actual change', async () => {
    await registerStudent('WR_OWNER');
    await registerStudent('WR_MEMBER');
    const ws = await createWorkspace('WR_OWNER', 'Team');
    await request(app)
      .post(`/api/workspaces/${ws}/members`)
      .set('Authorization', `Bearer ${tokenFor('WR_OWNER')}`)
      .send({ roll_number: 'WR_MEMBER' });

    await request(app)
      .put(`/api/workspaces/${ws}/members/WR_MEMBER/role`)
      .set('Authorization', `Bearer ${tokenFor('WR_OWNER')}`)
      .send({ role: 'admin' });

    const res = await getNotifications('WR_MEMBER');
    const roleChanged = res.body.notifications.filter((n: { type: string }) => n.type === 'workspace_role_changed');
    expect(roleChanged).toHaveLength(1);

    // Re-setting the SAME role must not fire a second notification.
    await request(app)
      .put(`/api/workspaces/${ws}/members/WR_MEMBER/role`)
      .set('Authorization', `Bearer ${tokenFor('WR_OWNER')}`)
      .send({ role: 'admin' });

    const res2 = await getNotifications('WR_MEMBER');
    const roleChanged2 = res2.body.notifications.filter((n: { type: string }) => n.type === 'workspace_role_changed');
    expect(roleChanged2).toHaveLength(1);
  });
});

describe('comment notifications', () => {
  it('notifies the board owner on a new thread, with the commentId for navigation', async () => {
    await registerStudent('CM_OWNER');
    await registerStudent('CM_COMMENTER');
    const ws = await createWorkspace('CM_OWNER', 'WS');
    const boardId = await createBoard('CM_OWNER', ws);
    await request(app)
      .post(`/api/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${tokenFor('CM_OWNER')}`)
      .send({ roll_number: 'CM_COMMENTER' });

    const commentRes = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('CM_COMMENTER')}`)
      .send({ content: 'Nice board!', anchorType: 'canvas', anchorX: 0, anchorY: 0 });
    expect(commentRes.status).toBe(201);

    const res = await getNotifications('CM_OWNER');
    const created = res.body.notifications.filter((n: { type: string }) => n.type === 'comment_created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      boardId,
      commentId: commentRes.body.id,
      actorRoll: 'CM_COMMENTER',
    });
  });

  it('does not notify the owner when they comment on their own board', async () => {
    await registerStudent('CM2_OWNER');
    const ws = await createWorkspace('CM2_OWNER', 'WS');
    const boardId = await createBoard('CM2_OWNER', ws);

    await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('CM2_OWNER')}`)
      .send({ content: 'Note to self', anchorType: 'canvas', anchorX: 0, anchorY: 0 });

    const res = await getNotifications('CM2_OWNER');
    expect(res.body.notifications).toHaveLength(0);
  });

  it('notifies the thread-root author (not the board owner) on a reply', async () => {
    await registerStudent('CR_OWNER');
    await registerStudent('CR_ROOT_AUTHOR');
    await registerStudent('CR_REPLIER');
    const ws = await createWorkspace('CR_OWNER', 'WS');
    const boardId = await createBoard('CR_OWNER', ws);
    for (const roll of ['CR_ROOT_AUTHOR', 'CR_REPLIER']) {
      await request(app)
        .post(`/api/boards/${boardId}/members`)
        .set('Authorization', `Bearer ${tokenFor('CR_OWNER')}`)
        .send({ roll_number: roll });
    }

    const rootRes = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('CR_ROOT_AUTHOR')}`)
      .send({ content: 'Root comment', anchorType: 'canvas', anchorX: 0, anchorY: 0 });
    const rootId = rootRes.body.id as string;

    // The owner's own notification inbox for the root — sanity check that
    // comment_created fired for the owner from the root comment above.
    const ownerAfterRoot = await getNotifications('CR_OWNER');
    expect(ownerAfterRoot.body.notifications.filter((n: { type: string }) => n.type === 'comment_created')).toHaveLength(1);

    const replyRes = await request(app)
      .post(`/api/boards/${boardId}/comments`)
      .set('Authorization', `Bearer ${tokenFor('CR_REPLIER')}`)
      .send({ content: 'A reply', parentCommentId: rootId });
    expect(replyRes.status).toBe(201);

    const rootAuthorRes = await getNotifications('CR_ROOT_AUTHOR');
    const replied = rootAuthorRes.body.notifications.filter((n: { type: string }) => n.type === 'comment_replied');
    expect(replied).toHaveLength(1);
    expect(replied[0]).toMatchObject({ commentId: replyRes.body.id, actorRoll: 'CR_REPLIER' });

    // The owner should NOT get a second comment_created/comment_replied
    // notification just because they happen to own the board — the reply
    // notification goes only to the root author.
    const ownerAfterReply = await getNotifications('CR_OWNER');
    expect(ownerAfterReply.body.notifications).toHaveLength(1);
  });
});

describe('GET /api/notifications', () => {
  it('rejects unauthenticated access', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('never returns another user\'s notifications', async () => {
    await registerStudent('ISO_OWNER');
    await registerStudent('ISO_A');
    await registerStudent('ISO_B');
    const ws = await createWorkspace('ISO_OWNER', 'WS');
    const boardId = await createBoard('ISO_OWNER', ws);
    await request(app)
      .post(`/api/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${tokenFor('ISO_OWNER')}`)
      .send({ roll_number: 'ISO_A' });

    const bRes = await getNotifications('ISO_B');
    expect(bRes.body.notifications).toHaveLength(0);
    const aRes = await getNotifications('ISO_A');
    expect(aRes.body.notifications).toHaveLength(1);
  });

  it('filters to unread_only', async () => {
    await registerStudent('UN_OWNER');
    await registerStudent('UN_MEMBER');
    const ws = await createWorkspace('UN_OWNER', 'WS');
    const boardId = await createBoard('UN_OWNER', ws);
    await request(app)
      .post(`/api/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${tokenFor('UN_OWNER')}`)
      .send({ roll_number: 'UN_MEMBER' });

    const listBefore = await getNotifications('UN_MEMBER');
    const id = listBefore.body.notifications[0].id;
    await request(app)
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${tokenFor('UN_MEMBER')}`);

    const unreadOnly = await getNotifications('UN_MEMBER', '?unread_only=true');
    expect(unreadOnly.body.notifications).toHaveLength(0);
    expect(unreadOnly.body.unreadCount).toBe(0);

    const all = await getNotifications('UN_MEMBER');
    expect(all.body.notifications).toHaveLength(1);
  });
});

describe('POST /api/notifications/:id/read', () => {
  it('marks a notification read and is idempotent', async () => {
    await registerStudent('MR_OWNER');
    await registerStudent('MR_MEMBER');
    const ws = await createWorkspace('MR_OWNER', 'WS');
    const boardId = await createBoard('MR_OWNER', ws);
    await request(app)
      .post(`/api/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${tokenFor('MR_OWNER')}`)
      .send({ roll_number: 'MR_MEMBER' });

    const list = await getNotifications('MR_MEMBER');
    const id = list.body.notifications[0].id;

    const readRes = await request(app)
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${tokenFor('MR_MEMBER')}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.read).toBe(true);

    // Idempotent — reading an already-read notification again still 200s.
    const readAgain = await request(app)
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${tokenFor('MR_MEMBER')}`);
    expect(readAgain.status).toBe(200);
  });

  it('rejects marking another user\'s notification as read', async () => {
    await registerStudent('MR2_OWNER');
    await registerStudent('MR2_MEMBER');
    await registerStudent('MR2_OTHER');
    const ws = await createWorkspace('MR2_OWNER', 'WS');
    const boardId = await createBoard('MR2_OWNER', ws);
    await request(app)
      .post(`/api/boards/${boardId}/members`)
      .set('Authorization', `Bearer ${tokenFor('MR2_OWNER')}`)
      .send({ roll_number: 'MR2_MEMBER' });

    const list = await getNotifications('MR2_MEMBER');
    const id = list.body.notifications[0].id;

    const res = await request(app)
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${tokenFor('MR2_OTHER')}`);
    expect(res.status).toBe(404);

    // Confirm it's genuinely still unread for the real owner — a 404
    // alone doesn't prove the row wasn't touched.
    const stillUnread = await getNotifications('MR2_MEMBER', '?unread_only=true');
    expect(stillUnread.body.notifications).toHaveLength(1);
  });

  it('404s for a nonexistent notification', async () => {
    await registerStudent('MR3');
    const res = await request(app)
      .post('/api/notifications/00000000-0000-0000-0000-000000000000/read')
      .set('Authorization', `Bearer ${tokenFor('MR3')}`);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated mark-read', async () => {
    const res = await request(app).post('/api/notifications/00000000-0000-0000-0000-000000000000/read');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('marks every one of the caller\'s notifications read, and none of anyone else\'s', async () => {
    await registerStudent('RA_OWNER');
    await registerStudent('RA_MEMBER');
    await registerStudent('RA_OTHER');
    const ws = await createWorkspace('RA_OWNER', 'WS');
    const board1 = await createBoard('RA_OWNER', ws);
    const board2 = await createBoard('RA_OWNER', ws);
    await request(app)
      .post(`/api/boards/${board1}/members`)
      .set('Authorization', `Bearer ${tokenFor('RA_OWNER')}`)
      .send({ roll_number: 'RA_MEMBER' });
    await request(app)
      .post(`/api/boards/${board2}/members`)
      .set('Authorization', `Bearer ${tokenFor('RA_OWNER')}`)
      .send({ roll_number: 'RA_MEMBER' });
    await request(app)
      .post(`/api/boards/${board1}/members`)
      .set('Authorization', `Bearer ${tokenFor('RA_OWNER')}`)
      .send({ roll_number: 'RA_OTHER' });

    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${tokenFor('RA_MEMBER')}`);
    expect(res.status).toBe(200);
    expect(res.body.markedCount).toBe(2);

    const memberUnread = await getNotifications('RA_MEMBER', '?unread_only=true');
    expect(memberUnread.body.notifications).toHaveLength(0);

    const otherUnread = await getNotifications('RA_OTHER', '?unread_only=true');
    expect(otherUnread.body.notifications).toHaveLength(1);
  });

  it('rejects unauthenticated read-all', async () => {
    const res = await request(app).post('/api/notifications/read-all');
    expect(res.status).toBe(401);
  });
});

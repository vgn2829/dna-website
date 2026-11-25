import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client';

// ─────────────────────────────────────────────────────────────────────────
// NOTIFICATION SERVICE (Phase C) — the single place notification rows get
// created, so every mutation route that should notify someone calls one of
// the functions below instead of hand-rolling its own INSERT. Kept
// deliberately small: five event types, no delivery channels, no
// preferences, no digesting — see routes/notifications.ts's own header
// comment for the read-side API this pairs with.
//
// SELF-NOTIFICATION GUARD — every create* function silently no-ops when
// recipientRoll === actorRoll (e.g. a workspace owner adding themselves
// isn't possible today, but a board owner commenting on their own board
// very much is, and "you commented on your own board" is never a useful
// notification). This is checked HERE, once, rather than at every call
// site, so a future call site can't forget it.
// ─────────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'board_shared'
  | 'workspace_added'
  | 'workspace_role_changed'
  | 'comment_created'
  | 'comment_replied'
  | 'comment_mentioned';

export interface NotificationRow {
  id: string;
  recipient_roll: string;
  actor_roll: string | null;
  actor_name: string | null;
  type: NotificationType;
  board_id: string | null;
  board_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  comment_id: string | null;
  read_at: string | null;
  created_at: string;
}

interface CreateNotificationInput {
  recipientRoll: string;
  actorRoll: string | null;
  actorName: string | null;
  type: NotificationType;
  boardId?: string | null;
  boardName?: string | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
  commentId?: string | null;
}


// ─────────────────────────────────────────────────────────────────────────
// IN-FLIGHT TRACKING (test determinism).
//
// Routes dispatch notifications fire-and-forget ON PURPOSE: a notification
// failure must never fail the comment request that triggered it, and the
// caller must never pay its latency. That contract is unchanged — nothing
// below makes any production path await anything.
//
// What it DOES do is let a caller that genuinely needs to know — the test
// suite — observe when the dispatched work has settled. Without this, an
// integration test's TRUNCATE could run while a notification INSERT from
// the previous test file was still in flight, so a row would reappear
// after the table was cleared and an unrelated, pre-existing suite would
// fail intermittently. Whether the write won that race depended purely on
// event-loop scheduling, which is exactly what made the suite
// non-deterministic.
//
// The tracker is a counter plus a promise: registering is O(1) and costs
// production nothing beyond an increment/decrement, and no test-only
// branch exists in the request path.
let inFlight = 0;
let idleResolvers: Array<() => void> = [];

function trackNotificationWrite<T>(work: Promise<T>): Promise<T> {
  inFlight++;
  return work.finally(() => {
    inFlight--;
    if (inFlight === 0) {
      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const resolve of resolvers) resolve();
    }
  });
}

// Resolves once no notification write is outstanding. Intended for test
// teardown; harmless (and immediate) in production, where nothing calls
// it. Resolves synchronously-ish when already idle, so it never adds a
// fixed delay — it waits for the actual work, not for a guessed interval.
export function whenNotificationsSettled(): Promise<void> {
  if (inFlight === 0) return Promise.resolve();
  return new Promise<void>(resolve => { idleResolvers.push(resolve); });
}

// Diagnostic, for a test that wants to assert the tracker itself works.
export function pendingNotificationCount(): number {
  return inFlight;
}

// Registers a whole fire-and-forget DISPATCH — not just the final INSERT.
//
// This distinction is the entire point: a route's notification block does
// real work (board lookup, author lookup, a loop over recipients) BEFORE
// the first createNotification call. Tracking only the INSERT would mean a
// caller asking "has everything settled?" between dispatch and the first
// insert sees an empty tracker and resolves immediately — which is exactly
// the race being closed. Registering here covers the full tail.
//
// Production semantics are unchanged: this returns void, nothing awaits
// it, and a rejection is swallowed by the caller's own .catch exactly as
// before.
export function dispatchNotifications(work: () => Promise<void>): Promise<void> {
  return trackNotificationWrite(work());
}

async function createNotification(input: CreateNotificationInput): Promise<NotificationRow | null> {
  return trackNotificationWrite(createNotificationInner(input));
}

async function createNotificationInner(input: CreateNotificationInput): Promise<NotificationRow | null> {
  if (input.actorRoll && input.actorRoll === input.recipientRoll) return null;

  const id = uuidv4();
  const now = new Date().toISOString();
  const result = await pool.query(`
    INSERT INTO notifications
      (id, recipient_roll, actor_roll, actor_name, type, board_id, board_name, workspace_id, workspace_name, comment_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [
    id, input.recipientRoll, input.actorRoll, input.actorName, input.type,
    input.boardId ?? null, input.boardName ?? null,
    input.workspaceId ?? null, input.workspaceName ?? null,
    input.commentId ?? null, now,
  ]);
  return result.rows[0] as NotificationRow;
}

// "You were added to [Board]" — called from POST /api/boards/:id/members,
// the single existing mutation point that adds a board collaborator (see
// that route's own ON CONFLICT DO NOTHING — a re-add of an already-present
// member is a no-op there, so this is only ever called on a genuine new
// addition, never a duplicate).
export async function notifyBoardShared(params: {
  recipientRoll: string;
  actorRoll: string;
  actorName: string | null;
  boardId: string;
  boardName: string;
}): Promise<void> {
  await createNotification({
    recipientRoll: params.recipientRoll,
    actorRoll: params.actorRoll,
    actorName: params.actorName,
    type: 'board_shared',
    boardId: params.boardId,
    boardName: params.boardName,
  });
}

// "You were added to [Workspace]" — called from POST /api/workspaces/:id/members.
export async function notifyWorkspaceAdded(params: {
  recipientRoll: string;
  actorRoll: string;
  actorName: string | null;
  workspaceId: string;
  workspaceName: string;
}): Promise<void> {
  await createNotification({
    recipientRoll: params.recipientRoll,
    actorRoll: params.actorRoll,
    actorName: params.actorName,
    type: 'workspace_added',
    workspaceId: params.workspaceId,
    workspaceName: params.workspaceName,
  });
}

// "Your role in [Workspace] changed to Admin/Member" — called from
// PUT /api/workspaces/:id/members/:roll/role. Fires on every role change,
// promote or demote — both are useful for the affected member to know
// about, and there's no third state to distinguish.
export async function notifyWorkspaceRoleChanged(params: {
  recipientRoll: string;
  actorRoll: string;
  actorName: string | null;
  workspaceId: string;
  workspaceName: string;
}): Promise<void> {
  await createNotification({
    recipientRoll: params.recipientRoll,
    actorRoll: params.actorRoll,
    actorName: params.actorName,
    type: 'workspace_role_changed',
    workspaceId: params.workspaceId,
    workspaceName: params.workspaceName,
  });
}

// "[Actor] commented on [Board]" — thread-root comments only, recipient is
// the board owner. Called from POST /api/boards/:id/comments when
// parentCommentId is absent.
export async function notifyCommentCreated(params: {
  recipientRoll: string;
  actorRoll: string;
  actorName: string | null;
  boardId: string;
  boardName: string;
  commentId: string;
}): Promise<void> {
  await createNotification({
    recipientRoll: params.recipientRoll,
    actorRoll: params.actorRoll,
    actorName: params.actorName,
    type: 'comment_created',
    boardId: params.boardId,
    boardName: params.boardName,
    commentId: params.commentId,
  });
}

// "[Actor] replied to your comment on [Board]" — recipient is the PARENT
// comment's author, not the board owner (those can differ, and a reply is
// specifically interesting to the person being replied to). Called from
// the same POST /api/boards/:id/comments route when parentCommentId is
// present. If the thread root's author is also the board owner, only ONE
// notification fires (comment_replied, not also comment_created) — the
// route only ever calls one of notifyCommentCreated/notifyCommentReplied
// per request, never both, since a single comment is either a root or a
// reply, never both.
export async function notifyCommentReplied(params: {
  recipientRoll: string;
  actorRoll: string;
  actorName: string | null;
  boardId: string;
  boardName: string;
  commentId: string;
}): Promise<void> {
  await createNotification({
    recipientRoll: params.recipientRoll,
    actorRoll: params.actorRoll,
    actorName: params.actorName,
    type: 'comment_replied',
    boardId: params.boardId,
    boardName: params.boardName,
    commentId: params.commentId,
  });
}

// "[Actor] mentioned you in a comment on [Board]" — V2.6 Phase D.
//
// Recipients are ALWAYS the server-validated mention list from
// routes/comments.ts (resolveMentions), never anything the client sent:
// every recipient has been confirmed to have current comment access to
// this board, so a mention can never leak a board's name or a comment id
// to someone who cannot already see them. createNotification's existing
// self-notification suppression applies here too, so mentioning yourself
// is a no-op without a separate check.
//
// Fires only for NEWLY introduced mentions — re-saving a comment whose
// mentions are unchanged notifies nobody (see the edit handler's diff).
export async function notifyCommentMentioned(params: {
  recipientRoll: string;
  actorRoll: string;
  actorName: string | null;
  boardId: string;
  boardName: string;
  commentId: string;
}): Promise<void> {
  await createNotification({
    recipientRoll: params.recipientRoll,
    actorRoll: params.actorRoll,
    actorName: params.actorName,
    type: 'comment_mentioned',
    boardId: params.boardId,
    boardName: params.boardName,
    commentId: params.commentId,
  });
}

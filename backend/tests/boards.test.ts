import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';

// ─────────────────────────────────────────────────────────────────────────
// Integration tests for routes/boards.ts's REST endpoints, through the
// real HTTP router against the local test DB — same style as
// comments.test.ts/workspaces.test.ts. Pre-workspace-layer boards.ts had
// no dedicated test file of its own (only realtime/roomAccess.ts's
// consumption of board state was tested, via room-access.test.ts); this
// file starts with the workspace/organization layer's changes to
// boards.ts (Commits 4-7 of that feature: POST / gaining workspace_id,
// GET /, /archived, /shared gaining workspace scoping) rather than
// attempting full retroactive coverage of every pre-existing route.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();

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

// Inserts a board directly via SQL, bypassing POST /api/boards's
// createBoardLimiter (15/60s, module-level — shared across every test in
// this file, since createApp() and its routers are constructed once at
// module load). Only the tests specifically exercising board-CREATION
// behavior (the workspace_id-wiring describe block) go through the real
// endpoint; every other test here only needs a board to already exist,
// so it creates one the same way room-access.test.ts/comments.test.ts's
// own createBoard() fixtures do — same rationale as those files' own
// comments on why they don't hit the real create route either.
async function createBoardDirect(opts: {
  ownerRoll: string;
  visibility?: 'private' | 'shared';
  editMode?: 'members_only' | 'anyone';
  isArchived?: boolean;
  workspaceId?: string;
}): Promise<{ id: string; workspaceId: string }> {
  const id = `board-direct-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  let workspaceId = opts.workspaceId;
  if (!workspaceId) {
    workspaceId = `workspace-direct-${Math.random().toString(36).slice(2, 10)}`;
    await query(
      `INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, 'Test Workspace', true, $2, $3)`,
      [workspaceId, opts.ownerRoll, now]
    );
    await query(
      `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'owner', 'Owner', $3)`,
      [workspaceId, opts.ownerRoll, now]
    );
  }
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id)
     VALUES ($1, 'Test Board', $2, 'Owner', $3, $4, $5, $5, $6, $7, $8)`,
    [id, opts.ownerRoll, opts.visibility ?? 'private', opts.editMode ?? 'members_only', now, `room-${id}`, opts.isArchived ?? false, workspaceId]
  );
  return { id, workspaceId };
}

async function addBoardMemberDirect(boardId: string, roll: string): Promise<void> {
  await query(
    `INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1, $2, $3, $4)`,
    [boardId, roll, `Student ${roll}`, new Date().toISOString()]
  );
}

async function addWorkspaceMemberDirect(workspaceId: string, roll: string): Promise<void> {
  await query(
    `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'member', $3, $4)`,
    [workspaceId, roll, `Student ${roll}`, new Date().toISOString()]
  );
}

beforeEach(async () => {
  await query('TRUNCATE "board_members", "board_favorites", "boards", "workspace_members", "workspaces" CASCADE');
});

describe('POST /api/boards — workspace_id wiring (Commit 4/9)', () => {
  it('auto-provisions and uses the caller\'s personal workspace when workspace_id is omitted', async () => {
    await registerStudent('CREATEB1');

    const res = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('CREATEB1')}`)
      .send({ name: 'My Board' });

    expect(res.status).toBe(201);
    expect(res.body.workspace_id).toBeTruthy();

    const workspaces = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${tokenFor('CREATEB1')}`);
    expect(workspaces.body).toHaveLength(1);
    expect(workspaces.body[0].id).toBe(res.body.workspace_id);
    expect(workspaces.body[0].is_personal).toBe(true);
  });

  it('reuses the same personal workspace across multiple board creations, never creating a second one', async () => {
    await registerStudent('CREATEB2');

    const first = await request(app).post('/api/boards').set('Authorization', `Bearer ${tokenFor('CREATEB2')}`).send({ name: 'Board 1' });
    const second = await request(app).post('/api/boards').set('Authorization', `Bearer ${tokenFor('CREATEB2')}`).send({ name: 'Board 2' });

    expect(first.body.workspace_id).toBe(second.body.workspace_id);

    const workspaces = await request(app).get('/api/workspaces').set('Authorization', `Bearer ${tokenFor('CREATEB2')}`);
    expect(workspaces.body).toHaveLength(1);
  });

  it('creates the board in an explicitly provided workspace the caller is a member of', async () => {
    await registerStudent('CREATEB3');
    const workspace = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('CREATEB3')}`).send({ name: 'Team Workspace' });

    const res = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('CREATEB3')}`)
      .send({ name: 'Team Board', workspace_id: workspace.body.id });

    expect(res.status).toBe(201);
    expect(res.body.workspace_id).toBe(workspace.body.id);
  });

  it('403s creating a board in a workspace the caller is not a member of', async () => {
    await registerStudent('CREATEB4');
    await registerStudent('CREATEB4-OTHER');
    const workspace = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('CREATEB4-OTHER')}`).send({ name: 'Not Yours' });

    const res = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('CREATEB4')}`)
      .send({ name: 'Sneaky Board', workspace_id: workspace.body.id });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/boards, /api/boards/archived — workspace scoping (Commit 5/9)', () => {
  it('GET / with no workspace_id returns boards across ALL of the caller\'s workspaces, unscoped (unchanged default)', async () => {
    await registerStudent('LISTB1');
    const teamA = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LISTB1')}`).send({ name: 'Team A' });
    await request(app).post('/api/boards').set('Authorization', `Bearer ${tokenFor('LISTB1')}`).send({ name: 'Personal Board' });
    await request(app).post('/api/boards').set('Authorization', `Bearer ${tokenFor('LISTB1')}`).send({ name: 'Team A Board', workspace_id: teamA.body.id });

    const res = await request(app).get('/api/boards').set('Authorization', `Bearer ${tokenFor('LISTB1')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /?workspace_id= narrows to exactly that workspace\'s boards', async () => {
    await registerStudent('LISTB2');
    const teamA = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LISTB2')}`).send({ name: 'Team A' });
    await request(app).post('/api/boards').set('Authorization', `Bearer ${tokenFor('LISTB2')}`).send({ name: 'Personal Board' });
    await request(app).post('/api/boards').set('Authorization', `Bearer ${tokenFor('LISTB2')}`).send({ name: 'Team A Board', workspace_id: teamA.body.id });

    const res = await request(app)
      .get('/api/boards')
      .query({ workspace_id: teamA.body.id })
      .set('Authorization', `Bearer ${tokenFor('LISTB2')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Team A Board');
  });

  it('GET /archived respects the same scoping', async () => {
    await registerStudent('LISTB3');
    const teamA = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LISTB3')}`).send({ name: 'Team A' });
    const personalBoard = await request(app).post('/api/boards').set('Authorization', `Bearer ${tokenFor('LISTB3')}`).send({ name: 'Old Personal' });
    const teamBoard = await request(app).post('/api/boards').set('Authorization', `Bearer ${tokenFor('LISTB3')}`).send({ name: 'Old Team A', workspace_id: teamA.body.id });
    await request(app).put(`/api/boards/${personalBoard.body.id}`).set('Authorization', `Bearer ${tokenFor('LISTB3')}`).send({ is_archived: true });
    await request(app).put(`/api/boards/${teamBoard.body.id}`).set('Authorization', `Bearer ${tokenFor('LISTB3')}`).send({ is_archived: true });

    const unscoped = await request(app).get('/api/boards/archived').set('Authorization', `Bearer ${tokenFor('LISTB3')}`);
    expect(unscoped.body).toHaveLength(2);

    const scoped = await request(app)
      .get('/api/boards/archived')
      .query({ workspace_id: teamA.body.id })
      .set('Authorization', `Bearer ${tokenFor('LISTB3')}`);
    expect(scoped.body).toHaveLength(1);
    expect(scoped.body[0].name).toBe('Old Team A');
  });
});

describe('canAccess/isMember/canEdit consolidation onto getBoardRole (Commit 6/9)', () => {
  // Boards here are created directly via SQL (createBoardDirect), not
  // through POST /api/boards — that route's createBoardLimiter (15/60s,
  // shared across this whole file since createApp()'s routers are built
  // once at module load) would otherwise throttle a file with this many
  // scenarios. Board-CREATION behavior itself is already covered by the
  // "workspace_id wiring" describe block above, which does go through
  // the real endpoint. Every route under test here (favorite, canvas
  // save/load, detail, items, duplicate, rename, delete) is unaffected
  // by how the board row came to exist.

  // PARITY: every scenario here uses a pure personal-workspace board (no
  // second workspace, no workspace_members row beyond the owner's own
  // auto-membership) — proving the consolidation is behavior-preserving
  // for the 100% of pre-existing boards that predate this feature, not
  // just for the new workspace-ceiling cases covered further below.

  it('PARITY: owner can favorite, edit canvas, view, duplicate, add items on their own board', async () => {
    await registerStudent('PARITY1');
    const { id } = await createBoardDirect({ ownerRoll: 'PARITY1' });
    const auth = `Bearer ${tokenFor('PARITY1')}`;

    expect((await request(app).post(`/api/boards/${id}/favorite`).set('Authorization', auth)).status).toBe(200);
    expect((await request(app).put(`/api/boards/${id}/canvas`).set('Authorization', auth).send({ canvas_data: '{}' })).status).toBe(200);
    expect((await request(app).get(`/api/boards/${id}`).set('Authorization', auth)).status).toBe(200);
    expect((await request(app).get(`/api/boards/${id}/items`).set('Authorization', auth)).status).toBe(200);
    expect((await request(app).post(`/api/boards/${id}/duplicate`).set('Authorization', auth)).status).toBe(201);
  });

  it('PARITY: an explicit board_members grant still allows editing a private board (unchanged)', async () => {
    await registerStudent('PARITY2');
    await registerStudent('PARITY2-MEMBER');
    const { id } = await createBoardDirect({ ownerRoll: 'PARITY2', visibility: 'private' });
    await addBoardMemberDirect(id, 'PARITY2-MEMBER');

    const res = await request(app)
      .put(`/api/boards/${id}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('PARITY2-MEMBER')}`)
      .send({ canvas_data: '{}' });

    expect(res.status).toBe(200);
  });

  it('PARITY: a stranger on a private board is refused canvas edit, canvas read, and detail read (unchanged)', async () => {
    await registerStudent('PARITY3');
    await registerStudent('PARITY3-STRANGER');
    const { id } = await createBoardDirect({ ownerRoll: 'PARITY3', visibility: 'private' });
    const auth = `Bearer ${tokenFor('PARITY3-STRANGER')}`;

    expect((await request(app).put(`/api/boards/${id}/canvas`).set('Authorization', auth).send({ canvas_data: '{}' })).status).toBe(403);
    expect((await request(app).get(`/api/boards/${id}/canvas`).set('Authorization', auth)).status).toBe(403);
    expect((await request(app).get(`/api/boards/${id}`).set('Authorization', auth)).status).toBe(403);
  });

  it('PARITY: an archived board refuses canvas writes for the owner too (the exact bug class this whole permission model exists to prevent)', async () => {
    await registerStudent('PARITY4');
    const { id } = await createBoardDirect({ ownerRoll: 'PARITY4', isArchived: true });

    const res = await request(app)
      .put(`/api/boards/${id}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('PARITY4')}`)
      .send({ canvas_data: '{}' });

    expect(res.status).toBe(403);
  });

  it('PARITY: edit_mode=anyone on a shared board still lets a non-member write (unchanged)', async () => {
    await registerStudent('PARITY5');
    await registerStudent('PARITY5-ANYONE');
    const { id } = await createBoardDirect({ ownerRoll: 'PARITY5', visibility: 'shared', editMode: 'anyone' });

    const res = await request(app)
      .put(`/api/boards/${id}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('PARITY5-ANYONE')}`)
      .send({ canvas_data: '{}' });

    expect(res.status).toBe(200);
  });

  // NEW BEHAVIOR: these REST mutation routes now pick up workspace-
  // ceiling access for free via getBoardRole, without any workspace-
  // specific code added to boards.ts itself.

  it('a workspace member (no board_members row) can now edit canvas on a SHARED board via the REST path, not just realtime', async () => {
    await registerStudent('WSCONSOL1');
    await registerStudent('WSCONSOL1-MEMBER');
    const { id, workspaceId } = await createBoardDirect({ ownerRoll: 'WSCONSOL1', visibility: 'shared' });
    await addWorkspaceMemberDirect(workspaceId, 'WSCONSOL1-MEMBER');

    const res = await request(app)
      .put(`/api/boards/${id}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('WSCONSOL1-MEMBER')}`)
      .send({ canvas_data: '{}' });

    expect(res.status).toBe(200);
  });

  it('the same workspace member is still refused on a PRIVATE board with no explicit grant — the narrowing lever holds on the REST path too', async () => {
    await registerStudent('WSCONSOL2');
    await registerStudent('WSCONSOL2-MEMBER');
    const { id, workspaceId } = await createBoardDirect({ ownerRoll: 'WSCONSOL2', visibility: 'private' });
    await addWorkspaceMemberDirect(workspaceId, 'WSCONSOL2-MEMBER');

    const res = await request(app)
      .put(`/api/boards/${id}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('WSCONSOL2-MEMBER')}`)
      .send({ canvas_data: '{}' });

    expect(res.status).toBe(403);
  });

  it('a workspace member gets 403 (not 200) editing canvas on an ARCHIVED shared board via ceiling-only access — REST path holds the write freeze', async () => {
    await registerStudent('WSCONSOL3');
    await registerStudent('WSCONSOL3-MEMBER');
    const { id, workspaceId } = await createBoardDirect({ ownerRoll: 'WSCONSOL3', visibility: 'shared', isArchived: true });
    await addWorkspaceMemberDirect(workspaceId, 'WSCONSOL3-MEMBER');

    const res = await request(app)
      .put(`/api/boards/${id}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('WSCONSOL3-MEMBER')}`)
      .send({ canvas_data: '{}' });

    expect(res.status).toBe(403);
  });

  it('ownership itself is never granted by workspace role — only isOwner-gated routes (rename, delete, member management) stay owner-only', async () => {
    await registerStudent('WSCONSOL4');
    await registerStudent('WSCONSOL4-MEMBER');
    const { id, workspaceId } = await createBoardDirect({ ownerRoll: 'WSCONSOL4', visibility: 'shared' });
    await addWorkspaceMemberDirect(workspaceId, 'WSCONSOL4-MEMBER');

    const rename = await request(app)
      .put(`/api/boards/${id}`)
      .set('Authorization', `Bearer ${tokenFor('WSCONSOL4-MEMBER')}`)
      .send({ name: 'Hijacked' });
    expect(rename.status).toBe(403);

    const del = await request(app)
      .delete(`/api/boards/${id}`)
      .set('Authorization', `Bearer ${tokenFor('WSCONSOL4-MEMBER')}`);
    expect(del.status).toBe(403);
  });
});

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

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

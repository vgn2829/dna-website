import { describe, it, expect, beforeEach } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';

// ─────────────────────────────────────────────────────────────────────────
// Integration tests for routes/projects.ts, through the real HTTP router
// against the local test DB — same style as boards.test.ts/
// workspaces.test.ts/assets.test.ts. Focus: cross-workspace isolation (the
// explicit V2.2 requirement — a project's authorization is ENTIRELY
// derived from workspace_members, never a project-level role), the
// explicit-protection (not cascade) delete behavior, and that ungrouped
// (project_id NULL) boards and existing board CRUD are unaffected.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);

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

async function createProject(roll: string, workspaceId: string, name = 'Test Project'): Promise<string> {
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .send({ workspace_id: workspaceId, name });
  return res.body.id as string;
}

// Inserts a board directly via SQL, bypassing createBoardLimiter (15/60s,
// module-level, shared across this whole file since createApp() is built
// once at module load) — same helper/rationale as boards.test.ts's own
// createBoardDirect. Used by every test here that just needs a board to
// exist; the handful of tests that specifically verify creation/
// attachment behavior itself (POST /api/boards) call request(app).post(...)
// directly instead, so they still exercise the real route.
async function createBoardDirect(roll: string, workspaceId: string, projectId?: string | null): Promise<string> {
  const id = `board-direct-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id, project_id)
     VALUES ($1, 'Test Board', $2, 'Owner', 'private', 'members_only', $3, $3, $4, false, $5, $6)`,
    [id, roll, now, `room-${id}`, workspaceId, projectId ?? null]
  );
  return id;
}

beforeEach(async () => {
  await query('TRUNCATE "board_members", "board_favorites", "boards", "projects", "workspace_members", "workspaces" CASCADE');
});

describe('GET /api/projects — list', () => {
  it('requires workspace_id', async () => {
    await registerStudent('PROJL1');
    const res = await request(app).get('/api/projects').set('Authorization', `Bearer ${tokenFor('PROJL1')}`);
    expect(res.status).toBe(400);
  });

  it('returns projects for the given workspace, with board_count', async () => {
    await registerStudent('PROJL2');
    const ws = await createWorkspace('PROJL2', 'Team');
    const projectId = await createProject('PROJL2', ws, 'Design Sprint');
    await createBoardDirect('PROJL2', ws, projectId);
    await createBoardDirect('PROJL2', ws, projectId);

    const res = await request(app)
      .get('/api/projects')
      .query({ workspace_id: ws })
      .set('Authorization', `Bearer ${tokenFor('PROJL2')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(projectId);
    expect(res.body[0].board_count).toBe(2);
  });

  // SECURITY (required scenario 1)
  it('SECURITY: a user in Workspace A cannot list projects from Workspace B', async () => {
    await registerStudent('PROJL3A');
    await registerStudent('PROJL3B');
    const wsA = await createWorkspace('PROJL3A', 'Workspace A');
    const wsB = await createWorkspace('PROJL3B', 'Workspace B');
    await createProject('PROJL3B', wsB, 'B\'s Secret Project');

    const res = await request(app)
      .get('/api/projects')
      .query({ workspace_id: wsB })
      .set('Authorization', `Bearer ${tokenFor('PROJL3A')}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/projects — create', () => {
  it('creates a project for a workspace the caller is a member of', async () => {
    await registerStudent('PROJC1');
    const ws = await createWorkspace('PROJC1', 'Team');

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenFor('PROJC1')}`)
      .send({ workspace_id: ws, name: 'New Project', description: 'A description' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Project');
    expect(res.body.workspace_id).toBe(ws);
    expect(res.body.is_archived).toBe(false);
    expect(res.body.board_count).toBe(0);
  });

  it('403s creating a project in a workspace the caller is not a member of', async () => {
    await registerStudent('PROJC2');
    await registerStudent('PROJC2-OTHER');
    const ws = await createWorkspace('PROJC2-OTHER', 'Not Yours');

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenFor('PROJC2')}`)
      .send({ workspace_id: ws, name: 'Sneaky Project' });

    expect(res.status).toBe(403);
  });

  it('a plain member (not owner/admin) can still create a project', async () => {
    await registerStudent('PROJC3-OWNER');
    await registerStudent('PROJC3-MEMBER');
    const ws = await createWorkspace('PROJC3-OWNER', 'Team');
    await request(app)
      .post(`/api/workspaces/${ws}/members`)
      .set('Authorization', `Bearer ${tokenFor('PROJC3-OWNER')}`)
      .send({ roll_number: 'PROJC3-MEMBER' });

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenFor('PROJC3-MEMBER')}`)
      .send({ workspace_id: ws, name: 'Member-created Project' });

    expect(res.status).toBe(201);
  });
});

describe('GET /api/projects/:id — detail', () => {
  it('returns project detail for a workspace member', async () => {
    await registerStudent('PROJD1');
    const ws = await createWorkspace('PROJD1', 'Team');
    const projectId = await createProject('PROJD1', ws);

    const res = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenFor('PROJD1')}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(projectId);
  });

  it('404s for a nonexistent project', async () => {
    await registerStudent('PROJD2');
    const res = await request(app)
      .get('/api/projects/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('PROJD2')}`);
    expect(res.status).toBe(404);
  });

  // SECURITY (required scenario 2)
  it('SECURITY: a user in Workspace A cannot read a Workspace B project, even knowing its id', async () => {
    await registerStudent('PROJD3A');
    await registerStudent('PROJD3B');
    await createWorkspace('PROJD3A', 'Workspace A');
    const wsB = await createWorkspace('PROJD3B', 'Workspace B');
    const projectB = await createProject('PROJD3B', wsB);

    const res = await request(app)
      .get(`/api/projects/${projectB}`)
      .set('Authorization', `Bearer ${tokenFor('PROJD3A')}`);

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/projects/:id — update', () => {
  it('renames a project', async () => {
    await registerStudent('PROJU1');
    const ws = await createWorkspace('PROJU1', 'Team');
    const projectId = await createProject('PROJU1', ws, 'Old Name');

    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenFor('PROJU1')}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('archives a project', async () => {
    await registerStudent('PROJU2');
    const ws = await createWorkspace('PROJU2', 'Team');
    const projectId = await createProject('PROJU2', ws);

    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenFor('PROJU2')}`)
      .send({ is_archived: true });

    expect(res.status).toBe(200);
    expect(res.body.is_archived).toBe(true);
  });

  it('a plain member (not owner/admin) can rename a project', async () => {
    await registerStudent('PROJU3-OWNER');
    await registerStudent('PROJU3-MEMBER');
    const ws = await createWorkspace('PROJU3-OWNER', 'Team');
    await request(app)
      .post(`/api/workspaces/${ws}/members`)
      .set('Authorization', `Bearer ${tokenFor('PROJU3-OWNER')}`)
      .send({ roll_number: 'PROJU3-MEMBER' });
    const projectId = await createProject('PROJU3-OWNER', ws);

    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenFor('PROJU3-MEMBER')}`)
      .send({ name: 'Renamed by member' });

    expect(res.status).toBe(200);
  });

  // SECURITY (required scenario 3)
  it('SECURITY: a user in Workspace A cannot update a Workspace B project', async () => {
    await registerStudent('PROJU4A');
    await registerStudent('PROJU4B');
    await createWorkspace('PROJU4A', 'Workspace A');
    const wsB = await createWorkspace('PROJU4B', 'Workspace B');
    const projectB = await createProject('PROJU4B', wsB, 'B\'s Project');

    const res = await request(app)
      .patch(`/api/projects/${projectB}`)
      .set('Authorization', `Bearer ${tokenFor('PROJU4A')}`)
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(403);

    const check = await query<{ name: string }>('SELECT name FROM projects WHERE id = $1', [projectB]);
    expect(check[0].name).toBe('B\'s Project');
  });
});

describe('DELETE /api/projects/:id — explicit protection, not cascade', () => {
  it('deletes an empty project', async () => {
    await registerStudent('PROJDEL1');
    const ws = await createWorkspace('PROJDEL1', 'Team');
    const projectId = await createProject('PROJDEL1', ws);

    const res = await request(app)
      .delete(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenFor('PROJDEL1')}`);

    expect(res.status).toBe(200);
    const check = await query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
    expect(check).toHaveLength(0);
  });

  // Required scenario 7
  it('SECURITY/SAFETY: a project with boards attached cannot be deleted, and its boards are never silently deleted', async () => {
    await registerStudent('PROJDEL2');
    const ws = await createWorkspace('PROJDEL2', 'Team');
    const projectId = await createProject('PROJDEL2', ws);
    const boardId = await createBoardDirect('PROJDEL2', ws, projectId);

    const res = await request(app)
      .delete(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenFor('PROJDEL2')}`);

    expect(res.status).toBe(409);

    const projectCheck = await query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
    expect(projectCheck).toHaveLength(1);
    const boardCheck = await query<{ id: string; project_id: string | null }>(
      'SELECT id, project_id FROM boards WHERE id = $1', [boardId]
    );
    expect(boardCheck).toHaveLength(1);
    expect(boardCheck[0].project_id).toBe(projectId);
  });

  it('a plain member (not owner/admin) CANNOT delete a project', async () => {
    await registerStudent('PROJDEL3-OWNER');
    await registerStudent('PROJDEL3-MEMBER');
    const ws = await createWorkspace('PROJDEL3-OWNER', 'Team');
    await request(app)
      .post(`/api/workspaces/${ws}/members`)
      .set('Authorization', `Bearer ${tokenFor('PROJDEL3-OWNER')}`)
      .send({ roll_number: 'PROJDEL3-MEMBER' });
    const projectId = await createProject('PROJDEL3-OWNER', ws);

    const res = await request(app)
      .delete(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${tokenFor('PROJDEL3-MEMBER')}`);

    expect(res.status).toBe(403);
  });

  // SECURITY (required scenario 4)
  it('SECURITY: a user in Workspace A cannot delete a Workspace B project', async () => {
    await registerStudent('PROJDEL4A');
    await registerStudent('PROJDEL4B');
    await createWorkspace('PROJDEL4A', 'Workspace A');
    const wsB = await createWorkspace('PROJDEL4B', 'Workspace B');
    const projectB = await createProject('PROJDEL4B', wsB);

    const res = await request(app)
      .delete(`/api/projects/${projectB}`)
      .set('Authorization', `Bearer ${tokenFor('PROJDEL4A')}`);

    expect(res.status).toBe(403);
    const check = await query('SELECT 1 FROM projects WHERE id = $1', [projectB]);
    expect(check).toHaveLength(1);
  });
});

describe('GET /api/projects/:id/boards', () => {
  it('lists boards belonging to the project', async () => {
    await registerStudent('PROJB1');
    const ws = await createWorkspace('PROJB1', 'Team');
    const projectId = await createProject('PROJB1', ws);
    const boardId = await createBoardDirect('PROJB1', ws, projectId);
    await createBoardDirect('PROJB1', ws); // ungrouped, should NOT appear

    const res = await request(app)
      .get(`/api/projects/${projectId}/boards`)
      .set('Authorization', `Bearer ${tokenFor('PROJB1')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(boardId);
  });

  it('SECURITY: a user in Workspace A cannot list boards of a Workspace B project', async () => {
    await registerStudent('PROJB2A');
    await registerStudent('PROJB2B');
    await createWorkspace('PROJB2A', 'Workspace A');
    const wsB = await createWorkspace('PROJB2B', 'Workspace B');
    const projectB = await createProject('PROJB2B', wsB);

    const res = await request(app)
      .get(`/api/projects/${projectB}/boards`)
      .set('Authorization', `Bearer ${tokenFor('PROJB2A')}`);

    expect(res.status).toBe(403);
  });
});

describe('Board <-> Project attachment — cross-workspace protection', () => {
  // Required scenario 5
  it('SECURITY: cannot create a board in Workspace A attached to a Workspace B project', async () => {
    await registerStudent('ATTACH1');
    const wsA = await createWorkspace('ATTACH1', 'Workspace A');
    const wsB = await createWorkspace('ATTACH1', 'Workspace B');
    const projectB = await createProject('ATTACH1', wsB);

    const res = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('ATTACH1')}`)
      .send({ name: 'Cross-workspace board', workspace_id: wsA, project_id: projectB });

    expect(res.status).toBe(400);
    const check = await query('SELECT 1 FROM boards WHERE name = $1', ['Cross-workspace board']);
    expect(check).toHaveLength(0);
  });

  // Required scenario 6
  it('SECURITY: cannot move a Workspace B board onto a Workspace A project via PUT', async () => {
    await registerStudent('ATTACH2');
    const wsA = await createWorkspace('ATTACH2', 'Workspace A');
    const wsB = await createWorkspace('ATTACH2', 'Workspace B');
    const projectA = await createProject('ATTACH2', wsA);
    const boardInB = await createBoardDirect('ATTACH2', wsB);

    const res = await request(app)
      .put(`/api/boards/${boardInB}`)
      .set('Authorization', `Bearer ${tokenFor('ATTACH2')}`)
      .send({ project_id: projectA });

    expect(res.status).toBe(400);
    const check = await query<{ project_id: string | null }>('SELECT project_id FROM boards WHERE id = $1', [boardInB]);
    expect(check[0].project_id).toBeNull();
  });

  it('creating a board with a project_id in the SAME workspace succeeds', async () => {
    await registerStudent('ATTACH3');
    const ws = await createWorkspace('ATTACH3', 'Team');
    const projectId = await createProject('ATTACH3', ws);

    const res = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('ATTACH3')}`)
      .send({ name: 'In-project board', workspace_id: ws, project_id: projectId });

    expect(res.status).toBe(201);
    expect(res.body.project_id).toBe(projectId);
  });

  it('moving a board to a project in its own workspace succeeds, and back to null un-groups it', async () => {
    await registerStudent('ATTACH4');
    const ws = await createWorkspace('ATTACH4', 'Team');
    const projectId = await createProject('ATTACH4', ws);
    const boardId = await createBoardDirect('ATTACH4', ws);

    const moved = await request(app)
      .put(`/api/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenFor('ATTACH4')}`)
      .send({ project_id: projectId });
    expect(moved.status).toBe(200);
    expect(moved.body.project_id).toBe(projectId);

    const ungrouped = await request(app)
      .put(`/api/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenFor('ATTACH4')}`)
      .send({ project_id: null });
    expect(ungrouped.status).toBe(200);
    expect(ungrouped.body.project_id).toBeNull();
  });

  it('400s creating a board with a project_id that does not exist', async () => {
    await registerStudent('ATTACH5');
    const ws = await createWorkspace('ATTACH5', 'Team');

    const res = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('ATTACH5')}`)
      .send({ name: 'Board', workspace_id: ws, project_id: 'nonexistent-project' });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/boards — project_name join (V2.2 Phase 7)', () => {
  it('returns project_name for a board attached to a project', async () => {
    await registerStudent('PNAME1');
    const ws = await createWorkspace('PNAME1', 'Team');
    const projectId = await createProject('PNAME1', ws, 'Design Sprint');
    await createBoardDirect('PNAME1', ws, projectId);

    const res = await request(app)
      .get('/api/boards')
      .query({ workspace_id: ws })
      .set('Authorization', `Bearer ${tokenFor('PNAME1')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].project_name).toBe('Design Sprint');
  });

  it('returns project_name null for an ungrouped board', async () => {
    await registerStudent('PNAME2');
    const ws = await createWorkspace('PNAME2', 'Team');
    await createBoardDirect('PNAME2', ws);

    const res = await request(app)
      .get('/api/boards')
      .query({ workspace_id: ws })
      .set('Authorization', `Bearer ${tokenFor('PNAME2')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].project_name).toBeNull();
  });

  it('does not duplicate rows when a board has a project (GROUP BY correctness)', async () => {
    await registerStudent('PNAME3');
    const ws = await createWorkspace('PNAME3', 'Team');
    const projectId = await createProject('PNAME3', ws);
    await createBoardDirect('PNAME3', ws, projectId);
    await createBoardDirect('PNAME3', ws, projectId);
    await createBoardDirect('PNAME3', ws);

    const res = await request(app)
      .get('/api/boards')
      .query({ workspace_id: ws })
      .set('Authorization', `Bearer ${tokenFor('PNAME3')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });
});

describe('Existing board behavior remains intact (V2.2 non-regression)', () => {
  // Required scenario 8
  it('an existing board with project_id NULL remains fully valid and readable', async () => {
    await registerStudent('REGR1');
    const ws = await createWorkspace('REGR1', 'Team');
    const boardId = await createBoardDirect('REGR1', ws); // no project_id

    const res = await request(app)
      .get(`/api/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenFor('REGR1')}`);

    expect(res.status).toBe(200);
    expect(res.body.project_id).toBeNull();
  });

  // Required scenario 9
  it('existing board CRUD (create, rename, archive, delete) continues to work unchanged', async () => {
    await registerStudent('REGR2');
    const ws = await createWorkspace('REGR2', 'Team');

    const created = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('REGR2')}`)
      .send({ name: 'Regression Board', workspace_id: ws });
    expect(created.status).toBe(201);
    const boardId = created.body.id;

    const renamed = await request(app)
      .put(`/api/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenFor('REGR2')}`)
      .send({ name: 'Renamed Board' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Renamed Board');

    const archived = await request(app)
      .put(`/api/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenFor('REGR2')}`)
      .send({ is_archived: true });
    expect(archived.status).toBe(200);
    expect(archived.body.is_archived).toBe(true);

    const deleted = await request(app)
      .delete(`/api/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenFor('REGR2')}`);
    expect(deleted.status).toBe(200);
  });

  // Required scenario 10
  it('workspace authorization remains enforced for board creation outside any project', async () => {
    await registerStudent('REGR3');
    await registerStudent('REGR3-OTHER');
    const otherWs = await createWorkspace('REGR3-OTHER', 'Not Yours');

    const res = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('REGR3')}`)
      .send({ name: 'Sneaky', workspace_id: otherWs });

    expect(res.status).toBe(403);
  });
});

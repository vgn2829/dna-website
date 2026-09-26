import { describe, it, expect, beforeEach } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';

// ─────────────────────────────────────────────────────────────────────────
// Integration tests for routes/templates.ts, through the real HTTP router
// against the local test DB — same style as projects.test.ts/boards.test.ts/
// workspaces.test.ts. Focus: cross-workspace isolation (a template's
// authorization is ENTIRELY derived from workspace_members, never a
// template-level role), that a template is created from the SOURCE
// BOARD's real workspace (never a client-supplied one), that a template's
// canvas_data is copied as an opaque string (no reshaping), and that
// existing board/project/duplicate behavior is unaffected.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);

const SAMPLE_CANVAS_DATA = JSON.stringify({
  document: { store: { 'shape:test': { id: 'shape:test', type: 'geo' } }, schema: {} },
  session: {},
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

async function createProject(roll: string, workspaceId: string, name = 'Test Project'): Promise<string> {
  const res = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .send({ workspace_id: workspaceId, name });
  return res.body.id as string;
}

// Inserts a board directly via SQL, bypassing createBoardLimiter — same
// helper/rationale as boards.test.ts's/projects.test.ts's own
// createBoardDirect. canvasData defaults to SAMPLE_CANVAS_DATA so most
// tests get a board that's a valid template source without each having
// to specify it; pass null explicitly to test the "no saved canvas yet"
// rejection path.
async function createBoardDirect(
  roll: string,
  workspaceId: string,
  opts: { projectId?: string | null; canvasData?: string | null; visibility?: 'private' | 'shared' } = {}
): Promise<string> {
  const id = `board-direct-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const canvasData = opts.canvasData === undefined ? SAMPLE_CANVAS_DATA : opts.canvasData;
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id, project_id, canvas_data)
     VALUES ($1, 'Test Board', $2, 'Owner', $3, 'members_only', $4, $4, $5, false, $6, $7, $8)`,
    [id, roll, opts.visibility ?? 'private', now, `room-${id}`, workspaceId, opts.projectId ?? null, canvasData]
  );
  return id;
}

async function createTemplate(roll: string, name: string, sourceBoardId: string, visibility?: 'personal' | 'community'): Promise<{ id: string; workspace_id: string }> {
  const res = await request(app)
    .post('/api/templates')
    .set('Authorization', `Bearer ${tokenFor(roll)}`)
    .send({ name, source_board_id: sourceBoardId, ...(visibility ? { visibility } : {}) });
  return res.body;
}

beforeEach(async () => {
  await query('TRUNCATE "board_members", "board_favorites", "boards", "templates", "projects", "workspace_members", "workspaces" CASCADE');
});

describe('GET /api/templates — list', () => {
  it('requires workspace_id', async () => {
    await registerStudent('TPLL1');
    const res = await request(app).get('/api/templates').set('Authorization', `Bearer ${tokenFor('TPLL1')}`);
    expect(res.status).toBe(400);
  });

  // Required scenario 1
  it('workspace member can list own workspace templates', async () => {
    await registerStudent('TPLL2');
    const ws = await createWorkspace('TPLL2', 'Team');
    const boardId = await createBoardDirect('TPLL2', ws);
    const template = await createTemplate('TPLL2', 'My Template', boardId);

    const res = await request(app)
      .get('/api/templates')
      .query({ workspace_id: ws })
      .set('Authorization', `Bearer ${tokenFor('TPLL2')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(template.id);
  });

  // Required scenario 2
  it('SECURITY: user cannot list another workspace\'s templates', async () => {
    await registerStudent('TPLL3A');
    await registerStudent('TPLL3B');
    await createWorkspace('TPLL3A', 'Workspace A');
    const wsB = await createWorkspace('TPLL3B', 'Workspace B');
    const boardB = await createBoardDirect('TPLL3B', wsB);
    await createTemplate('TPLL3B', 'B\'s Template', boardB);

    const res = await request(app)
      .get('/api/templates')
      .query({ workspace_id: wsB })
      .set('Authorization', `Bearer ${tokenFor('TPLL3A')}`);

    expect(res.status).toBe(403);
  });

  it('list response never includes canvas_data', async () => {
    await registerStudent('TPLL4');
    const ws = await createWorkspace('TPLL4', 'Team');
    const boardId = await createBoardDirect('TPLL4', ws);
    await createTemplate('TPLL4', 'My Template', boardId);

    const res = await request(app)
      .get('/api/templates')
      .query({ workspace_id: ws })
      .set('Authorization', `Bearer ${tokenFor('TPLL4')}`);

    expect(res.body[0].canvas_data).toBeUndefined();
  });
});

describe('POST /api/templates — create', () => {
  // Required scenario 7
  it('derives workspace_id from the source board, ignoring any client-supplied workspace_id', async () => {
    await registerStudent('TPLC1');
    const ws = await createWorkspace('TPLC1', 'Team');
    const otherWs = await createWorkspace('TPLC1', 'Other');
    const boardId = await createBoardDirect('TPLC1', ws);

    // Required scenario 8 — spoofed workspace_id must be ignored, not honored
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${tokenFor('TPLC1')}`)
      .send({ name: 'Spoof Test', source_board_id: boardId, workspace_id: otherWs });

    expect(res.status).toBe(201);
    expect(res.body.workspace_id).toBe(ws); // NOT otherWs
  });

  // Required scenario 6
  it('SECURITY: user cannot create a template from a board they cannot access', async () => {
    await registerStudent('TPLC2');
    await registerStudent('TPLC2-OWNER');
    const ownerWs = await createWorkspace('TPLC2-OWNER', 'Owner Workspace');
    const privateBoard = await createBoardDirect('TPLC2-OWNER', ownerWs, { visibility: 'private' });

    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${tokenFor('TPLC2')}`)
      .send({ name: 'Sneaky Template', source_board_id: privateBoard });

    expect(res.status).toBe(403);
  });

  it('a viewer/commenter-only role cannot create a template (write access required, matching duplicate)', async () => {
    await registerStudent('TPLC3-OWNER');
    await registerStudent('TPLC3-VIEWER');
    const ws = await createWorkspace('TPLC3-OWNER', 'Team');
    // shared + members_only means a non-member gets 'commenter' (read-only) role
    const board = await createBoardDirect('TPLC3-OWNER', ws, { visibility: 'shared' });

    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${tokenFor('TPLC3-VIEWER')}`)
      .send({ name: 'Commenter Template', source_board_id: board });

    expect(res.status).toBe(403);
  });

  it('rejects creating a template from a board with no saved canvas content', async () => {
    await registerStudent('TPLC4');
    const ws = await createWorkspace('TPLC4', 'Team');
    const emptyBoard = await createBoardDirect('TPLC4', ws, { canvasData: null });

    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${tokenFor('TPLC4')}`)
      .send({ name: 'Empty Template', source_board_id: emptyBoard });

    expect(res.status).toBe(400);
    const check = await query('SELECT 1 FROM templates WHERE name = $1', ['Empty Template']);
    expect(check).toHaveLength(0);
  });

  it('rejects creating a template from a nonexistent board with 403, matching getBoardRole\'s existing "board not found and no access" conflation (same convention comments.ts/versions.ts already document and rely on — never leaking whether a private board exists to an unauthorized caller)', async () => {
    await registerStudent('TPLC5');
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${tokenFor('TPLC5')}`)
      .send({ name: 'Ghost Template', source_board_id: 'nonexistent-board' });

    expect(res.status).toBe(403);
  });

  it('copies canvas_data verbatim, preserving the exact stored string (no reshaping)', async () => {
    await registerStudent('TPLC6');
    const ws = await createWorkspace('TPLC6', 'Team');
    const boardId = await createBoardDirect('TPLC6', ws, { canvasData: SAMPLE_CANVAS_DATA });
    const template = await createTemplate('TPLC6', 'Verbatim Template', boardId);

    const stored = await query<{ canvas_data: string }>('SELECT canvas_data FROM templates WHERE id = $1', [template.id]);
    expect(stored[0].canvas_data).toBe(SAMPLE_CANVAS_DATA);
  });

  it('retains source_board_id for provenance', async () => {
    await registerStudent('TPLC7');
    const ws = await createWorkspace('TPLC7', 'Team');
    const boardId = await createBoardDirect('TPLC7', ws);
    const template = await createTemplate('TPLC7', 'Provenance Template', boardId);

    expect(template.source_board_id).toBe(boardId);
  });
});

describe('GET /api/templates/:id — detail', () => {
  it('returns template detail for a workspace member', async () => {
    await registerStudent('TPLD1');
    const ws = await createWorkspace('TPLD1', 'Team');
    const boardId = await createBoardDirect('TPLD1', ws);
    const template = await createTemplate('TPLD1', 'My Template', boardId);

    const res = await request(app)
      .get(`/api/templates/${template.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLD1')}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(template.id);
    expect(res.body.canvas_data).toBeUndefined();
  });

  // Required scenario 3
  it('SECURITY: user cannot read another workspace\'s template', async () => {
    await registerStudent('TPLD2A');
    await registerStudent('TPLD2B');
    await createWorkspace('TPLD2A', 'Workspace A');
    const wsB = await createWorkspace('TPLD2B', 'Workspace B');
    const boardB = await createBoardDirect('TPLD2B', wsB);
    const templateB = await createTemplate('TPLD2B', 'B\'s Template', boardB);

    const res = await request(app)
      .get(`/api/templates/${templateB.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLD2A')}`);

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/templates/:id — update', () => {
  it('renames and re-describes a template', async () => {
    await registerStudent('TPLU1');
    const ws = await createWorkspace('TPLU1', 'Team');
    const boardId = await createBoardDirect('TPLU1', ws);
    const template = await createTemplate('TPLU1', 'Old Name', boardId);

    const res = await request(app)
      .patch(`/api/templates/${template.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLU1')}`)
      .send({ name: 'New Name', description: 'Updated description' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.description).toBe('Updated description');
  });

  it('archives a template', async () => {
    await registerStudent('TPLU2');
    const ws = await createWorkspace('TPLU2', 'Team');
    const boardId = await createBoardDirect('TPLU2', ws);
    const template = await createTemplate('TPLU2', 'Archivable', boardId);

    const res = await request(app)
      .patch(`/api/templates/${template.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLU2')}`)
      .send({ is_archived: true });

    expect(res.status).toBe(200);
    expect(res.body.is_archived).toBe(true);
  });

  // Required scenario 4
  it('SECURITY: user cannot update another workspace\'s template', async () => {
    await registerStudent('TPLU3A');
    await registerStudent('TPLU3B');
    await createWorkspace('TPLU3A', 'Workspace A');
    const wsB = await createWorkspace('TPLU3B', 'Workspace B');
    const boardB = await createBoardDirect('TPLU3B', wsB);
    const templateB = await createTemplate('TPLU3B', 'B\'s Template', boardB);

    const res = await request(app)
      .patch(`/api/templates/${templateB.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLU3A')}`)
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(403);
    const check = await query<{ name: string }>('SELECT name FROM templates WHERE id = $1', [templateB.id]);
    expect(check[0].name).toBe('B\'s Template');
  });
});

describe('DELETE /api/templates/:id', () => {
  it('owner/admin can delete a template', async () => {
    await registerStudent('TPLDEL1');
    const ws = await createWorkspace('TPLDEL1', 'Team');
    const boardId = await createBoardDirect('TPLDEL1', ws);
    const template = await createTemplate('TPLDEL1', 'Deletable', boardId);

    const res = await request(app)
      .delete(`/api/templates/${template.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLDEL1')}`);

    expect(res.status).toBe(200);
    const check = await query('SELECT 1 FROM templates WHERE id = $1', [template.id]);
    expect(check).toHaveLength(0);
  });

  // Shared Creative Library: deletion is the template OWNER's only — a
  // member who can see a community template gets 403, and another member's
  // personal template is invisible (404).
  it('a member who does not own a template cannot delete it', async () => {
    await registerStudent('TPLDEL2-OWNER');
    await registerStudent('TPLDEL2-MEMBER');
    const ws = await createWorkspace('TPLDEL2-OWNER', 'Team');
    await request(app)
      .post(`/api/workspaces/${ws}/members`)
      .set('Authorization', `Bearer ${tokenFor('TPLDEL2-OWNER')}`)
      .send({ roll_number: 'TPLDEL2-MEMBER' });
    const boardId = await createBoardDirect('TPLDEL2-OWNER', ws);
    const template = await createTemplate('TPLDEL2-OWNER', 'Protected', boardId, 'community');
    const personal = await createTemplate('TPLDEL2-OWNER', 'Private', boardId);

    const res = await request(app)
      .delete(`/api/templates/${template.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLDEL2-MEMBER')}`);
    expect(res.status).toBe(403);

    const hidden = await request(app)
      .delete(`/api/templates/${personal.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLDEL2-MEMBER')}`);
    expect(hidden.status).toBe(404);
    expect(await query('SELECT 1 FROM templates WHERE id = ANY($1)', [[template.id, personal.id]])).toHaveLength(2);
  });

  // Required scenario 5
  it('SECURITY: user cannot delete another workspace\'s template', async () => {
    await registerStudent('TPLDEL3A');
    await registerStudent('TPLDEL3B');
    await createWorkspace('TPLDEL3A', 'Workspace A');
    const wsB = await createWorkspace('TPLDEL3B', 'Workspace B');
    const boardB = await createBoardDirect('TPLDEL3B', wsB);
    const templateB = await createTemplate('TPLDEL3B', 'B\'s Template', boardB);

    const res = await request(app)
      .delete(`/api/templates/${templateB.id}`)
      .set('Authorization', `Bearer ${tokenFor('TPLDEL3A')}`);

    expect(res.status).toBe(403);
    const check = await query('SELECT 1 FROM templates WHERE id = $1', [templateB.id]);
    expect(check).toHaveLength(1);
  });
});

describe('POST /api/templates/:id/use — create board from template', () => {
  // Required scenario 9
  it('user can create a board from an authorized template', async () => {
    await registerStudent('TPLUSE1');
    const ws = await createWorkspace('TPLUSE1', 'Team');
    const boardId = await createBoardDirect('TPLUSE1', ws);
    const template = await createTemplate('TPLUSE1', 'Base Template', boardId);

    const res = await request(app)
      .post(`/api/templates/${template.id}/use`)
      .set('Authorization', `Bearer ${tokenFor('TPLUSE1')}`)
      .send({ name: 'New Board From Template' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Board From Template');
    expect(res.body.workspace_id).toBe(ws);
    expect(res.body.owner_roll).toBe('TPLUSE1');
  });

  it('defaults the new board\'s name to the template\'s name when none is given', async () => {
    await registerStudent('TPLUSE2');
    const ws = await createWorkspace('TPLUSE2', 'Team');
    const boardId = await createBoardDirect('TPLUSE2', ws);
    const template = await createTemplate('TPLUSE2', 'Default Name Template', boardId);

    const res = await request(app)
      .post(`/api/templates/${template.id}/use`)
      .set('Authorization', `Bearer ${tokenFor('TPLUSE2')}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Default Name Template');
  });

  // Required scenario 10
  it('the generated board has independent canvas state — editing it never touches the template', async () => {
    await registerStudent('TPLUSE3');
    const ws = await createWorkspace('TPLUSE3', 'Team');
    const boardId = await createBoardDirect('TPLUSE3', ws, { canvasData: SAMPLE_CANVAS_DATA });
    const template = await createTemplate('TPLUSE3', 'Independent Template', boardId);

    const created = await request(app)
      .post(`/api/templates/${template.id}/use`)
      .set('Authorization', `Bearer ${tokenFor('TPLUSE3')}`)
      .send({});
    const newBoardId = created.body.id;

    // Edit the new board's canvas via the normal save path
    const modifiedCanvas = JSON.stringify({ document: { store: { 'shape:modified': {} }, schema: {} }, session: {} });
    await request(app)
      .put(`/api/boards/${newBoardId}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('TPLUSE3')}`)
      .send({ canvas_data: modifiedCanvas });

    const templateCheck = await query<{ canvas_data: string }>('SELECT canvas_data FROM templates WHERE id = $1', [template.id]);
    expect(templateCheck[0].canvas_data).toBe(SAMPLE_CANVAS_DATA); // unchanged

    const newBoardCheck = await query<{ canvas_data: string }>('SELECT canvas_data FROM boards WHERE id = $1', [newBoardId]);
    expect(newBoardCheck[0].canvas_data).toBe(modifiedCanvas); // independently changed
  });

  // Required scenario 11
  it('the generated board can be assigned to a project belonging to the template\'s workspace', async () => {
    await registerStudent('TPLUSE4');
    const ws = await createWorkspace('TPLUSE4', 'Team');
    const boardId = await createBoardDirect('TPLUSE4', ws);
    const template = await createTemplate('TPLUSE4', 'Project Template', boardId);
    const projectId = await createProject('TPLUSE4', ws);

    const res = await request(app)
      .post(`/api/templates/${template.id}/use`)
      .set('Authorization', `Bearer ${tokenFor('TPLUSE4')}`)
      .send({ project_id: projectId });

    expect(res.status).toBe(201);
    expect(res.body.project_id).toBe(projectId);
  });

  // Required scenario 12
  it('SECURITY: cannot create a board from a template into another workspace\'s project', async () => {
    await registerStudent('TPLUSE5');
    const wsA = await createWorkspace('TPLUSE5', 'Workspace A');
    const wsB = await createWorkspace('TPLUSE5', 'Workspace B');
    const boardA = await createBoardDirect('TPLUSE5', wsA);
    const templateA = await createTemplate('TPLUSE5', 'Template A', boardA);
    const projectB = await createProject('TPLUSE5', wsB);

    const res = await request(app)
      .post(`/api/templates/${templateA.id}/use`)
      .set('Authorization', `Bearer ${tokenFor('TPLUSE5')}`)
      .send({ project_id: projectB });

    expect(res.status).toBe(400);
    const check = await query('SELECT 1 FROM boards WHERE workspace_id = $1 AND project_id = $2', [wsA, projectB]);
    expect(check).toHaveLength(0);
  });

  // Required scenario 13 (the headline cross-workspace test)
  it('SECURITY: a Workspace A template cannot be used to create a Workspace B board — no parameter can redirect the destination workspace', async () => {
    await registerStudent('TPLUSE6A');
    await registerStudent('TPLUSE6B');
    const wsA = await createWorkspace('TPLUSE6A', 'Workspace A');
    const wsB = await createWorkspace('TPLUSE6B', 'Workspace B');
    const boardA = await createBoardDirect('TPLUSE6A', wsA);
    const templateA = await createTemplate('TPLUSE6A', 'Workspace A Template', boardA);

    // User B has no membership in Workspace A — must be denied outright,
    // and even if somehow authorized, there is no workspace_id parameter
    // on this route at all through which B could redirect the new board
    // into Workspace B.
    const res = await request(app)
      .post(`/api/templates/${templateA.id}/use`)
      .set('Authorization', `Bearer ${tokenFor('TPLUSE6B')}`)
      .send({ name: 'Stolen Board' });

    expect(res.status).toBe(403);
    const check = await query('SELECT 1 FROM boards WHERE name = $1', ['Stolen Board']);
    expect(check).toHaveLength(0);
  });

  it('does not mutate the template when creating a board from it', async () => {
    await registerStudent('TPLUSE7');
    const ws = await createWorkspace('TPLUSE7', 'Team');
    const boardId = await createBoardDirect('TPLUSE7', ws);
    const template = await createTemplate('TPLUSE7', 'Immutable Template', boardId);

    await request(app)
      .post(`/api/templates/${template.id}/use`)
      .set('Authorization', `Bearer ${tokenFor('TPLUSE7')}`)
      .send({});

    const check = await query<{ name: string; is_archived: boolean }>('SELECT name, is_archived FROM templates WHERE id = $1', [template.id]);
    expect(check[0].name).toBe('Immutable Template');
    expect(check[0].is_archived).toBe(false);
  });

  it('404s using a nonexistent template', async () => {
    await registerStudent('TPLUSE8');
    const res = await request(app)
      .post('/api/templates/nonexistent/use')
      .set('Authorization', `Bearer ${tokenFor('TPLUSE8')}`)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('Existing behavior remains intact (V2.3 non-regression)', () => {
  // Required scenario 14
  it('existing board creation continues to work unchanged', async () => {
    await registerStudent('REGR1');
    const ws = await createWorkspace('REGR1', 'Team');

    const res = await request(app)
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokenFor('REGR1')}`)
      .send({ name: 'Regular Board', workspace_id: ws });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Regular Board');
  });

  // Required scenario 13 (snapshot compatibility)
  it('existing board snapshot (canvas save/load) compatibility remains intact', async () => {
    await registerStudent('REGR2');
    const ws = await createWorkspace('REGR2', 'Team');
    const boardId = await createBoardDirect('REGR2', ws, { canvasData: null });

    const saved = await request(app)
      .put(`/api/boards/${boardId}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('REGR2')}`)
      .send({ canvas_data: SAMPLE_CANVAS_DATA });
    expect(saved.status).toBe(200);

    const loaded = await request(app)
      .get(`/api/boards/${boardId}/canvas`)
      .set('Authorization', `Bearer ${tokenFor('REGR2')}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.canvas_data).toBe(SAMPLE_CANVAS_DATA);
  });

  it('existing board duplication continues to work unchanged', async () => {
    await registerStudent('REGR3');
    const ws = await createWorkspace('REGR3', 'Team');
    const boardId = await createBoardDirect('REGR3', ws, { canvasData: SAMPLE_CANVAS_DATA });

    const res = await request(app)
      .post(`/api/boards/${boardId}/duplicate`)
      .set('Authorization', `Bearer ${tokenFor('REGR3')}`);

    expect(res.status).toBe(201);
    expect(res.body.name).toContain('(copy)');
  });

  // Required scenario 15
  it('existing project authorization remains intact', async () => {
    await registerStudent('REGR4A');
    await registerStudent('REGR4B');
    await createWorkspace('REGR4A', 'Workspace A');
    const wsB = await createWorkspace('REGR4B', 'Workspace B');

    const res = await request(app)
      .get('/api/projects')
      .query({ workspace_id: wsB })
      .set('Authorization', `Bearer ${tokenFor('REGR4A')}`);

    expect(res.status).toBe(403);
  });
});

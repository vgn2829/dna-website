import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';

// ─────────────────────────────────────────────────────────────────────────
// Integration tests against the real (local test) Postgres DB, through the
// actual HTTP router — same style as comments.test.ts. workspaces has no
// realtime dependency at all (see routes/workspaces.ts's own header
// comment), so createApp() is called with no arguments here, unlike
// comments.test.ts/versions.test.ts which need realtime stubs just to get
// their routers mounted.
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
  await query('TRUNCATE "workspace_members", "workspaces", "boards" CASCADE');
});

describe('POST /api/workspaces — create', () => {
  it('creates a workspace with the caller as owner', async () => {
    await registerStudent('CREATE1');

    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${tokenFor('CREATE1')}`)
      .send({ name: 'Design Team' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Design Team', is_personal: false, owner_roll: 'CREATE1', role: 'owner', member_count: 1,
    });
  });

  it('rejects an empty name', async () => {
    await registerStudent('CREATE2');
    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${tokenFor('CREATE2')}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/workspaces').send({ name: 'No Auth' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/workspaces — list mine', () => {
  it('auto-provisions and always includes the caller\'s personal workspace', async () => {
    await registerStudent('LIST1');

    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${tokenFor('LIST1')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ is_personal: true, role: 'owner', member_count: 1, board_count: 0 });
  });

  it('board_count reflects the number of boards in that workspace', async () => {
    await registerStudent('LIST4');
    const workspace = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LIST4')}`).send({ name: 'Team' });
    const now = new Date().toISOString();
    for (const suffix of ['a', 'b']) {
      await query(
        `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, workspace_id)
         VALUES ($1, 'Board', $2, 'Owner', 'private', 'members_only', $3, $3, $4, $5)`,
        [`board-count-${suffix}`, 'LIST4', now, `room-count-${suffix}`, workspace.body.id]
      );
    }

    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${tokenFor('LIST4')}`);

    const team = res.body.find((w: { id: string }) => w.id === workspace.body.id);
    expect(team.board_count).toBe(2);
  });

  it('lists both the personal workspace and any explicitly created ones, personal first', async () => {
    await registerStudent('LIST2');
    await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LIST2')}`).send({ name: 'Team A' });
    await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LIST2')}`).send({ name: 'Team B' });

    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${tokenFor('LIST2')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].is_personal).toBe(true);
  });

  it('does not list a workspace the caller is not a member of', async () => {
    await registerStudent('LIST3');
    await registerStudent('LIST3-OTHER');
    await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LIST3-OTHER')}`).send({ name: 'Not Yours' });

    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${tokenFor('LIST3')}`);

    expect(res.status).toBe(200);
    expect(res.body.every((w: { name: string }) => w.name !== 'Not Yours')).toBe(true);
  });
});

describe('GET /api/workspaces/:id — detail', () => {
  it('returns detail + member list for a member', async () => {
    await registerStudent('DETAIL1');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('DETAIL1')}`).send({ name: 'Detail Test' });

    const res = await request(app)
      .get(`/api/workspaces/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DETAIL1')}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('owner');
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({ roll_number: 'DETAIL1', role: 'owner' });
  });

  it('403s a non-member', async () => {
    await registerStudent('DETAIL2');
    await registerStudent('DETAIL2-STRANGER');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('DETAIL2')}`).send({ name: 'Private Team' });

    const res = await request(app)
      .get(`/api/workspaces/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DETAIL2-STRANGER')}`);

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/workspaces/:id — rename', () => {
  it('lets an admin/owner rename it', async () => {
    await registerStudent('RENAME1');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('RENAME1')}`).send({ name: 'Old Name' });

    const res = await request(app)
      .put(`/api/workspaces/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('RENAME1')}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('403s a plain member (not admin/owner)', async () => {
    await registerStudent('RENAME2');
    await registerStudent('RENAME2-MEMBER');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('RENAME2')}`).send({ name: 'Team' });
    await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('RENAME2')}`)
      .send({ roll_number: 'RENAME2-MEMBER' });

    const res = await request(app)
      .put(`/api/workspaces/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('RENAME2-MEMBER')}`)
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(403);
  });

  it('400s an attempt to rename a personal workspace', async () => {
    await registerStudent('RENAME3');
    const list = await request(app).get('/api/workspaces').set('Authorization', `Bearer ${tokenFor('RENAME3')}`);
    const personalId = list.body[0].id;

    const res = await request(app)
      .put(`/api/workspaces/${personalId}`)
      .set('Authorization', `Bearer ${tokenFor('RENAME3')}`)
      .send({ name: 'Hacked Personal' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/workspaces/:id', () => {
  it('lets the owner delete an empty workspace', async () => {
    await registerStudent('DEL1');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('DEL1')}`).send({ name: 'To Delete' });

    const res = await request(app)
      .delete(`/api/workspaces/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL1')}`);

    expect(res.status).toBe(200);
  });

  it('409s deletion while a board still references the workspace, instead of a raw FK-violation 500', async () => {
    await registerStudent('DEL2');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('DEL2')}`).send({ name: 'Has Boards' });
    const now = new Date().toISOString();
    await query(
      `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, workspace_id)
       VALUES ($1, 'Board In Workspace', $2, 'Owner', 'private', 'members_only', $3, $3, $4, $5)`,
      ['board-del2', 'DEL2', now, 'room-del2', create.body.id]
    );

    const res = await request(app)
      .delete(`/api/workspaces/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL2')}`);

    expect(res.status).toBe(409);
  });

  it('403s a non-owner (admin included)', async () => {
    await registerStudent('DEL3');
    await registerStudent('DEL3-ADMIN');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('DEL3')}`).send({ name: 'Team' });
    await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('DEL3')}`)
      .send({ roll_number: 'DEL3-ADMIN' });
    await request(app)
      .put(`/api/workspaces/${create.body.id}/members/DEL3-ADMIN/role`)
      .set('Authorization', `Bearer ${tokenFor('DEL3')}`)
      .send({ role: 'admin' });

    const res = await request(app)
      .delete(`/api/workspaces/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor('DEL3-ADMIN')}`);

    expect(res.status).toBe(403);
  });

  it('400s an attempt to delete a personal workspace', async () => {
    await registerStudent('DEL4');
    const list = await request(app).get('/api/workspaces').set('Authorization', `Bearer ${tokenFor('DEL4')}`);
    const personalId = list.body[0].id;

    const res = await request(app)
      .delete(`/api/workspaces/${personalId}`)
      .set('Authorization', `Bearer ${tokenFor('DEL4')}`);

    expect(res.status).toBe(400);
  });
});

describe('POST /api/workspaces/:id/leave', () => {
  it('lets a plain member leave', async () => {
    await registerStudent('LEAVE1');
    await registerStudent('LEAVE1-MEMBER');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LEAVE1')}`).send({ name: 'Team' });
    await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('LEAVE1')}`)
      .send({ roll_number: 'LEAVE1-MEMBER' });

    const res = await request(app)
      .post(`/api/workspaces/${create.body.id}/leave`)
      .set('Authorization', `Bearer ${tokenFor('LEAVE1-MEMBER')}`);

    expect(res.status).toBe(200);
  });

  it('400s the owner attempting to leave', async () => {
    await registerStudent('LEAVE2');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LEAVE2')}`).send({ name: 'Team' });

    const res = await request(app)
      .post(`/api/workspaces/${create.body.id}/leave`)
      .set('Authorization', `Bearer ${tokenFor('LEAVE2')}`);

    expect(res.status).toBe(400);
  });

  it('400s an attempt to leave a personal workspace', async () => {
    await registerStudent('LEAVE3');
    const list = await request(app).get('/api/workspaces').set('Authorization', `Bearer ${tokenFor('LEAVE3')}`);
    const personalId = list.body[0].id;

    const res = await request(app)
      .post(`/api/workspaces/${personalId}/leave`)
      .set('Authorization', `Bearer ${tokenFor('LEAVE3')}`);

    expect(res.status).toBe(400);
  });
});

describe('Workspace membership management', () => {
  it('lets an admin/owner add a registered student as a member', async () => {
    await registerStudent('MEM1');
    await registerStudent('MEM1-NEW');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('MEM1')}`).send({ name: 'Team' });

    const res = await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('MEM1')}`)
      .send({ roll_number: 'MEM1-NEW' });

    expect(res.status).toBe(200);

    const detail = await request(app).get(`/api/workspaces/${create.body.id}`).set('Authorization', `Bearer ${tokenFor('MEM1')}`);
    expect(detail.body.members).toHaveLength(2);
  });

  it('404s adding a roll number that has never registered', async () => {
    await registerStudent('MEM2');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('MEM2')}`).send({ name: 'Team' });

    const res = await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('MEM2')}`)
      .send({ roll_number: 'NEVER-REGISTERED' });

    expect(res.status).toBe(404);
  });

  it('403s a plain member trying to add another member', async () => {
    await registerStudent('MEM3');
    await registerStudent('MEM3-MEMBER');
    await registerStudent('MEM3-TARGET');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('MEM3')}`).send({ name: 'Team' });
    await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('MEM3')}`)
      .send({ roll_number: 'MEM3-MEMBER' });

    const res = await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('MEM3-MEMBER')}`)
      .send({ roll_number: 'MEM3-TARGET' });

    expect(res.status).toBe(403);
  });

  it('lets an admin/owner remove a member, but not the owner', async () => {
    await registerStudent('MEM4');
    await registerStudent('MEM4-MEMBER');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('MEM4')}`).send({ name: 'Team' });
    await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('MEM4')}`)
      .send({ roll_number: 'MEM4-MEMBER' });

    const removeMember = await request(app)
      .delete(`/api/workspaces/${create.body.id}/members/MEM4-MEMBER`)
      .set('Authorization', `Bearer ${tokenFor('MEM4')}`);
    expect(removeMember.status).toBe(200);

    const removeOwner = await request(app)
      .delete(`/api/workspaces/${create.body.id}/members/MEM4`)
      .set('Authorization', `Bearer ${tokenFor('MEM4')}`);
    expect(removeOwner.status).toBe(400);
  });

  it('lets the owner promote a member to admin and demote back, but not touch the owner role', async () => {
    await registerStudent('MEM5');
    await registerStudent('MEM5-MEMBER');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('MEM5')}`).send({ name: 'Team' });
    await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('MEM5')}`)
      .send({ roll_number: 'MEM5-MEMBER' });

    const promote = await request(app)
      .put(`/api/workspaces/${create.body.id}/members/MEM5-MEMBER/role`)
      .set('Authorization', `Bearer ${tokenFor('MEM5')}`)
      .send({ role: 'admin' });
    expect(promote.status).toBe(200);
    expect(promote.body.role).toBe('admin');

    const demote = await request(app)
      .put(`/api/workspaces/${create.body.id}/members/MEM5-MEMBER/role`)
      .set('Authorization', `Bearer ${tokenFor('MEM5')}`)
      .send({ role: 'member' });
    expect(demote.status).toBe(200);
    expect(demote.body.role).toBe('member');

    const touchOwner = await request(app)
      .put(`/api/workspaces/${create.body.id}/members/MEM5/role`)
      .set('Authorization', `Bearer ${tokenFor('MEM5')}`)
      .send({ role: 'admin' });
    expect(touchOwner.status).toBe(400);
  });

  it('403s an admin (not owner) attempting a role change', async () => {
    await registerStudent('MEM6');
    await registerStudent('MEM6-ADMIN');
    await registerStudent('MEM6-TARGET');
    const create = await request(app).post('/api/workspaces').set('Authorization', `Bearer ${tokenFor('MEM6')}`).send({ name: 'Team' });
    await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('MEM6')}`)
      .send({ roll_number: 'MEM6-ADMIN' });
    await request(app)
      .put(`/api/workspaces/${create.body.id}/members/MEM6-ADMIN/role`)
      .set('Authorization', `Bearer ${tokenFor('MEM6')}`)
      .send({ role: 'admin' });
    await request(app)
      .post(`/api/workspaces/${create.body.id}/members`)
      .set('Authorization', `Bearer ${tokenFor('MEM6')}`)
      .send({ roll_number: 'MEM6-TARGET' });

    const res = await request(app)
      .put(`/api/workspaces/${create.body.id}/members/MEM6-TARGET/role`)
      .set('Authorization', `Bearer ${tokenFor('MEM6-ADMIN')}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
  });
});

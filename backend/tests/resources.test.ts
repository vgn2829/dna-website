import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';

const app = createApp();

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4)
     ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

async function seedDomain(id: string): Promise<void> {
  await query(
    `INSERT INTO domains(id,title,full_name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [id, id, id]
  );
}

function tokenFor(roll: string): string {
  return signStudentToken(roll);
}

async function adminToken(): Promise<string> {
  const res = await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD });
  return res.body.token;
}

const validSubmission = {
  title: 'Figma Auto-Layout Deep Dive',
  url: 'https://example.com/figma-tutorial',
  author: 'Meera Patel',
  type: 'video' as const,
  level: 'Intermediate' as const,
  durationLabel: '1h 10m',
  tags: ['Components', 'Variants'],
};

describe('Resources: public listing', () => {
  it('returns only approved resources, ordered by display_order then created_at', async () => {
    await seedDomain('uiux');
    const admin = await adminToken();

    await request(app).post('/api/resources/admin').set('Authorization', `Bearer ${admin}`)
      .send({ ...validSubmission, title: 'Admin Resource', domainId: 'uiux' });

    await registerStudent('23RES01');
    await request(app).post('/api/resources').set('Authorization', `Bearer ${tokenFor('23RES01')}`)
      .send({ ...validSubmission, title: 'Pending Submission', domainId: 'uiux' });

    const res = await request(app).get('/api/resources');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Admin Resource');
    expect(res.body[0].approved).toBe(true);
    expect(res.body[0].domainTitle).toBe('uiux');
  });

  it('returns an empty array when nothing is approved yet', async () => {
    const res = await request(app).get('/api/resources');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('Resources: student submission', () => {
  it('requires a valid student token', async () => {
    const res = await request(app).post('/api/resources').send(validSubmission);
    expect(res.status).toBe(401);
  });

  it('accepts a valid submission, stores it unapproved with the identity from the JWT', async () => {
    await registerStudent('23RES02');
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${tokenFor('23RES02')}`)
      .send(validSubmission);

    expect(res.status).toBe(201);
    expect(res.body.approved).toBe(false);
    expect(res.body.submittedByRoll).toBe('23RES02');
    expect(res.body.title).toBe(validSubmission.title);
    expect(res.body.tags).toEqual(['Components', 'Variants']);

    // Not visible on the public listing yet.
    const publicList = await request(app).get('/api/resources');
    expect(publicList.body).toEqual([]);
  });

  it('ignores a client-supplied submittedByRoll and always uses the token roll', async () => {
    await registerStudent('23RES03');
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${tokenFor('23RES03')}`)
      .send({ ...validSubmission, submittedByRoll: 'SPOOFED' });

    expect(res.status).toBe(201);
    expect(res.body.submittedByRoll).toBe('23RES03');
  });

  it('rejects a non-https url', async () => {
    await registerStudent('23RES04');
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${tokenFor('23RES04')}`)
      .send({ ...validSubmission, url: 'http://example.com/insecure' });
    expect(res.status).toBe(400);
  });

  it('rejects a javascript: url', async () => {
    await registerStudent('23RES05');
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${tokenFor('23RES05')}`)
      .send({ ...validSubmission, url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
  });

  it('rejects a submission referencing a nonexistent domain', async () => {
    await registerStudent('23RES06');
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${tokenFor('23RES06')}`)
      .send({ ...validSubmission, domainId: 'does-not-exist' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid type/level enum value', async () => {
    await registerStudent('23RES07');
    const res = await request(app)
      .post('/api/resources')
      .set('Authorization', `Bearer ${tokenFor('23RES07')}`)
      .send({ ...validSubmission, type: 'podcast' });
    expect(res.status).toBe(400);
  });

});

describe('Resources: admin moderation', () => {
  it('lists only unapproved resources in the pending queue', async () => {
    // Insert the pending row directly rather than via POST /api/resources —
    // see the "approves a pending submission" test below for why (shared
    // rate-limiter across this file's tests). Admin-authored creation below
    // still goes through the real POST /api/resources/admin endpoint, which
    // isn't rate-limited.
    await registerStudent('23RES09');
    await query(
      `INSERT INTO resources(id,title,url,author,type,level,duration_label,tags,submitted_by_roll,approved)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false)`,
      ['res-test-pending-09', validSubmission.title, validSubmission.url, validSubmission.author,
       validSubmission.type, validSubmission.level, validSubmission.durationLabel,
       JSON.stringify(validSubmission.tags), '23RES09']
    );

    const admin = await adminToken();
    await request(app).post('/api/resources/admin').set('Authorization', `Bearer ${admin}`)
      .send({ ...validSubmission, title: 'Already Approved' });

    const pending = await request(app).get('/api/resources/pending').set('Authorization', `Bearer ${admin}`);
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].approved).toBe(false);
  });

  it('requires admin auth for the pending queue', async () => {
    const res = await request(app).get('/api/resources/pending');
    expect(res.status).toBe(401);
  });

  it('approves a pending submission via PUT, making it visible on the public listing', async () => {
    // Insert directly rather than going through POST /api/resources: the
    // submitLimiter middleware is a module-level singleton shared by every
    // createApp() call in this process (same pattern as every other rate
    // limiter in this codebase — e.g. artworks.ts's commentLimiter), so by
    // this point in the file it may already be near its 10-req/min cap from
    // earlier tests that intentionally submit invalid payloads (which still
    // count against the limiter). The submission *endpoint's* behavior is
    // already covered by the "student submission" tests above; this test is
    // about the approve→visible transition, so it only needs a pending row
    // to exist, not another live POST through the rate-limited endpoint.
    await registerStudent('23RES10');
    const id = 'res-test-pending-10';
    await query(
      `INSERT INTO resources(id,title,url,author,type,level,duration_label,tags,submitted_by_roll,approved)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false)`,
      [id, validSubmission.title, validSubmission.url, validSubmission.author,
       validSubmission.type, validSubmission.level, validSubmission.durationLabel,
       JSON.stringify(validSubmission.tags), '23RES10']
    );

    const admin = await adminToken();
    const approveRes = await request(app)
      .put(`/api/resources/${id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ approved: true });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.approved).toBe(true);

    const publicList = await request(app).get('/api/resources');
    expect(publicList.body).toHaveLength(1);
    expect(publicList.body[0].id).toBe(id);
  });

  it('admin can edit fields of an existing resource', async () => {
    const admin = await adminToken();
    const createRes = await request(app).post('/api/resources/admin').set('Authorization', `Bearer ${admin}`).send(validSubmission);
    const id = createRes.body.id;

    const editRes = await request(app)
      .put(`/api/resources/${id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ title: 'Updated Title', level: 'Advanced' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.title).toBe('Updated Title');
    expect(editRes.body.level).toBe('Advanced');
    expect(editRes.body.url).toBe(validSubmission.url); // unspecified fields unchanged
  });

  it('returns 404 editing a nonexistent resource', async () => {
    const admin = await adminToken();
    const res = await request(app)
      .put('/api/resources/res-doesnotexist')
      .set('Authorization', `Bearer ${admin}`)
      .send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('reorders via PATCH /:id/order', async () => {
    const admin = await adminToken();
    const createRes = await request(app).post('/api/resources/admin').set('Authorization', `Bearer ${admin}`).send(validSubmission);
    const id = createRes.body.id;

    const patchRes = await request(app)
      .patch(`/api/resources/${id}/order`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ displayOrder: 42 });
    expect(patchRes.status).toBe(200);

    const rows = await query<{ display_order: number }>('SELECT display_order FROM resources WHERE id=$1', [id]);
    expect(rows[0].display_order).toBe(42);
  });

  it('deletes a resource', async () => {
    const admin = await adminToken();
    const createRes = await request(app).post('/api/resources/admin').set('Authorization', `Bearer ${admin}`).send(validSubmission);
    const id = createRes.body.id;

    const delRes = await request(app).delete(`/api/resources/${id}`).set('Authorization', `Bearer ${admin}`);
    expect(delRes.status).toBe(204);

    const rows = await query('SELECT 1 FROM resources WHERE id=$1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('returns 404 deleting a nonexistent resource', async () => {
    const admin = await adminToken();
    const res = await request(app).delete('/api/resources/res-doesnotexist').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(404);
  });

  it('rejects admin-authored resource creation without admin auth', async () => {
    const res = await request(app).post('/api/resources/admin').send(validSubmission);
    expect(res.status).toBe(401);
  });
});

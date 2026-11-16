import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { localRequest } from './localServer';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { resetDirectoryCapabilityCache } from '../src/lib/creatorDirectory';

// DNA 2.0 V1.1 — profile tools, discovery filters, and featured-creator order/notes.
// Runs against the real schema built by tests/setup.ts; no tables are created here.

const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
let adminToken = '';
const adm = () => ({ Authorization: `Bearer ${adminToken}` });

const NAMES: Record<string, string> = { ASHA: 'Asha Rao', BALA: 'Bala Iyer', CHITRA: 'Chitra Nair' };
async function profile(roll: string, handle: string, o: Partial<{ visibility: string; moderation: string; tools: string[]; skills: string[]; department: string | null }> = {}): Promise<string> {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1,$2,'01 Jan 2026',$3,$4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, NAMES[roll] ?? 'Some Student', `${roll.toLowerCase()}@iitk.ac.in`]);
  const id = uuidv4();
  await query(`INSERT INTO designer_profiles (id, owner_roll, handle, display_name, skills, tools, department, visibility, moderation_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, roll, handle, NAMES[roll] ?? 'Some Student', o.skills ?? [], o.tools ?? [], o.department ?? null, o.visibility ?? 'public', o.moderation ?? 'active']);
  return id;
}

beforeAll(async () => {
  adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
});
beforeEach(async () => {
  await query('TRUNCATE "student_sessions", "creator_features", "creator_audit_log" CASCADE');
  resetDirectoryCapabilityCache();
});
afterAll(() => { resetDirectoryCapabilityCache(); });

describe('profile tools', () => {
  it('requires a verified student session', async () => {
    await profile('ASHA', 'asha-draws');
    expect((await request(app).put('/api/designers/me/tools').send({ tools: ['figma'] })).status).toBe(401);
    expect((await request(app).put('/api/designers/me/tools').set({ Authorization: 'Bearer nonsense' }).send({ tools: ['figma'] })).status).toBe(401);
  });

  it('saves normalised, de-duplicated tools and returns them on the owner profile', async () => {
    await profile('ASHA', 'asha-draws');
    const put = await request(app).put('/api/designers/me/tools').set(auth('ASHA')).send({ tools: ['Figma', ' figma ', 'Blender  3D', 'After Effects'] });
    expect(put.status).toBe(200);
    expect(put.body.tools).toEqual(['figma', 'blender 3d', 'after effects']);
    const me = await request(app).get('/api/designers/me').set(auth('ASHA'));
    expect(me.body.tools).toEqual(['figma', 'blender 3d', 'after effects']);
  });

  it('rejects bad input: too many, malformed, extra keys', async () => {
    await profile('ASHA', 'asha-draws');
    const put = (body: unknown) => request(app).put('/api/designers/me/tools').set(auth('ASHA')).send(body as object);
    expect((await put({ tools: Array.from({ length: 13 }, (_, i) => `tool${i}x`) })).status).toBe(400);
    expect((await put({ tools: ['<script>'] })).status).toBe(400);
    expect((await put({ tools: ['x'] })).status).toBe(400);
    expect((await put({ tools: ['figma'], visibility: 'public' })).status).toBe(400);   // no mass assignment
    expect((await put({ tools: 'figma' })).status).toBe(400);
  });

  it('only ever writes the caller’s own profile', async () => {
    await profile('ASHA', 'asha-draws', { tools: ['figma'] });
    await profile('BALA', 'bala-makes', { tools: ['blender'] });
    await request(app).put('/api/designers/me/tools').set(auth('ASHA')).send({ tools: ['procreate'] });
    const bala = await query<{ tools: string[] }>(`SELECT tools FROM designer_profiles WHERE handle = 'bala-makes'`);
    expect(bala[0].tools).toEqual(['blender']);
  });

  it('404s when the caller has no profile yet', async () => {
    await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ('CHITRA','IITK-DnA-CHITRA-AAAA','01 Jan 2026','Chitra Nair','c@iitk.ac.in')`);
    expect((await request(app).put('/api/designers/me/tools').set(auth('CHITRA')).send({ tools: ['figma'] })).status).toBe(404);
  });

  it('shows tools on a PUBLIC profile but a private profile stays a 404', async () => {
    await profile('ASHA', 'asha-draws', { tools: ['figma'] });
    await profile('BALA', 'bala-makes', { tools: ['blender'], visibility: 'private' });
    expect((await request(app).get('/api/designers/asha-draws')).body.tools).toEqual(['figma']);
    expect((await request(app).get('/api/designers/bala-makes')).status).toBe(404);
  });
});

describe('creator discovery: tools, department, featured-only', () => {
  it('searches and filters by tool, case-insensitively, within public profiles only', async () => {
    await profile('ASHA', 'asha-draws', { tools: ['figma', 'blender'] });
    await profile('BALA', 'bala-makes', { tools: ['figma'], visibility: 'private' });
    await profile('CHITRA', 'chitra-moves', { tools: ['after effects'] });
    const byFilter = await request(app).get('/api/creators?tool=Figma');
    expect(byFilter.body.creators.map((c: { handle: string }) => c.handle)).toEqual(['asha-draws']);
    const bySearch = await request(app).get('/api/creators?q=after%20eff');
    expect(bySearch.body.creators.map((c: { handle: string }) => c.handle)).toEqual(['chitra-moves']);
    // a private profile is never discoverable through a tool search
    expect((await request(app).get('/api/creators?q=figma')).body.creators.map((c: { handle: string }) => c.handle)).toEqual(['asha-draws']);
  });

  it('filters by department (exact, case-insensitive) and by featured only', async () => {
    const a = await profile('ASHA', 'asha-draws', { department: 'Design' });
    await profile('BALA', 'bala-makes', { department: 'Mechanical Engineering' });
    await request(app).put(`/api/creators/admin/${a}/featured`).set(adm()).send({ featured: true });
    expect((await request(app).get('/api/creators?department=design')).body.creators.map((c: { handle: string }) => c.handle)).toEqual(['asha-draws']);
    expect((await request(app).get('/api/creators?featured=1')).body.creators.map((c: { handle: string }) => c.handle)).toEqual(['asha-draws']);
  });

  it('treats filter values as data, not SQL', async () => {
    await profile('ASHA', 'asha-draws', { tools: ['figma'], department: 'Design' });
    for (const qs of ["tool=' OR 1=1 --", "department=' OR 1=1 --", 'tool=%25']) {
      const r = await request(app).get(`/api/creators?${qs}`);
      expect(r.status, qs).toBe(200);
      expect(r.body.creators, qs).toHaveLength(0);
    }
  });

  it('facets list tools and departments for public profiles only', async () => {
    await profile('ASHA', 'asha-draws', { tools: ['figma'], department: 'Design' });
    await profile('BALA', 'bala-makes', { tools: ['secret-tool'], department: 'Hidden Dept', visibility: 'private' });
    const f = (await request(app).get('/api/creators/facets')).body;
    expect(f.tools).toEqual([{ tool: 'figma', count: 1 }]);
    expect(f.departments).toEqual([{ department: 'Design', count: 1 }]);
  });
});

describe('featured creators: order and editorial note', () => {
  const feature = (id: string) => request(app).put(`/api/creators/admin/${id}/featured`).set(adm()).send({ featured: true });
  const edit = (id: string, body: object, headers: Record<string, string> = adm()) => request(app).patch(`/api/creators/admin/${id}/featured`).set(headers).send(body);

  it('is admin-only: anonymous, students (even the owner) and junk tokens are rejected', async () => {
    const id = await profile('ASHA', 'asha-draws');
    await feature(id);
    for (const h of [{}, auth('ASHA'), auth('BALA'), { Authorization: 'Bearer nonsense' }]) {
      expect((await edit(id, { editorialNote: 'self-promo' }, h)).status, JSON.stringify(h)).toBe(401);
    }
    const row = await query<{ editorial_note: string | null }>('SELECT editorial_note FROM creator_features');
    expect(row[0].editorial_note).toBeNull();
  });

  it('sets an order and note, shown publicly only while the creator is featured, public and active', async () => {
    const a = await profile('ASHA', 'asha-draws');
    const b = await profile('BALA', 'bala-makes');
    await feature(a); await feature(b);
    expect((await edit(b, { displayOrder: 1, editorialNote: 'Posters that stop the scroll' })).status).toBe(200);
    expect((await edit(a, { displayOrder: 2 })).status).toBe(200);
    const featured = (await request(app).get('/api/creators/featured')).body.creators;
    expect(featured.map((c: { handle: string }) => c.handle)).toEqual(['bala-makes', 'asha-draws']);
    expect(featured[0].editorialNote).toBe('Posters that stop the scroll');
    expect(featured[1].editorialNote).toBeNull();
    // the directory's default sort honours the same order
    expect((await request(app).get('/api/creators')).body.creators.map((c: { handle: string }) => c.handle)).toEqual(['bala-makes', 'asha-draws']);
    // going private hides the creator AND the note, even though the feature row remains
    await query(`UPDATE designer_profiles SET visibility='private' WHERE handle='bala-makes'`);
    resetDirectoryCapabilityCache();
    const after = JSON.stringify((await request(app).get('/api/creators/featured')).body);
    expect(after).not.toContain('Posters that stop');
    expect(after).not.toContain('bala-makes');
  });

  it('unordered features sort after ordered ones, and clearing the order is possible', async () => {
    const a = await profile('ASHA', 'asha-draws'); const b = await profile('BALA', 'bala-makes');
    await feature(a); await feature(b);
    await edit(b, { displayOrder: 5 });
    expect((await request(app).get('/api/creators/featured')).body.creators[0].handle).toBe('bala-makes');
    await edit(b, { displayOrder: null });
    const row = await query<{ display_order: number | null }>(`SELECT display_order FROM creator_features WHERE profile_id = $1`, [b]);
    expect(row[0].display_order).toBeNull();
  });

  it('validates input strictly and never edits a creator who is not featured', async () => {
    const a = await profile('ASHA', 'asha-draws');
    expect((await edit(a, { displayOrder: 1 })).status).toBe(404);            // not featured
    await feature(a);
    for (const body of [{}, { displayOrder: -1 }, { displayOrder: 1000 }, { displayOrder: 1.5 }, { displayOrder: '3' }, { editorialNote: 'x'.repeat(201) }, { profile_id: 'other' }, { featured_at: '2020-01-01' }]) {
      expect((await edit(a, body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await edit(a, { editorialNote: 'x'.repeat(200) })).status).toBe(200);
  });

  it('stores an empty note as none, strips markup-significant whitespace only, and audits the edit', async () => {
    const a = await profile('ASHA', 'asha-draws');
    await feature(a);
    await edit(a, { editorialNote: '  Great work  ' });
    expect((await request(app).get('/api/creators/featured')).body.creators[0].editorialNote).toBe('Great work');
    await edit(a, { editorialNote: '   ' });
    expect((await request(app).get('/api/creators/featured')).body.creators[0].editorialNote).toBeNull();
    const audit = await query<{ action: string }>(`SELECT action FROM creator_audit_log WHERE action = 'profile.feature_edit'`);
    expect(audit.length).toBe(2);
  });

  it('unfeaturing removes the note with the feature row (no orphaned editorial text)', async () => {
    const a = await profile('ASHA', 'asha-draws');
    await feature(a); await edit(a, { editorialNote: 'Hello' });
    await request(app).put(`/api/creators/admin/${a}/featured`).set(adm()).send({ featured: false });
    expect(await query('SELECT 1 FROM creator_features')).toHaveLength(0);
    expect(JSON.stringify((await request(app).get('/api/creators')).body)).not.toContain('Hello');
  });

  it('the admin list exposes order and note to admins only', async () => {
    const a = await profile('ASHA', 'asha-draws');
    await feature(a); await edit(a, { displayOrder: 3, editorialNote: 'Note' });
    const list = await request(app).get('/api/creators/admin/list').set(adm());
    expect(list.body.creators[0]).toMatchObject({ featured: true, displayOrder: 3, editorialNote: 'Note' });
    expect((await request(app).get('/api/creators/admin/list').set(auth('ASHA'))).status).toBe(401);
  });
});

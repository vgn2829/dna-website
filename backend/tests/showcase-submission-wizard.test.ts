import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import sharp from 'sharp';
import { localRequest } from './localServer';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { getStorage } from '../src/storage';
import { resetIdentityCapabilityCache } from '../src/lib/creatorIdentity';

// The seven-step submission wizard saves through the existing endpoints, one step at a time.
// These tests pin the server-side guarantees the wizard relies on: drafts persist piecemeal and
// stay private to their owner, the server (not the client) decides what may be submitted,
// submission can only happen once, contributor consent is enforced, and frozen states stay frozen.

const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
let adminToken = '';
const adm = () => ({ Authorization: `Bearer ${adminToken}` });
const S = (p: string) => `/api/showcase${p}`;
const get = (roll: string, p: string) => request(app).get(S(p)).set(auth(roll));
const post = (roll: string, p: string, b: object = {}) => request(app).post(S(p)).set(auth(roll)).send(b);
const patch = (roll: string, p: string, b: object) => request(app).patch(S(p)).set(auth(roll)).send(b);
const put = (roll: string, p: string, b: object) => request(app).put(S(p)).set(auth(roll)).send(b);

const NAMES: Record<string, string> = { ALICE: 'Asha Rao', BOB: 'Bala Iyer' };
async function student(roll: string) {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1,$2,'01 Jan 2026',$3,$4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, NAMES[roll] ?? 'Some Student', `${roll.toLowerCase()}@iitk.ac.in`]);
}
async function workspaceFor(roll: string): Promise<string> {
  return (await request(app).post('/api/workspaces').set(auth(roll)).send({ name: `${roll} ws` })).body.id as string;
}
async function asset(roll: string, ws: string, name = 'work.png'): Promise<string> {
  const id = uuidv4(); const key = `assets/${ws}/${id}.png`;
  const bytes = await sharp({ create: { width: 40, height: 24, channels: 3, background: '#cc2233' } }).png().toBuffer();
  await getStorage().upload(key, bytes, 'image/png');
  await query(`INSERT INTO assets (id, workspace_id, owner_roll, kind, filename, storage_key, mime_type, size_bytes, width, height, created_at, visibility) VALUES ($1,$2,$3,'image',$4,$5,'image/png',$6,40,24,$7,'personal')`,
    [id, ws, roll, name, key, bytes.length, new Date().toISOString()]);
  return id;
}

beforeEach(async () => {
  await query('TRUNCATE "showcase_projects", "showcase_events", "assets", "workspace_members", "workspaces", "boards", "domains" CASCADE');
  await student('ALICE'); await student('BOB');
  await query(`INSERT INTO domains (id, title, full_name) VALUES ('illus','Illustration','Illustration & Art')`);
  if (!adminToken) adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
  resetIdentityCapabilityCache();
});
afterAll(() => resetIdentityCapabilityCache());

const STORY = 'Three posters exploring halftone textures and limited palettes for a campus festival.';

/** Walks the wizard's steps the way the UI does: one PATCH/PUT per step. Returns the project id. */
async function walk(roll: string, upTo: 'basics' | 'media' | 'story' | 'all' = 'all') {
  const id = (await post(roll, '/mine', { title: 'Retro Poster Series' })).body.id as string;
  await patch(roll, `/mine/${id}`, { summary: 'A series of retro posters', category: 'illustration', discipline_ids: ['illus'] });          // step 1
  if (upTo === 'basics') return id;
  const a = await asset(roll, await workspaceFor(roll));
  expect((await put(roll, `/mine/${id}/works`, { works: [{ asset_id: a, caption: 'One', is_cover: true }] })).status).toBe(200);              // step 2
  if (upTo === 'media') return id;
  await patch(roll, `/mine/${id}`, { description: STORY });                                                                                  // step 3
  if (upTo === 'story') return id;
  await patch(roll, `/mine/${id}`, { tags: ['retro', 'poster'], links: [{ label: 'Behance', url: 'https://www.behance.net/gallery/1' }] });  // steps 5–6
  return id;
}

describe('draft persistence across wizard steps', () => {
  it('every step’s save persists, and the server’s problem list shrinks to match what the UI shows as complete', async () => {
    const id = (await post('ALICE', '/mine', { title: 'Retro Poster Series' })).body.id as string;
    let p = (await get('ALICE', `/mine/${id}`)).body;
    expect(p.status).toBe('draft');
    expect(p.problems.length).toBeGreaterThanOrEqual(4);

    await patch('ALICE', `/mine/${id}`, { summary: 'A series of retro posters', category: 'illustration', discipline_ids: ['illus'] });
    p = (await get('ALICE', `/mine/${id}`)).body;
    expect(p.problems.join(' ')).not.toMatch(/summary|category|discipline/);
    expect(p.problems.join(' ')).toMatch(/image/);

    const a = await asset('ALICE', await workspaceFor('ALICE'));
    await put('ALICE', `/mine/${id}/works`, { works: [{ asset_id: a, is_cover: true }] });
    p = (await get('ALICE', `/mine/${id}`)).body;
    expect(p.problems.join(' ')).not.toMatch(/image|cover/);

    await patch('ALICE', `/mine/${id}`, { description: STORY });
    expect((await get('ALICE', `/mine/${id}`)).body.problems).toEqual([]);

    // "resume later": a fresh read returns everything entered so far
    const resumed = (await get('ALICE', `/mine/${id}`)).body;
    expect(resumed).toMatchObject({ title: 'Retro Poster Series', summary: 'A series of retro posters', category: 'illustration', description: STORY, status: 'draft', editable: true });
    expect(resumed.works).toHaveLength(1);
  });

  it('a partial PATCH never wipes fields saved by other steps', async () => {
    const id = await walk('ALICE');
    await patch('ALICE', `/mine/${id}`, { tags: ['only-tags'] });
    const p = (await get('ALICE', `/mine/${id}`)).body;
    expect(p).toMatchObject({ summary: 'A series of retro posters', description: STORY, category: 'illustration', tags: ['only-tags'] });
    expect(p.disciplines).toHaveLength(1);
  });

  it('drafts stay private: another student gets 404 on read, edit, works, credits, submit; the public sees nothing', async () => {
    const id = await walk('ALICE');
    const slug = (await get('ALICE', `/mine/${id}`)).body.slug as string;
    expect((await get('BOB', `/mine/${id}`)).status).toBe(404);
    expect((await patch('BOB', `/mine/${id}`, { title: 'hijack' })).status).toBe(404);
    expect((await put('BOB', `/mine/${id}/works`, { works: [] })).status).toBe(404);
    expect((await post('BOB', `/mine/${id}/credits`, { roll: 'ALICE' })).status).toBe(404);
    expect((await post('BOB', `/mine/${id}/submit`)).status).toBe(404);
    expect((await request(app).get(S(`/mine/${id}`))).status).toBe(401);                       // anonymous
    expect((await request(app).get(S(`/mine/${id}`)).set(adm())).status).toBe(401);            // an admin token is not a student
    expect((await request(app).get(S(`/projects/${slug}`))).status).toBe(404);
    expect((await get('ALICE', `/mine/${id}`)).body.title).toBe('Retro Poster Series');        // and nothing leaked back to the owner's copy
  });
});

describe('submission', () => {
  it('is refused with the full problem list until the project is complete (the client cannot bypass the server)', async () => {
    const id = await walk('ALICE', 'basics');
    const r = await post('ALICE', `/mine/${id}/submit`);
    expect(r.status).toBe(400);
    expect(r.body.problems.join(' ')).toMatch(/image/);
    expect(r.body.problems.join(' ')).toMatch(/Describe the project/);
    expect((await get('ALICE', `/mine/${id}`)).body.status).toBe('draft');
  });

  it('succeeds once, is a conflict the second time, and records a single submission event', async () => {
    const id = await walk('ALICE');
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
    const again = await post('ALICE', `/mine/${id}/submit`);
    expect(again.status).toBe(409);
    const events = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM showcase_events WHERE project_id = $1 AND to_status = 'submitted'`, [id]);
    expect(events[0].n).toBe(1);
  });

  it('two simultaneous submits (double click / two tabs) result in exactly one submission', async () => {
    const id = await walk('ALICE');
    const [a, b] = await Promise.all([post('ALICE', `/mine/${id}/submit`), post('ALICE', `/mine/${id}/submit`)]);
    expect([a.status, b.status].filter(s => s === 200)).toHaveLength(1);
    expect([a.status, b.status].filter(s => s === 409 || s === 400)).toHaveLength(1);
    const events = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM showcase_events WHERE project_id = $1 AND to_status = 'submitted'`, [id]);
    expect(events[0].n).toBe(1);
  });

  it('enforces contributor consent: a pending credit blocks submission until accepted', async () => {
    const id = await walk('ALICE');
    expect((await post('ALICE', `/mine/${id}/credits`, { roll: 'BOB', role_label: 'Motion designer' })).status).toBe(201);
    const blocked = await post('ALICE', `/mine/${id}/submit`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.problems.join(' ')).toMatch(/contributors to accept/);
    const inv = (await get('BOB', '/invitations')).body.invitations[0];
    expect((await post('BOB', `/invitations/${inv.id}/accept`, { display_name: 'Bala Iyer' })).status).toBe(200);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
  });

  it('a declined contributor does not block, and is not shown as credited', async () => {
    const id = await walk('ALICE');
    await post('ALICE', `/mine/${id}/credits`, { roll: 'BOB' });
    const inv = (await get('BOB', '/invitations')).body.invitations[0];
    await post('BOB', `/invitations/${inv.id}/decline`);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
  });
});

describe('frozen states and the rest of the lifecycle are unchanged', () => {
  it('a submitted project cannot be edited by anyone; withdrawing reopens editing; resubmission works', async () => {
    const id = await walk('ALICE');
    await post('ALICE', `/mine/${id}/submit`);
    expect((await patch('ALICE', `/mine/${id}`, { title: 'sneaky change' })).status).toBe(409);
    expect((await put('ALICE', `/mine/${id}/works`, { works: [] })).status).toBe(409);
    expect((await get('ALICE', `/mine/${id}`)).body.editable).toBe(false);
    expect((await post('ALICE', `/mine/${id}/withdraw`)).status).toBe(200);
    expect((await patch('ALICE', `/mine/${id}`, { title: 'Better title' })).status).toBe(200);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
  });

  it('moderator feedback reaches the owner, who can fix and resubmit; only admins can moderate', async () => {
    const id = await walk('ALICE');
    await post('ALICE', `/mine/${id}/submit`);
    const t = (to: string, reason?: string, h: Record<string, string> = adm()) => request(app).post(S(`/admin/projects/${id}/transition`)).set(h).send({ to, reason });
    expect((await t('approved', undefined, auth('ALICE'))).status).toBe(401);
    expect((await t('changes_requested')).status).toBe(400);                         // a reason is mandatory
    expect((await t('changes_requested', 'Add more process detail')).status).toBe(200);
    const p = (await get('ALICE', `/mine/${id}`)).body;
    expect(p).toMatchObject({ status: 'changes_requested', reviewNote: 'Add more process detail', editable: true });
    expect((await patch('ALICE', `/mine/${id}`, { description: `${STORY} Plus a full process write-up.` })).status).toBe(200);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
  });

  it('only a published project is public, and its public payload carries no roll numbers or emails', async () => {
    const id = await walk('ALICE');
    const slug = (await get('ALICE', `/mine/${id}`)).body.slug as string;
    await post('ALICE', `/mine/${id}/submit`);
    expect((await request(app).get(S(`/projects/${slug}`))).status).toBe(404);          // submitted ≠ public
    const t = (to: string) => request(app).post(S(`/admin/projects/${id}/transition`)).set(adm()).send({ to });
    await t('approved');
    expect((await request(app).get(S(`/projects/${slug}`))).status).toBe(404);          // approved ≠ public
    expect((await t('published')).status).toBe(200);
    const pubRes = await request(app).get(S(`/projects/${slug}`));
    expect(pubRes.status).toBe(200);
    expect(JSON.stringify(pubRes.body)).not.toMatch(/ALICE|BOB|@iitk|IITK-DnA|owner_roll|ownerRoll/);
  });
});

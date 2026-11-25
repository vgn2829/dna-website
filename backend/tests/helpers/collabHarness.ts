import { expect, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { localRequest } from '../localServer';
import { createApp } from '../../src/app';
import { query } from '../../src/db/client';
import { signBypassStudentToken, signStudentToken } from '../../src/middleware/studentAuth';
import { getStorage } from '../../src/storage';
import { resetIdentityCapabilityCache } from '../../src/lib/creatorIdentity';
import { COLLAB_LIMITS } from '../../src/routes/showcaseCollab';
import jwt from 'jsonwebtoken';

// DNA 2.0 V1 — project collaboration. Real routes + real Postgres; no mocked
// authorization. Roles: ALICE owns, BOB is an editor, CAROL a viewer, DAVE is a
// stranger. These tests are the evidence for the permission, consent and
// privacy rules in docs/dna-2.0/COLLABORATION.md.

// Shared harness for the collaboration suites. Each test FILE creates its own app (via this module's import),
// so each gets its own global per-IP rate-limit store — one file issuing >300 requests/min from loopback would
// otherwise trip the app-wide 300/min limiter, which is production behaviour and not under test here.
export const app = createApp();
export const request = localRequest(app);
export const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
export const legacyAuth = (roll: string) => ({ Authorization: `Bearer ${jwt.sign({ typ: 'student', roll }, process.env.JWT_SECRET!, { expiresIn: '1h' })}` });
let adminToken = '';
export const adm = () => ({ Authorization: `Bearer ${adminToken}` });
export const S = (p: string) => `/api/showcase${p}`;
export const C = (p: string) => `/api/showcase/collab${p}`;
export const get = (roll: string, p: string) => request(app).get(S(p)).set(auth(roll));
export const post = (roll: string, p: string, b: object = {}) => request(app).post(S(p)).set(auth(roll)).send(b);
export const patch = (roll: string, p: string, b: object) => request(app).patch(S(p)).set(auth(roll)).send(b);
export const put = (roll: string, p: string, b: object) => request(app).put(S(p)).set(auth(roll)).send(b);
export const cget = (roll: string, p: string) => request(app).get(C(p)).set(auth(roll));
export const cpost = (roll: string, p: string, b: object = {}) => request(app).post(C(p)).set(auth(roll)).send(b);
export const cpatch = (roll: string, p: string, b: object) => request(app).patch(C(p)).set(auth(roll)).send(b);
export const cdel = (roll: string, p: string) => request(app).delete(C(p)).set(auth(roll));
export const pub = (p: string) => request(app).get(S(p));
export const aTransition = (id: string, to: string, reason?: string) => request(app).post(S(`/admin/projects/${id}/transition`)).set(adm()).send({ to, reason });

export const NAMES: Record<string, string> = { ALICE: 'Asha Rao', BOB: 'Bala Iyer', CAROL: 'Chitra Nair', DAVE: 'Dev Menon', ERIN: 'Ela Joshi' };
export async function student(roll: string) {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1,$2,'01 Jan 2026',$3,$4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, NAMES[roll] ?? 'Some Student', `${roll.toLowerCase()}@iitk.ac.in`]);
}
export async function workspaceFor(roll: string) {
  return (await request(app).post('/api/workspaces').set(auth(roll)).send({ name: `${roll} ws` })).body.id as string;
}
export async function asset(roll: string, ws: string, name = 'work.png') {
  const id = uuidv4();
  const key = `assets/${ws}/${id}.png`;
  const bytes = await sharp({ create: { width: 40, height: 24, channels: 3, background: '#cc2233' } }).png().toBuffer();
  await getStorage().upload(key, bytes, 'image/png');
  await query(`INSERT INTO assets (id, workspace_id, owner_roll, kind, filename, storage_key, mime_type, size_bytes, width, height, created_at, visibility) VALUES ($1,$2,$3,'image',$4,$5,'image/png',$6,40,24,$7,'personal')`,
    [id, ws, roll, name, key, bytes.length, new Date().toISOString()]);
  return { id, key };
}
export async function publicProfile(roll: string, handle: string, visibility = 'public') {
  await query(`INSERT INTO designer_profiles (id, owner_roll, handle, display_name, visibility) VALUES ($1,$2,$3,$4,$5)`, [uuidv4(), roll, handle, NAMES[roll] ?? roll, visibility]);
}

// ALICE's draft project, fully submittable, with one image of her own.
export async function ownerProject(title = 'Festival Identity') {
  const ws = await workspaceFor('ALICE');
  const created = await post('ALICE', '/mine', { title });
  const id = created.body.id as string;
  await patch('ALICE', `/mine/${id}`, { summary: 'A festival identity system', description: 'Posters, wayfinding and merch for the campus festival, designed as one system.', category: 'branding', discipline_ids: ['illus'] });
  const a = await asset('ALICE', ws, 'owner.png');
  expect((await put('ALICE', `/mine/${id}/works`, { works: [{ asset_id: a.id, caption: 'Hero', is_cover: true }] })).status).toBe(200);
  return { id, ws, ownerAsset: a, slug: created.body.slug as string };
}
export const invite = (owner: string, id: string, body: object) => cpost(owner, `/projects/${id}/collaborators`, body);
export const collabs = async (id: string) => (await query<{ roll: string; access_role: string; status: string }>('SELECT roll, access_role, status FROM showcase_collaborators WHERE project_id = $1 ORDER BY roll', [id]));
export async function team(id: string) {
  // BOB editor, CAROL viewer — both accepted.
  const b = await invite('ALICE', id, { roll: 'BOB', access_role: 'editor' });
  const c = await invite('ALICE', id, { roll: 'CAROL', access_role: 'viewer' });
  expect(b.status, JSON.stringify(b.body)).toBe(201); expect(c.status, JSON.stringify(c.body)).toBe(201);
  const inv = async (roll: string) => (await cget(roll, '/invitations')).body.invitations[0].id as string;
  expect((await cpost('BOB', `/invitations/${await inv('BOB')}/accept`)).status).toBe(200);
  expect((await cpost('CAROL', `/invitations/${await inv('CAROL')}/accept`)).status).toBe(200);
}


/** Registers the shared per-test reset. Call once at the top level of each collaboration test file. */
export function registerCollabHooks() {
  beforeEach(async () => {
    await query('TRUNCATE "showcase_projects", "showcase_events", "showcase_collab_blocks", "assets", "workspace_members", "workspaces", "boards", "domains" CASCADE');
    for (const r of Object.keys(NAMES)) await student(r);
    await query(`INSERT INTO domains (id, title, full_name) VALUES ('illus','Illustration','Illustration & Art')`);
    if (!adminToken) adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
    resetIdentityCapabilityCache();
  });
  afterEach(() => { delete process.env.SHOWCASE_TEST_LIMITS; });
}

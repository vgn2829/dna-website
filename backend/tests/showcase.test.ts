import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import sharp from 'sharp';
import { localRequest } from './localServer';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { getStorage } from '../src/storage';
import { canTransition, submissionProblems, type ShowcaseStatus } from '../src/lib/showcaseState';
import { normalizeLinks, slugify, validatePublicUrl } from '../src/lib/showcaseValidation';
import { resetIdentityCapabilityCache } from '../src/lib/creatorIdentity';

const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
let adminToken = '';
const adm = () => ({ Authorization: `Bearer ${adminToken}` });
const S = (path: string) => `/api/showcase${path}`;
const get = (roll: string, p: string) => request(app).get(S(p)).set(auth(roll));
const post = (roll: string, p: string, b: object = {}) => request(app).post(S(p)).set(auth(roll)).send(b);
const patch = (roll: string, p: string, b: object) => request(app).patch(S(p)).set(auth(roll)).send(b);
const put = (roll: string, p: string, b: object) => request(app).put(S(p)).set(auth(roll)).send(b);
const del = (roll: string, p: string) => request(app).delete(S(p)).set(auth(roll));
const pub = (p: string) => request(app).get(S(p));
const aTransition = (id: string, to: string, reason?: string) => request(app).post(S(`/admin/projects/${id}/transition`)).set(adm()).send({ to, reason });

const NAMES: Record<string, string> = { ALICE: 'Asha Rao', BOB: 'Bala Iyer', CAROL: 'Chitra Nair' };
async function student(roll: string) {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1,$2,'01 Jan 2026',$3,$4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, NAMES[roll] ?? 'Some Student', `${roll.toLowerCase()}@iitk.ac.in`]);
}
async function workspaceFor(roll: string): Promise<string> {
  return (await request(app).post('/api/workspaces').set(auth(roll)).send({ name: `${roll} ws` })).body.id as string;
}
async function realImage(format: 'png' | 'jpeg', withExif = false): Promise<Buffer> {
  let img = sharp({ create: { width: 40, height: 24, channels: 3, background: '#cc2233' } });
  img = format === 'png' ? img.png() : withExif ? img.jpeg().withMetadata({ exif: { IFD0: { Copyright: 'PRIVATE-GPS-MARKER' } } }) : img.jpeg();
  return img.toBuffer();
}
async function asset(roll: string, ws: string, opts: { name?: string; mime?: string; format?: 'png' | 'jpeg'; exif?: boolean; vis?: string; bytes?: Buffer } = {}): Promise<{ id: string; key: string }> {
  const id = uuidv4();
  const mime = opts.mime ?? (opts.format === 'jpeg' ? 'image/jpeg' : 'image/png');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/svg+xml' ? 'svg' : 'png';
  const key = `assets/${ws}/${id}.${ext}`;
  const bytes = opts.bytes ?? await realImage(opts.format ?? 'png', opts.exif);
  await getStorage().upload(key, bytes, mime);
  await query(`INSERT INTO assets (id, workspace_id, owner_roll, kind, filename, storage_key, mime_type, size_bytes, width, height, created_at, visibility) VALUES ($1,$2,$3,'image',$4,$5,$6,$7,40,24,$8,$9)`,
    [id, ws, roll, opts.name ?? 'work.png', key, mime, bytes.length, new Date().toISOString(), opts.vis ?? 'personal']);
  return { id, key };
}

beforeEach(async () => {
  await query('TRUNCATE "showcase_projects", "showcase_events", "assets", "workspace_members", "workspaces", "boards", "domains" CASCADE');
  await student('ALICE'); await student('BOB'); await student('CAROL');
  await query(`INSERT INTO domains (id, title, full_name) VALUES ('illus','Illustration','Illustration & Art'),('uiux','UI/UX','UI/UX Design')`);
  if (!adminToken) adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
  resetIdentityCapabilityCache();
});
afterAll(() => resetIdentityCapabilityCache());

// A project ready to submit, owned by `roll`.
async function readyProject(roll: string, title = 'Retro Poster Series', extra: { assets?: number } = {}) {
  const ws = await workspaceFor(roll);
  const created = await post(roll, '/mine', { title });
  const id = created.body.id as string;
  await patch(roll, `/mine/${id}`, { summary: 'A series of retro-inspired posters', description: 'Three posters exploring halftone textures and limited palettes for a campus festival.', category: 'illustration', tags: ['Retro', 'poster'], discipline_ids: ['illus'], links: [{ label: 'Behance', url: 'https://www.behance.net/gallery/1' }] });
  const assets: Array<{ id: string; key: string }> = [];
  for (let i = 0; i < (extra.assets ?? 1); i++) assets.push(await asset(roll, ws, { name: `poster-${i}.png` }));
  const works = await put(roll, `/mine/${id}/works`, { works: assets.map((a, i) => ({ asset_id: a.id, caption: `Poster ${i + 1}`, is_cover: i === 0 })) });
  expect(works.status).toBe(200);
  return { id, ws, assets, slug: created.body.slug as string };
}
async function publish(id: string) {
  expect((await aTransition(id, 'approved')).status).toBe(200);
  return aTransition(id, 'published');
}

describe('state machine (pure)', () => {
  const allowed: Array<[ShowcaseStatus, ShowcaseStatus, 'owner' | 'admin']> = [
    ['draft', 'submitted', 'owner'], ['submitted', 'approved', 'admin'], ['approved', 'published', 'admin'], ['published', 'archived', 'owner'],
    ['submitted', 'draft', 'owner'], ['changes_requested', 'submitted', 'owner'], ['archived', 'draft', 'owner'],
  ];
  it.each(allowed)('%s → %s by %s is allowed', (f, t, a) => expect(canTransition(f, t, a, 'because').ok).toBe(true));
  it('never lets a student approve, publish, reject, request changes or skip review', () => {
    for (const [f, t] of [['submitted', 'approved'], ['approved', 'published'], ['submitted', 'rejected'], ['submitted', 'changes_requested'], ['draft', 'published'], ['draft', 'approved']] as const) {
      expect(canTransition(f, t, 'owner', 'reason').ok, `${f}→${t}`).toBe(false);
    }
  });
  it('rejects illegal jumps for admins too', () => {
    for (const [f, t] of [['draft', 'published'], ['draft', 'approved'], ['rejected', 'published'], ['archived', 'published'], ['published', 'draft'], ['submitted', 'published']] as const) {
      expect(canTransition(f, t, 'admin', 'reason').ok, `${f}→${t}`).toBe(false);
    }
  });
  it('requires a reason to reject or request changes', () => {
    expect(canTransition('submitted', 'rejected', 'admin', '').ok).toBe(false);
    expect(canTransition('submitted', 'rejected', 'admin', 'ab').ok).toBe(false);
    expect(canTransition('submitted', 'changes_requested', 'admin', null).ok).toBe(false);
    expect(canTransition('submitted', 'changes_requested', 'admin', 'Please add a cover').ok).toBe(true);
  });
  it('lists every submission problem', () => {
    const base = { title: 'Ok title', summary: 'long enough summary', description: 'x'.repeat(40), category: 'branding', disciplineCount: 1, workCount: 1, coverCount: 1, pendingCredits: 0, ownerDisplayName: 'A', missingSources: 0 };
    expect(submissionProblems(base)).toEqual([]);
    expect(submissionProblems({ ...base, title: 'a', summary: null, description: 'x', category: null, disciplineCount: 0, workCount: 0, coverCount: 0, pendingCredits: 2, ownerDisplayName: ' ', missingSources: 1 }).length).toBeGreaterThanOrEqual(7);
  });
});

describe('validation (pure)', () => {
  it('slugifies safely and avoids route-reserved words', () => {
    expect(slugify('  Retro Poster Series! ')).toBe('retro-poster-series');
    expect(slugify('Café Brändìng')).toBe('cafe-branding');
    expect(slugify('manage')).toBe('manage-project');
    expect(slugify('***')).toBe('project');
  });
  it('rejects unsafe or private links', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'http://localhost/', 'http://127.0.0.1/', 'http://192.168.1.2/', 'https://u:p@x.com/', 'ftp://x.com', 'http://intranet/', 'http://[::1]/', 'http://2130706433/']) expect(validatePublicUrl(u)).toBeNull();
    expect(validatePublicUrl('https://www.behance.net/g/1')).toBe('https://www.behance.net/g/1');
    expect(normalizeLinks([{ label: 'x', url: 'javascript:1' }])).toBeNull();
    expect(normalizeLinks(Array.from({ length: 6 }, () => ({ url: 'https://a.com' })))).toBeNull();
    expect(normalizeLinks([{ url: 'https://www.dribbble.com/s/1' }])).toEqual([{ label: 'dribbble.com', url: 'https://www.dribbble.com/s/1' }]);
  });
});

describe('ownership and draft privacy', () => {
  it('requires a student for creator routes and an admin for moderation', async () => {
    expect((await request(app).get(S('/mine'))).status).toBe(401);
    expect((await request(app).post(S('/mine')).send({ title: 'x y z' })).status).toBe(401);
    const { id } = await readyProject('ALICE');
    for (const headers of [{}, auth('ALICE')]) {
      expect((await request(app).get(S('/admin/projects')).set(headers)).status).toBe(401);
      expect((await request(app).post(S(`/admin/projects/${id}/transition`)).set(headers).send({ to: 'approved' })).status).toBe(401);
      expect((await request(app).post(S(`/admin/projects/${id}/feature`)).set(headers).send({ featured: true })).status).toBe(401);
    }
  });

  it('creates drafts with a unique slug and an accepted owner credit, invisible to everyone else and to the public', async () => {
    const a = await post('ALICE', '/mine', { title: 'Same Title' });
    const b = await post('BOB', '/mine', { title: 'Same Title' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: 'draft', editable: true });
    expect(a.body.slug).not.toBe(b.body.slug);
    expect(a.body.credits[0]).toMatchObject({ isOwner: true, status: 'accepted', displayName: 'Asha Rao' });

    expect((await pub(`/projects/${a.body.slug}`)).status).toBe(404);
    expect((await pub('/projects')).body.total).toBe(0);
    expect((await get('BOB', `/mine/${a.body.id}`)).status).toBe(404);
    expect((await patch('BOB', `/mine/${a.body.id}`, { title: 'hijack' })).status).toBe(404);
    expect((await post('BOB', `/mine/${a.body.id}/submit`)).status).toBe(404);
    expect((await del('BOB', `/mine/${a.body.id}`)).status).toBe(404);
    expect((await get('ALICE', '/mine')).body.projects).toHaveLength(1);
  });

  it('keeps slugs in step with the title only while still an unsubmitted draft', async () => {
    const { id } = await readyProject('ALICE', 'First Name');
    const renamed = await patch('ALICE', `/mine/${id}`, { title: 'Better Name' });
    expect(renamed.body.slug).toBe('better-name');
  });

  it('enforces an active-project cap', async () => {
    for (let i = 0; i < 30; i++) await query(`INSERT INTO showcase_projects (id, owner_roll, slug, title) VALUES ($1,'ALICE',$2,'t')`, [uuidv4(), `s-${i}`]);
    expect((await post('ALICE', '/mine', { title: 'One too many' })).status).toBe(400);
  });
});

describe('works: only the owner’s own private images', () => {
  it('rejects other people’s assets (private or Community), non-images, SVG and over-limit sets', async () => {
    const wsA = await workspaceFor('ALICE'); const wsB = await workspaceFor('BOB');
    const id = (await post('ALICE', '/mine', { title: 'My project' })).body.id;
    const bobs = await asset('BOB', wsB, { vis: 'community' });
    expect((await put('ALICE', `/mine/${id}/works`, { works: [{ asset_id: bobs.id }] })).status).toBe(404);
    const svg = await asset('ALICE', wsA, { mime: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    expect((await put('ALICE', `/mine/${id}/works`, { works: [{ asset_id: svg.id }] })).status).toBe(400);
    expect((await put('ALICE', `/mine/${id}/works`, { works: Array.from({ length: 13 }, () => ({ asset_id: 'x' })) })).status).toBe(400);
    const mine = await asset('ALICE', wsA);
    expect((await put('ALICE', `/mine/${id}/works`, { works: [{ asset_id: mine.id }, { asset_id: mine.id }] })).status).toBe(400);
    const ok = await put('ALICE', `/mine/${id}/works`, { works: [{ asset_id: mine.id, caption: 'First' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.works[0]).toMatchObject({ isCover: true, caption: 'First' });
  });
});

describe('submission, review and publication', () => {
  it('blocks incomplete submissions with a list of problems and freezes content while under review', async () => {
    const id = (await post('ALICE', '/mine', { title: 'Bare project' })).body.id;
    const bad = await post('ALICE', `/mine/${id}/submit`);
    expect(bad.status).toBe(400);
    expect(bad.body.problems.length).toBeGreaterThanOrEqual(5);

    const ready = await readyProject('BOB');
    expect((await post('BOB', `/mine/${ready.id}/submit`)).status).toBe(200);
    expect((await patch('BOB', `/mine/${ready.id}`, { title: 'Sneaky edit' })).status).toBe(409);
    expect((await put('BOB', `/mine/${ready.id}/works`, { works: [] })).status).toBe(409);
    expect((await del('BOB', `/mine/${ready.id}`)).status).toBe(409);
    expect((await post('BOB', `/mine/${ready.id}/withdraw`)).body.status).toBe('draft');
    expect((await patch('BOB', `/mine/${ready.id}`, { summary: 'Edited after withdrawing' })).status).toBe(200);
  });

  it('runs request-changes → resubmit → approve → publish, recording reasons and an audit trail, with admin-only authority', async () => {
    const { id } = await readyProject('ALICE');
    await post('ALICE', `/mine/${id}/submit`);
    expect((await aTransition(id, 'changes_requested')).status).toBe(400); // reason required
    const cr = await aTransition(id, 'changes_requested', 'Please add a process image');
    expect(cr.body).toMatchObject({ status: 'changes_requested', reviewNote: 'Please add a process image' });
    expect((await get('ALICE', `/mine/${id}`)).body.reviewNote).toBe('Please add a process image');
    expect((await post('ALICE', `/mine/${id}/submit`)).body.status).toBe('submitted');
    expect((await aTransition(id, 'published')).status).toBe(409); // must be approved first
    expect((await aTransition(id, 'approved')).body.status).toBe('approved');
    expect((await post('ALICE', `/mine/${id}/withdraw`)).status).toBe(409); // already approved
    const done = await aTransition(id, 'published');
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('published');
    const trail = (await query('SELECT from_status, to_status, actor_kind, reason FROM showcase_events WHERE project_id = $1 ORDER BY id', [id])) as Array<{ from_status: string | null; to_status: string; actor_kind: string; reason: string | null }>;
    expect(trail.map(e => `${e.from_status ?? '-'}>${e.to_status}:${e.actor_kind}`)).toEqual([
      '->draft:student', 'draft>submitted:student', 'submitted>changes_requested:admin', 'changes_requested>submitted:student', 'submitted>approved:admin', 'approved>published:admin']);
    expect(trail[2].reason).toBe('Please add a process image');
  });

  it('rejects with a reason and keeps rejected projects private; invalid moves return 409', async () => {
    const { id, slug } = await readyProject('ALICE');
    await post('ALICE', `/mine/${id}/submit`);
    expect((await aTransition(id, 'rejected')).status).toBe(400);
    expect((await aTransition(id, 'rejected', 'Not original work')).body.status).toBe('rejected');
    expect((await pub(`/projects/${slug}`)).status).toBe(404);
    expect((await aTransition(id, 'published', 'x')).status).toBe(409);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(409);
    expect((await post('ALICE', `/mine/${id}/archive`)).body.status).toBe('archived');
  });

  it('publishes by COPYING: public file is a new sanitised object, the private source is untouched and never exposed', async () => {
    const wsA = await workspaceFor('ALICE');
    const created = await post('ALICE', '/mine', { title: 'Photo Study' });
    const id = created.body.id as string;
    await patch('ALICE', `/mine/${id}`, { summary: 'A photography study', description: 'A longer description of this photography study for review.', category: 'photography', discipline_ids: ['illus'] });
    const src = await asset('ALICE', wsA, { format: 'jpeg', exif: true, name: 'IMG_secret.jpg' });
    await put('ALICE', `/mine/${id}/works`, { works: [{ asset_id: src.id, caption: 'Shot 1' }] });
    await post('ALICE', `/mine/${id}/submit`);
    const before = (await query('SELECT visibility, storage_key FROM assets WHERE id = $1', [src.id]))[0];
    expect((await publish(id)).status).toBe(200);

    const detail = await pub(`/projects/${created.body.slug}`);
    expect(detail.status).toBe(200);
    const url: string = detail.body.works[0].url;
    expect(url).toContain('showcase/');
    expect(url).not.toContain(src.key);
    expect(detail.body.cover.url).toBe(url);

    // Source asset untouched.
    expect((await query('SELECT visibility, storage_key FROM assets WHERE id = $1', [src.id]))[0]).toEqual(before);
    // The copy exists as its own object, and the embedded EXIF marker is gone while the source still has it.
    const copyKey = url.slice(url.indexOf('showcase/'));
    const copy = await getStorage().download(copyKey);
    expect(copy.includes(Buffer.from('PRIVATE-GPS-MARKER'))).toBe(false);
    expect((await getStorage().download(src.key)).includes(Buffer.from('PRIVATE-GPS-MARKER'))).toBe(true);
    expect((await sharp(copy).metadata()).format).toBe('jpeg');

    // Nothing private leaks anywhere in public responses.
    const blob = JSON.stringify([detail.body, (await pub('/projects')).body, (await pub('/facets')).body]);
    for (const secret of [src.id, src.key, 'ALICE', 'alice@iitk.ac.in', 'IMG_secret', wsA, 'owner_roll', 'storage_key']) expect(blob, secret).not.toContain(secret);
  });

  it('refuses to publish when a source image is no longer owned/available, leaving the project approved with no stray copies', async () => {
    const { id, assets } = await readyProject('ALICE', 'Two Works', { assets: 2 });
    await post('ALICE', `/mine/${id}/submit`);
    await aTransition(id, 'approved');
    await query(`UPDATE assets SET status = 'hidden' WHERE id = $1`, [assets[1].id]);
    const res = await aTransition(id, 'published');
    expect(res.status).toBe(409);
    expect((await get('ALICE', `/mine/${id}`)).body.status).toBe('approved');
    expect(await getStorage().list(`showcase/${id}/`)).toHaveLength(0);
    expect((await query('SELECT public_key FROM showcase_assets WHERE project_id = $1 AND public_key IS NOT NULL', [id]))).toHaveLength(0);

    await query(`UPDATE assets SET status = 'active', owner_roll = 'BOB' WHERE id = $1`, [assets[1].id]); // ownership changed
    expect((await aTransition(id, 'published')).status).toBe(409);
    expect(await getStorage().list(`showcase/${id}/`)).toHaveLength(0);
  });

  it('archiving removes the public copies and the public page; reopening restarts review', async () => {
    const { id, slug } = await readyProject('ALICE');
    await post('ALICE', `/mine/${id}/submit`);
    await publish(id);
    expect(await getStorage().list(`showcase/${id}/`)).toHaveLength(1);
    expect((await post('BOB', `/mine/${id}/archive`)).status).toBe(404);
    expect((await post('ALICE', `/mine/${id}/archive`)).body.status).toBe('archived');
    expect((await pub(`/projects/${slug}`)).status).toBe(404);
    expect(await getStorage().list(`showcase/${id}/`)).toHaveLength(0);
    expect((await patch('ALICE', `/mine/${id}`, { title: 'Edit while archived' })).status).toBe(409);
    expect((await post('ALICE', `/mine/${id}/reopen`)).body.status).toBe('draft');
    expect((await del('ALICE', `/mine/${id}`)).status).toBe(200);
  });

  it('does not let the owner edit or delete a published project directly', async () => {
    const { id } = await readyProject('ALICE');
    await post('ALICE', `/mine/${id}/submit`);
    await publish(id);
    expect((await patch('ALICE', `/mine/${id}`, { title: 'Bypass review' })).status).toBe(409);
    expect((await del('ALICE', `/mine/${id}`)).status).toBe(409);
  });
});

describe('contributors and consent', () => {
  it('requires acceptance before submission and shows only the accepted, self-chosen display name publicly', async () => {
    const { id, slug } = await readyProject('ALICE');
    expect((await post('ALICE', `/mine/${id}/credits`, { roll: 'NOBODY1' })).status).toBe(404);
    expect((await post('ALICE', `/mine/${id}/credits`, { roll: 'alice' })).status).toBe(400);
    const inv = await post('ALICE', `/mine/${id}/credits`, { roll: 'bob', role_label: 'Illustrator', contribution: 'Drew poster 2' });
    expect(inv.status).toBe(201);
    expect((await post('ALICE', `/mine/${id}/credits`, { roll: 'BOB' })).status).toBe(409);
    expect((await post('ALICE', `/mine/${id}/submit`)).body.problems.join(' ')).toMatch(/contributors to accept/);

    const invitations = (await get('BOB', '/invitations')).body.invitations;
    expect(invitations).toHaveLength(1);
    expect(JSON.stringify(invitations)).not.toContain('ALICE');
    const credit = inv.body.credits.find((c: { roll: string }) => c.roll === 'BOB').id as string;
    expect((await post('CAROL', `/invitations/${credit}/accept`, { display_name: 'Carol' })).status).toBe(404);
    expect((await post('ALICE', `/invitations/${credit}/accept`, { display_name: 'Bob' })).status).toBe(404); // owner cannot consent for them
    expect((await post('BOB', `/invitations/${credit}/accept`, {})).status).toBe(400);
    expect((await post('BOB', `/invitations/${credit}/accept`, { display_name: 'Bobby D.' })).status).toBe(200);

    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
    await publish(id);
    const credits = (await pub(`/projects/${slug}`)).body.credits;
    expect(credits).toEqual([
      { displayName: 'Asha Rao', roleLabel: 'Creator', isOwner: true },
      { displayName: 'Bobby D.', roleLabel: 'Illustrator', isOwner: false },
    ]);

    // A contributor can withdraw their credit at any time; it leaves the public page immediately.
    expect((await post('BOB', `/invitations/${credit}/decline`)).status).toBe(200);
    expect((await pub(`/projects/${slug}`)).body.credits).toHaveLength(1);
  });

  it('un-accepts a credit when the owner changes the contributor’s role, and declined contributors never block or appear', async () => {
    const { id } = await readyProject('ALICE');
    const inv = await post('ALICE', `/mine/${id}/credits`, { roll: 'BOB', role_label: 'Designer' });
    const credit = inv.body.credits.find((c: { roll: string }) => c.roll === 'BOB').id as string;
    await post('BOB', `/invitations/${credit}/accept`, { display_name: 'Bob' });
    const edited = await patch('ALICE', `/mine/${id}/credits/${credit}`, { role_label: 'Lead designer' });
    expect(edited.body.credits.find((c: { id: string }) => c.id === credit).status).toBe('pending');
    await post('BOB', `/invitations/${credit}/decline`);
    expect((await post('ALICE', `/mine/${id}/submit`)).status).toBe(200);
    expect((await patch('ALICE', `/mine/${id}/credits/${credit}`, { role_label: 'x' })).status).toBe(409); // frozen while submitted
  });

  it('will not publish if a contributor became pending after approval-time checks', async () => {
    const { id } = await readyProject('ALICE');
    await post('ALICE', `/mine/${id}/submit`);
    await aTransition(id, 'approved');
    await query(`INSERT INTO showcase_credits (id, project_id, roll, status) VALUES ($1,$2,'BOB','pending')`, [uuidv4(), id]);
    expect((await aTransition(id, 'published')).status).toBe(409);
  });
});

describe('disciplines', () => {
  it('lists the existing domains as a light public list', async () => {
    const r = await pub('/disciplines');
    expect(r.status).toBe(200);
    expect(r.body.disciplines).toEqual([{ id: 'illus', title: 'Illustration' }, { id: 'uiux', title: 'UI/UX' }]);
  });
});

describe('abuse limits', () => {
  it('rate-limits contributor invitations', async () => {
    process.env.SHOWCASE_TEST_LIMITS = '1';
    try {
      const id = (await post('ALICE', '/mine', { title: 'Limited project' })).body.id;
      let last = 0;
      for (let i = 0; i < 22; i++) last = (await post('ALICE', `/mine/${id}/credits`, { roll: 'NOBODY' })).status;
      expect(last).toBe(429);
    } finally { delete process.env.SHOWCASE_TEST_LIMITS; }
  });
});

describe('public listing, search and filters', () => {
  async function published(roll: string, title: string, over: object = {}, disc = 'illus') {
    const { id } = await readyProject(roll, title);
    await patch(roll, `/mine/${id}`, { discipline_ids: [disc], ...over });
    await post(roll, `/mine/${id}/submit`);
    await publish(id);
    return id;
  }

  it('lists only published projects and filters by search, category, discipline, tag, featured; sorts and paginates', async () => {
    const a = await published('ALICE', 'Neon Posters', { category: 'illustration', tags: ['neon', 'poster'] });
    await new Promise(r => setTimeout(r, 15));
    await published('BOB', 'Brand Guidelines', { category: 'branding', tags: ['brand'], summary: 'A brand system for a club' }, 'uiux');
    await readyProject('CAROL', 'Unsubmitted Secret Draft'); // draft — never listed
    const titles = (r: { body: { projects: Array<{ title: string }> } }) => r.body.projects.map(p => p.title);

    expect(titles(await pub('/projects'))).toEqual(['Brand Guidelines', 'Neon Posters']);
    expect(titles(await pub('/projects?q=neon'))).toEqual(['Neon Posters']);
    expect(titles(await pub('/projects?q=club'))).toEqual(['Brand Guidelines']);
    expect(titles(await pub('/projects?q=secret'))).toEqual([]);
    expect((await pub('/projects?q=%25')).body.total).toBe(0);
    expect(titles(await pub('/projects?category=branding'))).toEqual(['Brand Guidelines']);
    expect(titles(await pub('/projects?discipline=uiux'))).toEqual(['Brand Guidelines']);
    expect(titles(await pub('/projects?tag=poster'))).toEqual(['Neon Posters']);
    expect(titles(await pub('/projects?sort=title'))).toEqual(['Brand Guidelines', 'Neon Posters']);
    expect(titles(await pub('/projects?sort=oldest'))).toEqual(['Neon Posters', 'Brand Guidelines']);
    expect((await pub('/projects?category=bogus')).status).toBe(400);
    expect((await pub('/projects?sort=random')).status).toBe(400);
    const page = await pub('/projects?limit=1');
    expect(page.body).toMatchObject({ total: 2, hasMore: true });
    expect((await pub('/projects?limit=1&offset=1')).body.hasMore).toBe(false);

    const facets = (await pub('/facets')).body;
    expect(facets.categories).toEqual(expect.arrayContaining([{ category: 'branding', count: 1 }, { category: 'illustration', count: 1 }]));
    expect(facets.tags.map((t: { tag: string }) => t.tag)).not.toContain('secret');

    // Featuring is admin-only and only for published projects.
    expect((await request(app).post(S(`/admin/projects/${a}/feature`)).set(auth('ALICE')).send({ featured: true })).status).toBe(401);
    expect((await request(app).post(S(`/admin/projects/${a}/feature`)).set(adm()).send({ featured: true })).body.featured).toBe(true);
    expect(titles(await pub('/projects?featured=1'))).toEqual(['Neon Posters']);
    expect(titles(await pub('/projects?sort=featured'))[0]).toBe('Neon Posters');
    const draft = (await post('CAROL', '/mine', { title: 'Another draft' })).body.id;
    expect((await request(app).post(S(`/admin/projects/${draft}/feature`)).set(adm()).send({ featured: true })).status).toBe(409);
    await post('ALICE', `/mine/${a}/archive`);
    expect(titles(await pub('/projects?featured=1'))).toEqual([]);
  });
});

describe('admin review view', () => {
  it('lists submitted work first, hides drafts, and exposes attribution for review', async () => {
    const { id } = await readyProject('ALICE');
    await readyProject('BOB'); // stays a draft
    await post('ALICE', `/mine/${id}/submit`);
    const list = (await request(app).get(S('/admin/projects')).set(adm())).body.projects;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, status: 'submitted', ownerRoll: 'ALICE' });
    const detail = (await request(app).get(S(`/admin/projects/${id}`)).set(adm())).body;
    expect(detail.credits[0]).toMatchObject({ roll: 'ALICE', isOwner: true });
    expect(detail.works[0].previewUrl).toBeTruthy();
    expect((await request(app).get(S('/admin/projects?status=nope')).set(adm())).status).toBe(400);
  });
});

describe('moodboards and Gallery artwork integration', () => {
  it('lets owners attach their own boards as private references only', async () => {
    const { id, ws } = await readyProject('ALICE');
    const board = (await request(app).post('/api/boards').set(auth('ALICE')).send({ name: 'Process', workspace_id: ws })).body;
    const bws = await workspaceFor('BOB');
    const bobBoard = (await request(app).post('/api/boards').set(auth('BOB')).send({ name: 'Bobs', workspace_id: bws })).body;
    expect((await put('ALICE', `/mine/${id}/boards`, { board_ids: [bobBoard.id] })).status).toBe(404);
    const ok = await put('ALICE', `/mine/${id}/boards`, { board_ids: [board.id] });
    expect(ok.body.boards).toEqual([{ id: board.id, name: 'Process' }]);
    await post('ALICE', `/mine/${id}/submit`);
    await publish(id);
    const slug = (await get('ALICE', `/mine/${id}`)).body.slug;
    const detail = JSON.stringify((await pub(`/projects/${slug}`)).body);
    expect(detail).not.toContain(board.id);
    expect(detail).not.toContain('Process');
  });

  it('only lets a student attach Gallery artwork they hold an accepted credit on, and links only PUBLIC profiles', async () => {
    const { id } = await readyProject('ALICE');
    await query(`INSERT INTO artworks (id, title, artist, domain, image_url) VALUES ('art1','Gallery Piece','Someone','Illustration','/uploads/x.png')`);
    resetIdentityCapabilityCache();
    expect((await pub('/capabilities')).body).toEqual({ profiles: true, artworkCredits: true });
    // Real #84 tables: no profile and no credit yet, so attaching is refused.
    expect((await put('ALICE', `/mine/${id}/artworks`, { artwork_ids: ['art1'] })).status).toBe(403);

    await query(`INSERT INTO designer_profiles (id, owner_roll, handle, display_name, visibility) VALUES ('p1','ALICE','alice-draws','Alice','public'),('p2','BOB','bob-private','Bob','private')`);
    expect((await put('ALICE', `/mine/${id}/artworks`, { artwork_ids: ['art1'] })).status).toBe(403); // profile but not credited yet
    await query(`INSERT INTO artwork_credits (id, artwork_id, profile_id, role, status, source) VALUES ('c1','art1','p1','creator','pending','invite')`);
    expect((await put('ALICE', `/mine/${id}/artworks`, { artwork_ids: ['art1'] })).status).toBe(403); // pending is not consent
    await query(`UPDATE artwork_credits SET status = 'accepted' WHERE id = 'c1'`);
    expect((await put('ALICE', `/mine/${id}/artworks`, { artwork_ids: ['art1'] })).status).toBe(200);
    expect((await put('BOB', `/mine/${(await post('BOB', '/mine', { title: 'Bobs project' })).body.id}/artworks`, { artwork_ids: ['art1'] })).status).toBe(403);

    const inv = await post('ALICE', `/mine/${id}/credits`, { roll: 'BOB' });
    await post('BOB', `/invitations/${inv.body.credits.find((c: { roll: string }) => c.roll === 'BOB').id}/accept`, { display_name: 'Bob' });
    await post('ALICE', `/mine/${id}/submit`);
    await publish(id);
    const slug = (await get('ALICE', `/mine/${id}`)).body.slug;
    const detail = (await pub(`/projects/${slug}`)).body;
    expect(detail.artworks).toEqual([{ id: 'art1', title: 'Gallery Piece', imageUrl: '/uploads/x.png', mediaType: 'image' }]);
    expect(detail.credits[0].profile).toEqual({ handle: 'alice-draws' });   // public profile → link
    expect(detail.credits[1].profile).toBeUndefined();                      // private profile → no link
    await query('DELETE FROM artworks WHERE id = $1', ['art1']);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { localRequest } from './localServer';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { resetDirectoryCapabilityCache, previewBio, isValidHandle, clampLimit, clampOffset, likePattern } from '../src/lib/creatorDirectory';

// Creator Discovery (Milestone E). Integration tests run against the REAL
// schema (#84 designer/credit tables + #100 showcase tables) that the shared
// tests/setup.ts builds with initSchema(); nothing here creates or drops tables.

const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
let adminToken = '';
const adm = () => ({ Authorization: `Bearer ${adminToken}` });
const dir = (qs = '') => request(app).get(`/api/creators${qs}`);

const NAMES: Record<string, string> = { ASHA: 'Asha Rao', BALA: 'Bala Iyer', CHITRA: 'Chitra Nair', DEV: 'Dev Menon', ELA: 'Ela Joshi' };
async function student(roll: string) {
  await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES ($1,$2,'01 Jan 2026',$3,$4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, NAMES[roll] ?? 'Some Student', `${roll.toLowerCase()}@iitk.ac.in`]);
}
async function profile(roll: string, handle: string, over: Partial<{ name: string; headline: string; bio: string; skills: string[]; visibility: string; moderation: string; avatar: string | null; verified: boolean; disciplines: string[]; created: string }> = {}): Promise<string> {
  await student(roll);
  const id = uuidv4();
  await query(`INSERT INTO designer_profiles (id, owner_roll, handle, display_name, headline, bio, skills, avatar_key, visibility, moderation_status, verified_at, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, roll, handle, over.name ?? NAMES[roll] ?? 'Some Student', over.headline ?? null, over.bio ?? null, over.skills ?? [], over.avatar ?? null,
      over.visibility ?? 'public', over.moderation ?? 'active', over.verified ? new Date().toISOString() : null, over.created ?? new Date().toISOString()]);
  for (const d of over.disciplines ?? []) await query('INSERT INTO designer_profile_disciplines (profile_id, domain_id) VALUES ($1,$2)', [id, d]);
  return id;
}
async function project(owner: string, title: string, o: { status?: string; category?: string; credits?: Array<{ roll: string; status: string; role?: string }>; cover?: string | null } = {}): Promise<string> {
  const id = uuidv4();
  await query(`INSERT INTO showcase_projects (id, owner_roll, slug, title, summary, category, status, published_at) VALUES ($1,$2,$3,$4,'summary',$5,$6,NOW())`,
    [id, owner, `${title.toLowerCase().replace(/\W+/g, '-')}-${id.slice(0, 4)}`, title, o.category ?? 'illustration', o.status ?? 'published']);
  await query(`INSERT INTO showcase_credits (id, project_id, roll, role_label, display_name, status, is_owner) VALUES ($1,$2,$3,'Creator','x','accepted',true)`, [uuidv4(), id, owner]);
  for (const c of o.credits ?? []) await query(`INSERT INTO showcase_credits (id, project_id, roll, role_label, display_name, status) VALUES ($1,$2,$3,$4,'y',$5)`, [uuidv4(), id, c.roll, c.role ?? 'Illustrator', c.status]);
  if (o.cover !== null) await query(`INSERT INTO showcase_assets (id, project_id, caption, position, is_cover, public_key) VALUES ($1,$2,NULL,0,true,$3)`, [uuidv4(), id, o.cover ?? `showcase/${id}/cover.png`]);
  return id;
}

afterAll(() => { resetDirectoryCapabilityCache(); });

describe('pure helpers', () => {
  it('validates handles and clamps paging so a scraper cannot request big pages', () => {
    expect(isValidHandle('asha-rao')).toBe(true);
    for (const h of ['ab', 'Asha', '-x-', 'a--b', 'has space', 'x'.repeat(31), '', null, '../admin']) expect(isValidHandle(h)).toBe(false);
    expect(clampLimit('500')).toBe(36); expect(clampLimit('-3')).toBe(24); expect(clampLimit('abc')).toBe(24); expect(clampLimit('5')).toBe(5);
    expect(clampOffset('99999')).toBe(600); expect(clampOffset('-1')).toBe(0);
    expect(likePattern('50%_x')).toBe('%50\\%\\_x%');
  });
  it('shortens bios at a word boundary', () => {
    expect(previewBio(null)).toBeNull(); expect(previewBio('  ')).toBeNull(); expect(previewBio('short')).toBe('short');
    const long = previewBio('word '.repeat(80))!;
    expect(long.length).toBeLessThanOrEqual(162); expect(long.endsWith('…')).toBe(true);
  });
});

describe('capabilities and empty states on the real schema', () => {
  beforeEach(async () => {
    resetDirectoryCapabilityCache();
    await query('TRUNCATE "student_sessions", "domains", "showcase_projects", "creator_features", "creator_audit_log" CASCADE');
    if (!adminToken) adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
  });
  it('reports every capability as available and answers an empty directory honestly', async () => {
    expect((await dir('/capabilities')).body).toEqual({ profiles: true, projects: true, artworkCredits: true });
    expect((await dir()).body).toEqual({ creators: [], total: 0, hasMore: false });
    expect((await dir('/featured')).body).toEqual({ creators: [] });
    expect((await dir('/facets')).body).toMatchObject({ total: 0, disciplines: [] });
    expect((await dir('/someone/projects')).status).toBe(404);
  });
});

describe('with canonical profiles (#84) and showcase (#100)', () => {
  beforeAll(() => { resetDirectoryCapabilityCache(); });
  beforeEach(async () => {
    await query('TRUNCATE "student_sessions", "domains", "showcase_projects", "creator_features", "creator_audit_log" CASCADE');
    await query(`INSERT INTO domains (id, title, full_name, color, display_order) VALUES ('illus','Illustration','Illustration & Art','#ff0000',1),('uiux','UI/UX','UI/UX Design','#0000ff',2),('motion','Motion','Motion Design','#00ff00',3)`);
    if (!adminToken) adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
    resetDirectoryCapabilityCache();
  });

  it('lists only PUBLIC + ACTIVE profiles, and never leaks private fields', async () => {
    await profile('ASHA', 'asha-draws', { headline: 'Illustrator', bio: 'Hand-drawn posters', skills: ['procreate'], disciplines: ['illus'], avatar: 'profiles/a.png', verified: true });
    await profile('BALA', 'bala-private', { visibility: 'private' });
    await profile('CHITRA', 'chitra-members', { visibility: 'members' });
    await profile('DEV', 'dev-hidden', { moderation: 'hidden' });
    const res = await dir();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.total).toBe(1);
    expect(res.body.creators).toEqual([{
      handle: 'asha-draws', displayName: 'Asha Rao', headline: 'Illustrator', bio: 'Hand-drawn posters', avatarUrl: expect.stringContaining('profiles/a.png'),
      verified: true, featured: false, skills: ['procreate'], disciplines: [{ id: 'illus', title: 'Illustration', color: '#ff0000' }], projectCount: 0, projects: [],
    }]);
    const blob = JSON.stringify([res.body, (await dir('/facets')).body, (await dir('/featured')).body]);
    for (const roll of ['ASHA', 'BALA', 'CHITRA', 'DEV', 'IITK-DnA']) expect(blob, roll).not.toContain(roll);   // roll numbers / unique ids (case-sensitive)
    for (const secret of ['@iitk', 'owner_roll', 'avatar_key', 'bala', 'chitra', 'dev-hidden']) expect(blob.toLowerCase(), secret).not.toContain(secret);
  });

  it('searches by username, display name, headline, skill and discipline — and only within public profiles', async () => {
    await profile('ASHA', 'asha-draws', { headline: 'Poster illustrator', skills: ['procreate', 'risograph'], disciplines: ['illus'] });
    await profile('BALA', 'bala-ui', { name: 'Bala Iyer', disciplines: ['uiux'] });
    await profile('CHITRA', 'chitra-secret', { name: 'Chitra Nair', visibility: 'private', skills: ['risograph'] });
    const found = async (q: string) => (await dir(`?q=${encodeURIComponent(q)}`)).body.creators.map((c: { handle: string }) => c.handle);
    expect(await found('asha-draws')).toEqual(['asha-draws']);
    expect(await found('ASHA')).toEqual(['asha-draws']);
    expect(await found('iyer')).toEqual(['bala-ui']);
    expect(await found('poster')).toEqual(['asha-draws']);
    expect(await found('risograph')).toEqual(['asha-draws']);          // the private profile with the same skill never appears
    expect(await found('UI/UX')).toEqual(['bala-ui']);                 // discipline title
    expect(await found('chitra')).toEqual([]);                         // private: same as "does not exist"
    expect(await found('chitra-secret')).toEqual([]);
    expect(await found('asha@iitk.ac.in')).toEqual([]);                // emails are never searchable
    expect(await found('ASHA')).toEqual(['asha-draws']);               // (roll-like text only matches public handle/name)
    expect(await found('%')).toEqual([]);                              // wildcards are literal
    expect(await found('IITK-DnA')).toEqual([]);                       // unique ids are never searchable
  });

  it('filters by discipline, skill and showcase category; sorts; rejects bad params', async () => {
    await profile('ASHA', 'asha-draws', { skills: ['procreate'], disciplines: ['illus'], created: '2026-01-01T00:00:00Z' });
    await profile('BALA', 'bala-ui', { skills: ['figma'], disciplines: ['uiux', 'motion'], created: '2026-03-01T00:00:00Z' });
    await project('ASHA', 'Poster', { category: 'illustration' });
    await project('BALA', 'App', { category: 'ui-ux' });
    const handles = async (qs: string) => (await dir(qs)).body.creators.map((c: { handle: string }) => c.handle);
    expect(await handles('?discipline=uiux')).toEqual(['bala-ui']);
    expect(await handles('?discipline=motion')).toEqual(['bala-ui']);
    expect(await handles('?skill=Figma')).toEqual(['bala-ui']);
    expect(await handles('?category=illustration')).toEqual(['asha-draws']);
    expect(await handles('?category=ui-ux&discipline=uiux')).toEqual(['bala-ui']);
    expect(await handles('?category=ui-ux&discipline=illus')).toEqual([]);
    expect(await handles('?sort=name')).toEqual(['asha-draws', 'bala-ui']);
    expect(await handles('?sort=newest')).toEqual(['bala-ui', 'asha-draws']);
    expect((await dir('?sort=popular')).status).toBe(400);
    expect((await dir('?category=bogus')).status).toBe(400);
    const facets = (await dir('/facets')).body;
    expect(facets.total).toBe(2);
    expect(facets.disciplines).toEqual(expect.arrayContaining([{ id: 'uiux', title: 'UI/UX', color: '#0000ff', count: 1 }]));
    expect(facets.categories).toEqual(expect.arrayContaining([{ category: 'illustration', count: 1 }]));
  });

  it('paginates with capped page size and offset, reporting hasMore', async () => {
    for (let i = 0; i < 5; i++) await profile(`R${i}`, `creator-${i}`, { name: `Creator ${i}` });
    const p1 = await dir('?sort=name&limit=2');
    expect(p1.body).toMatchObject({ total: 5, hasMore: true });
    expect(p1.body.creators.map((c: { handle: string }) => c.handle)).toEqual(['creator-0', 'creator-1']);
    const p3 = await dir('?sort=name&limit=2&offset=4');
    expect(p3.body.creators).toHaveLength(1);
    expect(p3.body.hasMore).toBe(false);
    expect((await dir('?limit=9999')).body.creators).toHaveLength(5);
    expect((await dir('?offset=100000')).body.creators).toHaveLength(0);
  });

  it('shows creator cards with ONLY published projects and accepted credits', async () => {
    await profile('ASHA', 'asha-draws');
    await profile('BALA', 'bala-ui');
    await project('ASHA', 'Published One');
    await project('ASHA', 'Secret Draft', { status: 'draft' });
    await project('ASHA', 'In Review', { status: 'submitted' });
    await project('BALA', 'Team Project', { credits: [{ roll: 'ASHA', status: 'accepted', role: 'Illustrator' }] });
    await project('BALA', 'Withdrawn', { credits: [{ roll: 'ASHA', status: 'declined' }] });
    await project('BALA', 'Pending', { credits: [{ roll: 'ASHA', status: 'pending' }] });
    const asha = (await dir('?q=asha-draws')).body.creators[0];
    expect(asha.projectCount).toBe(2);
    expect(asha.projects.map((p: { title: string }) => p.title).sort()).toEqual(['Published One', 'Team Project']);
    expect(JSON.stringify(asha)).not.toMatch(/Secret Draft|In Review|Withdrawn|Pending/);

    const list = await dir('/asha-draws/projects');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    const team = list.body.projects.find((p: { title: string }) => p.title === 'Team Project');
    expect(team).toMatchObject({ roleLabel: 'Illustrator', isOwner: false });
    expect(team.coverUrl).toContain('showcase/');
    expect(Object.keys(team).sort()).toEqual(['category', 'coverUrl', 'featured', 'isOwner', 'publishedAt', 'roleLabel', 'slug', 'summary', 'title']);
    // A contributor who withdrew sees nothing from that project, immediately.
    await query(`UPDATE showcase_credits SET status = 'declined' WHERE roll = 'ASHA' AND role_label = 'Illustrator' AND project_id = (SELECT id FROM showcase_projects WHERE title = 'Team Project')`);
    expect((await dir('/asha-draws/projects')).body.total).toBe(1);
  });

  it('a published project never overrides a private or hidden profile', async () => {
    await profile('ASHA', 'asha-private', { visibility: 'private' });
    await profile('BALA', 'bala-hidden', { moderation: 'hidden' });
    await profile('CHITRA', 'chitra-members', { visibility: 'members' });
    for (const r of ['ASHA', 'BALA', 'CHITRA']) await project(r, `${r} work`);
    for (const h of ['asha-private', 'bala-hidden', 'chitra-members', 'nobody-here', 'x']) {
      expect((await dir(`/${h}/projects`)).status, h).toBe(404);
    }
    expect((await dir()).body.total).toBe(0);
    expect((await dir('?category=illustration')).body.total).toBe(0);
    expect((await dir('/facets')).body.categories).toEqual([]);
  });

  it('applies visibility changes immediately everywhere (no stale cache)', async () => {
    const id = await profile('ASHA', 'asha-draws', { disciplines: ['illus'] });
    await project('ASHA', 'Poster');
    await request(app).put(`/api/creators/admin/${id}/featured`).set(adm()).send({ featured: true });
    expect((await dir()).body.total).toBe(1);
    expect((await dir('/featured')).body.creators).toHaveLength(1);
    await query(`UPDATE designer_profiles SET visibility = 'private' WHERE id = $1`, [id]);
    expect((await dir()).body.total).toBe(0);
    expect((await dir('/featured')).body.creators).toHaveLength(0);          // featured row remains but grants no visibility
    expect((await dir('/asha-draws/projects')).status).toBe(404);
    expect((await dir('/facets')).body.disciplines).toEqual([]);
    await query(`UPDATE designer_profiles SET visibility = 'public' WHERE id = $1`, [id]);
    expect((await dir('/featured')).body.creators).toHaveLength(1);
    await query(`UPDATE designer_profiles SET moderation_status = 'hidden' WHERE id = $1`, [id]);
    expect((await dir()).body.total).toBe(0);
  });

  it('tolerates a profile with no image, bio or disciplines', async () => {
    await profile('ASHA', 'asha-draws');
    const c = (await dir()).body.creators[0];
    expect(c).toMatchObject({ avatarUrl: null, bio: null, headline: null, disciplines: [], skills: [], projects: [] });
  });
});

describe('featured creators', () => {
  beforeAll(() => { resetDirectoryCapabilityCache(); });
  beforeEach(async () => {
    await query('TRUNCATE "student_sessions", "domains", "creator_features", "creator_audit_log" CASCADE');
    resetDirectoryCapabilityCache();
  });
  const feature = (id: string, featured: boolean, headers: Record<string, string> = adm()) => request(app).put(`/api/creators/admin/${id}/featured`).set(headers).send({ featured });

  it('is admin-only: anonymous, any student (including the owner) and bad tokens are rejected', async () => {
    const id = await profile('ASHA', 'asha-draws');
    for (const headers of [{}, auth('ASHA'), auth('BALA'), { Authorization: 'Bearer nonsense' }]) {
      expect((await feature(id, true, headers)).status, JSON.stringify(headers)).toBe(401);
      expect((await request(app).get('/api/creators/admin/list').set(headers)).status).toBe(401);
    }
    expect((await dir('/featured')).body.creators).toHaveLength(0);
  });

  it('features only public, active profiles; is idempotent; unfeatures; and writes an audit trail', async () => {
    const pub = await profile('ASHA', 'asha-draws');
    const priv = await profile('BALA', 'bala-private', { visibility: 'private' });
    const hidden = await profile('CHITRA', 'chitra-hidden', { moderation: 'hidden' });
    expect((await feature(priv, true)).status).toBe(409);
    expect((await feature(hidden, true)).status).toBe(409);
    expect((await feature('no-such-id', true)).status).toBe(404);
    expect((await request(app).put(`/api/creators/admin/${pub}/featured`).set(adm()).send({ featured: 'yes' })).status).toBe(400);
    expect((await feature(pub, true)).body).toEqual({ featured: true, changed: true });
    expect((await feature(pub, true)).body.changed).toBe(false);
    expect((await dir()).body.creators[0].featured).toBe(true);
    expect((await feature(pub, false)).body).toEqual({ featured: false, changed: true });
    expect((await feature(pub, false)).body.changed).toBe(false);
    const audit = await query(`SELECT action, actor_kind, actor_roll, entity_id, detail FROM creator_audit_log ORDER BY id`) as Array<{ action: string; actor_kind: string; actor_roll: string | null; entity_id: string; detail: { featured: boolean } }>;
    expect(audit.map(a => a.action)).toEqual(['profile.feature', 'profile.unfeature']);
    expect(audit[0]).toMatchObject({ actor_kind: 'admin', actor_roll: null, entity_id: pub, detail: { featured: true } });
  });

  it('orders featured creators first, newest-featured first, and caps the set at 12', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) ids.push(await profile(`F${i}`, `featured-${i}`, { name: `Creator ${String(i).padStart(2, '0')}` }));
    for (let i = 0; i < 12; i++) { expect((await feature(ids[i], true)).status).toBe(200); await new Promise(r => setTimeout(r, 4)); }
    const over = await feature(ids[12], true);
    expect(over.status).toBe(409);
    expect(over.body.error).toMatch(/up to 12/);
    const featured = (await dir('/featured')).body.creators.map((c: { handle: string }) => c.handle);
    expect(featured).toHaveLength(12);
    expect(featured[0]).toBe('featured-11');                              // most recently featured first
    expect((await dir('?limit=3')).body.creators.map((c: { handle: string }) => c.handle)).toEqual(['featured-11', 'featured-10', 'featured-9']);
    expect((await feature(ids[0], false)).status).toBe(200);
    expect((await feature(ids[12], true)).status).toBe(200);
    const list = (await request(app).get('/api/creators/admin/list?featured=1').set(adm())).body;
    expect(list).toMatchObject({ available: true, max: 12, featuredCount: 12 });
  });

  it('admin list shows only public creators (with roll for admins) and never non-public ones', async () => {
    await profile('ASHA', 'asha-draws');
    await profile('BALA', 'bala-private', { visibility: 'private' });
    const list = (await request(app).get('/api/creators/admin/list').set(adm())).body;
    expect(list.creators).toHaveLength(1);
    expect(list.creators[0]).toMatchObject({ handle: 'asha-draws', ownerRoll: 'ASHA', featured: false });
    expect((await request(app).get('/api/creators/admin/list?q=bala').set(adm())).body.creators).toHaveLength(0);
  });
});

describe('abuse limits', () => {
  it('rate-limits the public directory', async () => {
    process.env.CREATORS_TEST_LIMITS = '1';
    try {
      let last = 0;
      for (let i = 0; i < 65; i++) last = (await dir('/facets')).status;
      expect(last).toBe(429);
    } finally { delete process.env.CREATORS_TEST_LIMITS; }
  });
});

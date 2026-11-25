import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { initSchema } from '../src/db/schema';
import { signStudentToken, signBypassStudentToken } from '../src/middleware/studentAuth';
import { localRequest } from './localServer';

// DNA 2.0 Phase 1 — privacy & attribution regression suite (spec §9.5).
// Real routes + real Postgres constraints; no mocked authorization decisions.

const app = createApp();
const request = localRequest(app);
const A = '230001';
const B = '230002';
const C = '230003';
const auth = (roll = A) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const admin = () => ({ Authorization: `Bearer ${jwt.sign({ role: 'admin' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}` });

const ART = (n: string) => `cr-${n}`;
const FORBIDDEN_ARTWORK_KEYS = ['created_by_roll', 'createdByRoll', 'source_asset_id', 'sourceAssetId', 'storage_path', 'storagePath', 'status', 'owner_roll'];

async function profile(roll: string, handle: string, visibility: 'private' | 'members' | 'public' = 'public', displayName = handle) {
  const r = await request(app).post('/api/designers/me').set(auth(roll)).send({ handle, displayName });
  expect(r.status).toBe(201);
  if (visibility !== 'private') {
    expect((await request(app).patch('/api/designers/me/visibility').set(auth(roll)).send({ visibility })).status).toBe(200);
  }
  return (await query<{ id: string }>('SELECT id FROM designer_profiles WHERE owner_roll = $1', [roll]))[0].id;
}
async function artwork(id: string, status: 'draft' | 'published' | 'hidden' = 'published', extra: { created_by_roll?: string } = {}) {
  await query(
    `INSERT INTO artworks(id, title, artist, domain, image_url, likes, status, created_by_roll, source_kind)
     VALUES($1, $2, 'Legacy Artist', 'UI/UX Design', 'https://example.test/x.png', 0, $3, $4, $5)`,
    [ART(id), `Work ${id}`, status, extra.created_by_roll ?? null, extra.created_by_roll ? 'asset' : 'gallery_admin']);
  return ART(id);
}
const credit = (art: string, body: object) => request(app).post(`/api/artworks/${art}/credits`).set(admin()).send(body);
const publicList = async (headers: object = {}) => (await request(app).get('/api/artworks').set(headers)).body as Array<Record<string, unknown> & { id: string; credits: Array<Record<string, unknown>> }>;

beforeEach(async () => {
  await query(`DELETE FROM artworks WHERE id LIKE 'cr-%'`);
  await query('DELETE FROM creator_audit_log');
  for (const roll of [A, B, C]) {
    await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
      VALUES($1, $2, '01 Jan 2026', $3, $4)`, [roll, `uid-${roll}`, `Student ${roll}`, `${roll}@iitk.ac.in`]);
  }
});

describe('Gallery privacy foundation: only published artwork is public', () => {
  it('hides drafts and moderator-hidden artwork from lists, detail, likes and comments', async () => {
    await artwork('pub', 'published'); await artwork('draft', 'draft', { created_by_roll: A }); await artwork('hid', 'hidden');
    const ids = (await publicList()).map(a => a.id);
    expect(ids).toContain(ART('pub'));
    expect(ids).not.toContain(ART('draft'));
    expect(ids).not.toContain(ART('hid'));
    expect((await request(app).get(`/api/artworks/${ART('pub')}`)).status).toBe(200);
    for (const id of ['draft', 'hid']) {
      expect((await request(app).get(`/api/artworks/${ART(id)}`)).status).toBe(404);
      expect((await request(app).get(`/api/artworks/${ART(id)}`).set(auth())).status).toBe(404);   // not even the creator
      expect((await request(app).post(`/api/artworks/${ART(id)}/like`).set(auth(B))).status).toBe(404);
      expect((await request(app).post(`/api/artworks/${ART(id)}/comments`).set(auth(B)).send({ text: 'hi' })).status).toBe(404);
    }
  });

  it('keeps comments on non-published artwork out of the public comment feed', async () => {
    await artwork('hid', 'hidden');
    await query(`INSERT INTO artwork_comments(id, artwork_id, sender, text) VALUES('cr-c1', $1, 'X', 'secret draft chatter')`, [ART('hid')]);
    expect(JSON.stringify(await publicList())).not.toContain('secret draft chatter');
  });

  it('never serialises private columns, and the admin list is the only place status appears', async () => {
    await artwork('own', 'published', { created_by_roll: A });
    const pub = (await publicList()).find(a => a.id === ART('own'))!;
    for (const key of FORBIDDEN_ARTWORK_KEYS) expect(pub).not.toHaveProperty(key);
    expect(JSON.stringify(pub)).not.toContain(A);
    expect((await request(app).get('/api/artworks/admin/list').set(auth())).status).toBe(401);
    const listed = (await request(app).get('/api/artworks/admin/list').set(admin())).body as Array<{ id: string; status: string }>;
    expect(listed.find(a => a.id === ART('own'))?.status).toBe('published');
  });

  it('lets an administrator hide and restore artwork, audited, without touching legacy fields', async () => {
    await artwork('pub');
    expect((await request(app).patch(`/api/artworks/${ART('pub')}/status`).set(auth()).send({ status: 'hidden' })).status).toBe(401);
    expect((await request(app).patch(`/api/artworks/${ART('pub')}/status`).set(admin()).send({ status: 'hidden' })).body.changed).toBe(true);
    expect((await publicList()).map(a => a.id)).not.toContain(ART('pub'));
    expect((await request(app).patch(`/api/artworks/${ART('pub')}/status`).set(admin()).send({ status: 'hidden' })).body.changed).toBe(false);
    await request(app).patch(`/api/artworks/${ART('pub')}/status`).set(admin()).send({ status: 'published' });
    expect((await publicList()).find(a => a.id === ART('pub'))).toMatchObject({ artist: 'Legacy Artist', domain: 'UI/UX Design' });
    const audit = await query<{ action: string }>(`SELECT action FROM creator_audit_log WHERE entity_type='artwork' AND entity_id=$1 ORDER BY id`, [ART('pub')]);
    expect(audit.map(a => a.action)).toEqual(['artwork.hide', 'artwork.publish']);
  });

  it('an admin Gallery upload is explicitly published; startup initialisation preserves Gallery data', async () => {
    await artwork('legacy');
    await query(`INSERT INTO artwork_likes(artwork_id, roll_number) VALUES($1, $2)`, [ART('legacy'), A]);
    const before = (await publicList()).find(a => a.id === ART('legacy'));
    await initSchema();
    expect((await publicList()).find(a => a.id === ART('legacy'))).toEqual(before);
    expect((await query(`SELECT artist, status, source_kind FROM artworks WHERE id=$1`, [ART('legacy')]))[0])
      .toEqual({ artist: 'Legacy Artist', status: 'published', source_kind: 'gallery_admin' });
  });

  it('never announces a non-published artwork to the club', async () => {
    await artwork('draft', 'draft');
    expect((await request(app).post(`/api/notify/artwork/${ART('draft')}`).set(admin())).status).toBe(409);
    expect((await request(app).get(`/api/notify/artwork/${ART('draft')}/preview`).set(admin())).status).toBe(409);
  });
});

describe('credits: attribution, order, roles and consent', () => {
  it('shows only ACCEPTED credits publicly; invitations stay private until accepted', async () => {
    const a = await profile(A, 'alice'); const b = await profile(B, 'bob');
    const art = await artwork('team');
    const primary = await credit(art, { profileId: a, role: 'creator', isPrimary: true });
    expect(primary.status).toBe(201);
    const invite = await credit(art, { profileId: b, role: 'contributor', roleLabel: 'Illustration', invite: true });
    expect(invite.body.status).toBe('pending');
    let shown = (await publicList()).find(x => x.id === art)!.credits;
    expect(shown.map(c => c.displayName)).toEqual(['alice']);
    expect(shown[0]).toMatchObject({ isPrimary: true, role: 'creator', handle: 'alice', verified: false });

    // The invited person sees the invitation; nobody else can answer it.
    const mine = await request(app).get('/api/designers/me/credits').set(auth(B));
    expect(mine.body[0]).toMatchObject({ id: invite.body.id, status: 'pending', artworkId: art });
    expect((await request(app).post(`/api/designers/me/credits/${invite.body.id}/respond`).set(auth(C)).send({ accept: true })).status).toBe(404); // no profile
    await profile(C, 'carol');
    expect((await request(app).post(`/api/designers/me/credits/${invite.body.id}/respond`).set(auth(C)).send({ accept: true })).status).toBe(404);
    expect((await request(app).post(`/api/designers/me/credits/${invite.body.id}/respond`).set(auth(A)).send({ accept: true })).status).toBe(404);
    expect((await request(app).post(`/api/designers/me/credits/${invite.body.id}/respond`).set({ Authorization: `Bearer ${signBypassStudentToken(B)}` }).send({ accept: true })).status).toBe(403);

    expect((await request(app).post(`/api/designers/me/credits/${invite.body.id}/respond`).set(auth(B)).send({ accept: true })).body).toMatchObject({ status: 'accepted', changed: true });
    shown = (await publicList()).find(x => x.id === art)!.credits;
    expect(shown.map(c => [c.displayName, c.role, c.roleLabel])).toEqual([['alice', 'creator', null], ['bob', 'contributor', 'Illustration']]);

    // Leaving removes the credit from public view again; accepting a non-pending credit is refused.
    expect((await request(app).post(`/api/designers/me/credits/${invite.body.id}/respond`).set(auth(B)).send({ accept: false })).body.status).toBe('declined');
    expect((await publicList()).find(x => x.id === art)!.credits.map(c => c.displayName)).toEqual(['alice']);
    expect((await request(app).post(`/api/designers/me/credits/${invite.body.id}/respond`).set(auth(B)).send({ accept: true })).status).toBe(409);
    const audit = await query<{ action: string }>(`SELECT action FROM creator_audit_log WHERE entity_type='credit' AND entity_id=$1 ORDER BY id`, [invite.body.id]);
    expect(audit.map(x => x.action)).toEqual(['credit.add', 'credit.accepted', 'credit.declined']);
  });

  it('enforces one primary creator, unique credits, the credit cap and the primary invariants', async () => {
    const a = await profile(A, 'alice'); const b = await profile(B, 'bob');
    const art = await artwork('rules');
    expect((await credit(art, { profileId: a, role: 'creator', isPrimary: true })).status).toBe(201);
    expect((await credit(art, { profileId: b, role: 'creator', isPrimary: true })).status).toBe(409);       // second primary
    expect((await credit(art, { profileId: a, role: 'contributor' })).status).toBe(409);                    // duplicate profile
    expect((await credit(art, { profileId: b, role: 'contributor', isPrimary: true })).status).toBe(400);   // primary must be creator
    expect((await credit(art, { profileId: b, role: 'creator', isPrimary: true, invite: true })).status).toBe(400); // primary cannot be pending
    expect((await credit(art, { profileId: b, role: 'boss' })).status).toBe(400);
    expect((await credit(art, { profileId: b, role: 'contributor', ownerRoll: A })).status).toBe(400);
    expect((await credit(art, { profileId: '00000000-0000-4000-8000-000000000000', role: 'contributor' })).status).toBe(404);
    expect((await request(app).post(`/api/artworks/nope/credits`).set(admin()).send({ profileId: b, role: 'contributor' })).status).toBe(404);
    // The primary cannot abandon the work through the self-service route.
    const primaryId = (await query<{ id: string }>(`SELECT id FROM artwork_credits WHERE artwork_id=$1 AND is_primary`, [art]))[0].id;
    expect((await request(app).post(`/api/designers/me/credits/${primaryId}/respond`).set(auth(A)).send({ accept: false })).status).toBe(409);
    expect((await request(app).patch(`/api/artworks/${art}/credits/${primaryId}`).set(admin()).send({ role: 'contributor' })).status).toBe(409);
  });

  it('caps credits per artwork at 10', async () => {
    const art = await artwork('cap');
    for (let i = 0; i < 10; i++) {
      const roll = `2300${String(40 + i)}`;
      await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES($1,$1,'x','n',$2)`, [roll, `${roll}@iitk.ac.in`]);
      const id = await profile(roll, `person-${i}`);
      expect((await credit(art, { profileId: id, role: 'contributor' })).status).toBe(201);
    }
    const extra = await profile(A, 'one-too-many');
    expect((await credit(art, { profileId: extra, role: 'contributor' })).status).toBe(409);
  });

  it('only an administrator can add, edit or remove credits', async () => {
    const a = await profile(A, 'alice');
    const art = await artwork('auth');
    for (const headers of [{}, auth(A), { Authorization: `Bearer ${signBypassStudentToken(A)}` }]) {
      expect((await request(app).post(`/api/artworks/${art}/credits`).set(headers).send({ profileId: a, role: 'creator' })).status).toBe(401);
    }
    const made = await credit(art, { profileId: a, role: 'creator', isPrimary: true });
    expect((await request(app).delete(`/api/artworks/${art}/credits/${made.body.id}`).set(auth(A))).status).toBe(401);
    expect((await request(app).delete(`/api/artworks/${art}/credits/${made.body.id}`).set(admin())).status).toBe(204);
    expect((await publicList()).find(x => x.id === art)!.credits).toEqual([]);
  });

  it('leaves the legacy artist text untouched and uses it as the fallback when there are no credits', async () => {
    const a = await profile(A, 'alice');
    const art = await artwork('legacy');
    expect((await publicList()).find(x => x.id === art)).toMatchObject({ artist: 'Legacy Artist', credits: [] });
    await credit(art, { profileId: a, role: 'creator', isPrimary: true });
    expect((await publicList()).find(x => x.id === art)).toMatchObject({ artist: 'Legacy Artist' });
    expect((await query('SELECT artist FROM artworks WHERE id=$1', [art]))[0].artist).toBe('Legacy Artist');
  });
});

describe('credit identity follows profile visibility and moderation (spec §9.3)', () => {
  it('links a credit only when the profile is public (members: signed-in only); private shows the name as text', async () => {
    const priv = await profile(A, 'quiet', 'private', 'Quiet Person');
    const mem = await profile(B, 'inner', 'members', 'Members Person');
    const pub = await profile(C, 'loud', 'public', 'Loud Person');
    const art = await artwork('vis');
    await credit(art, { profileId: pub, role: 'creator', isPrimary: true });
    await credit(art, { profileId: mem, role: 'co-creator' });
    await credit(art, { profileId: priv, role: 'contributor' });
    const handles = (headers: object) => publicList(headers).then(l => l.find(x => x.id === art)!.credits.map(c => [c.displayName, c.handle]));
    expect(await handles({})).toEqual([['Loud Person', 'loud'], ['Members Person', null], ['Quiet Person', null]]);
    expect(await handles(auth(A))).toEqual([['Loud Person', 'loud'], ['Members Person', 'inner'], ['Quiet Person', null]]);
  });

  it('removes a moderator-hidden profile from credits entirely and from its works list', async () => {
    const id = await profile(A, 'alice');
    const art = await artwork('mod');
    await credit(art, { profileId: id, role: 'creator', isPrimary: true });
    expect((await request(app).get('/api/designers/alice/works')).body.items.map((i: { id: string }) => i.id)).toEqual([art]);
    await request(app).patch(`/api/designers/admin/${id}`).set(admin()).send({ moderationStatus: 'hidden' });
    expect((await publicList()).find(x => x.id === art)!.credits).toEqual([]);
    expect((await request(app).get('/api/designers/alice/works')).status).toBe(404);
    expect((await request(app).post(`/api/artworks/${art}/credits`).set(admin()).send({ profileId: id, role: 'contributor' })).status).toBe(404);
  });
});

describe('profile works list', () => {
  it('lists only published artwork with an accepted credit, newest first, with stable keyset pagination', async () => {
    const a = await profile(A, 'alice'); const b = await profile(B, 'bob');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const art = await artwork(`w${i}`);
      await query(`UPDATE artworks SET created_at = NOW() - ($2 || ' minutes')::interval WHERE id = $1`, [art, String(i)]);
      await credit(art, { profileId: a, role: 'creator', isPrimary: true });
      ids.push(art);
    }
    const draft = await artwork('d', 'draft'); await credit(draft, { profileId: a, role: 'creator', isPrimary: true });
    const pending = await artwork('p'); await credit(pending, { profileId: a, role: 'contributor', invite: true });
    const others = await artwork('o'); await credit(others, { profileId: b, role: 'creator', isPrimary: true });

    const page1 = (await request(app).get('/api/designers/alice/works?limit=2')).body;
    expect(page1.items.map((i: { id: string }) => i.id)).toEqual(ids.slice(0, 2));
    const page2 = (await request(app).get(`/api/designers/alice/works?limit=2&cursor=${encodeURIComponent(page1.next)}`)).body;
    expect(page2.items.map((i: { id: string }) => i.id)).toEqual(ids.slice(2, 4));
    const page3 = (await request(app).get(`/api/designers/alice/works?limit=2&cursor=${encodeURIComponent(page2.next)}`)).body;
    expect(page3.items.map((i: { id: string }) => i.id)).toEqual(ids.slice(4));
    expect(page3.next).toBeNull();
    expect((await request(app).get('/api/designers/alice/works?cursor=garbage')).status).toBe(400);
    expect((await request(app).get('/api/designers/alice')).body.worksCount).toBe(5);
    expect(JSON.stringify(page1)).not.toMatch(/created_by|source_asset|230001|owner/);
  });
});

describe('security fixes', () => {
  it('derives comment authorship from the session; a spoofed sender is ignored', async () => {
    const art = await artwork('cm');
    const posted = await request(app).post(`/api/artworks/${art}/comments`).set(auth(B)).send({ sender: 'The Dean', text: 'nice' });
    expect(posted.status).toBe(201);
    expect(posted.body.sender).toBe('Student 230002');
    expect((await publicList()).find(x => x.id === art)).toBeDefined();
    const stored = await query<{ sender: string }>('SELECT sender FROM artwork_comments WHERE artwork_id=$1', [art]);
    expect(stored[0].sender).toBe('Student 230002');
    expect((await request(app).post(`/api/artworks/${art}/comments`).set(auth(B)).send({ text: '' })).status).toBe(400);
  });

  it('accepts the scheduler secret in a header only, never in the query string', async () => {
    process.env.INTERNAL_TICK_SECRET = 'synthetic-tick-secret-for-tests';
    expect((await request(app).post('/api/internal/tick?secret=synthetic-tick-secret-for-tests')).status).toBe(401);
    expect((await request(app).post('/api/internal/tick').set('x-tick-secret', 'wrong')).status).toBe(401);
  });

  it('ships no real student identities in the seed data', async () => {
    const rows = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audience_group_members WHERE group_id = 'all_team'`);
    // The group exists, but membership is admin-managed — nothing is seeded from source.
    expect(rows[0].n).toBe(0);
  });
});

describe('roster-gated registration (roll-number claim protection)', () => {
  const register = (rollNumber: string, email: string, name = 'Someone') =>
    request(app).post('/api/auth/student/request-otp').send({ rollNumber, email, name });
  beforeEach(async () => { await query('DELETE FROM student_roster'); });

  it('behaves as before while the roster is empty', async () => {
    expect((await register('240101', 'someone@iitk.ac.in')).status).toBe(200);
  });

  it('once loaded, refuses unknown rolls and mismatched emails, and takes the name from the roster', async () => {
    expect((await request(app).put('/api/students/roster').set(auth()).send({ entries: [] })).status).toBe(401);
    const put = await request(app).put('/api/students/roster').set(admin()).send({ entries: [
      { rollNumber: '240102', name: 'Real Student', email: 'real@iitk.ac.in' }, { rollNumber: '240103', name: 'No Email Listed' },
    ] });
    expect(put.body).toEqual({ upserted: 2, total: 2 });
    expect((await register('240199', 'attacker@iitk.ac.in')).status).toBe(403);          // not on roster
    const stolen = await register('240102', 'attacker@iitk.ac.in');                      // someone else's roll
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toMatch(/roster/);
    expect((await register('240102', 'REAL@iitk.ac.in', 'Fake Name')).status).toBe(200); // matches (case-insensitive)
    expect((await query('SELECT name FROM student_otps WHERE roll_number=$1', ['240102']))[0].name).toBe('Real Student');
    expect((await register('240103', 'anyone@iitk.ac.in')).status).toBe(200);            // roster row without an email
  });

  it('does not lock out accounts that already exist, and audits accounts that disagree with the roster', async () => {
    await query(`INSERT INTO student_roster(roll_number, name, email) VALUES('230001','Student 230001','other@iitk.ac.in')`);
    const audit = await request(app).get('/api/students/roster/audit').set(admin());
    expect(audit.status).toBe(200);
    expect(audit.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ rollNumber: '230001', problem: 'email_differs' }),
      expect.objectContaining({ rollNumber: '230002', problem: 'not_in_roster' }),
    ]));
    expect((await request(app).get('/api/students/roster/audit').set(auth())).status).toBe(401);
  });
});

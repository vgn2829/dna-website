import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken, signBypassStudentToken, verifyStudentToken } from '../src/middleware/studentAuth';
import { localRequest } from './localServer';

const app = createApp();
const request = localRequest(app);
const OWNER = '230001';
const OTHER = '230002';
const auth = (roll = OWNER) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const signed = (claims: object, options: jwt.SignOptions = {}) => jwt.sign(claims, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1h', ...options });
const admin = () => ({ Authorization: `Bearer ${signed({ role: 'admin' })}` });
const profileInput = (handle = 'ada-design') => ({ handle, displayName: 'Ada', bio: 'Design student' });
const create = (roll = OWNER, handle = 'ada-design', extra: object = {}) =>
  request(app).post('/api/designers/me').set(auth(roll)).send({ ...profileInput(handle), ...extra });

// Everything a stranger may ever see on a profile, and nothing else.
const PUBLIC_KEYS = ['avatarUrl', 'batch', 'bio', 'coverUrl', 'department', 'disciplines', 'displayName', 'handle',
  'headline', 'links', 'skills', 'tools', 'verified', 'worksCount'];
const FORBIDDEN = /230001|230002|@iitk|private-|owner_roll|ownerRoll|unique_id|otp|bypass|identityVerified|moderation|visibility|"id"/;

beforeEach(async () => {
  await query('DELETE FROM creator_audit_log');
  for (const roll of [OWNER, OTHER]) {
    await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
      VALUES($1, $2, '01 Jan 2026', 'Private account name', $3)`, [roll, `private-${roll}`, `${roll}@iitk.ac.in`]);
  }
});

describe('owner-controlled designer identity', () => {
  it('returns null before creation, then creates private-by-default, reads and updates a profile', async () => {
    expect((await request(app).get('/api/designers/me').set(auth())).body).toBeNull();
    const created = await request(app).post('/api/designers/me').set(auth())
      .send({ ...profileInput('  ADA-Design  '), displayName: '  Ada   L  ', headline: 'UI/UX · Motion', department: 'Design' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ handle: 'ada-design', displayName: 'Ada L', visibility: 'private', moderationStatus: 'active', verified: false, worksCount: 0 });
    expect((await request(app).get('/api/designers/me').set(auth())).body).toEqual(created.body);
    const changed = await request(app).patch('/api/designers/me').set(auth()).send({ displayName: 'Ada Designer', bio: null });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ handle: 'ada-design', displayName: 'Ada Designer', bio: null, visibility: 'private' });
  });

  it('keeps a new profile invisible to everyone else until its owner explicitly publishes it', async () => {
    await create();
    for (const headers of [{}, auth(OTHER), admin()]) {
      const r = await request(app).get('/api/designers/ada-design').set(headers);
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Designer profile not found' });
    }
    expect((await request(app).get('/api/designers/does-not-exist')).body).toEqual({ error: 'Designer profile not found' });
  });

  it('applies the visibility matrix: private / members / public and owner always', async () => {
    await create();
    const get = (headers: object = {}) => request(app).get('/api/designers/ada-design').set(headers);
    expect((await get(auth())).status).toBe(200);                       // owner sees own private profile
    expect((await get()).status).toBe(404);
    expect((await get(auth(OTHER))).status).toBe(404);
    await request(app).patch('/api/designers/me/visibility').set(auth()).send({ visibility: 'members' });
    expect((await get()).status).toBe(404);                            // anonymous cannot see members-only
    expect((await get(auth(OTHER))).status).toBe(200);
    await request(app).patch('/api/designers/me/visibility').set(auth()).send({ visibility: 'public' });
    const pub = await get();
    expect(pub.status).toBe(200);
    expect(Object.keys(pub.body).sort()).toEqual(PUBLIC_KEYS);
    expect(JSON.stringify(pub.body)).not.toMatch(FORBIDDEN);
    await request(app).patch('/api/designers/me/visibility').set(auth()).send({ visibility: 'private' });
    expect((await get()).status).toBe(404);
  });

  it('lets an administrator hide a profile from everyone but not re-publish it, audited', async () => {
    const created = await create();
    await request(app).patch('/api/designers/me/visibility').set(auth()).send({ visibility: 'public' });
    const id = (await query<{ id: string }>('SELECT id FROM designer_profiles WHERE owner_roll = $1', [OWNER]))[0].id;
    expect((await request(app).patch(`/api/designers/admin/${id}`).set(auth()).send({ moderationStatus: 'hidden' })).status).toBe(401);
    const hide = await request(app).patch(`/api/designers/admin/${id}`).set(admin()).send({ moderationStatus: 'hidden' });
    expect(hide.status).toBe(200);
    expect((await request(app).get('/api/designers/ada-design')).status).toBe(404);
    expect((await request(app).patch('/api/designers/me/visibility').set(auth()).send({ visibility: 'public' })).status).toBe(403);
    expect((await request(app).get('/api/designers/me').set(auth())).body.moderationStatus).toBe('hidden');
    await request(app).patch(`/api/designers/admin/${id}`).set(admin()).send({ moderationStatus: 'active', verified: true });
    expect((await request(app).get('/api/designers/ada-design')).body.verified).toBe(true);
    const audit = await query<{ action: string }>('SELECT action FROM creator_audit_log WHERE entity_id = $1 ORDER BY id', [id]);
    expect(audit.map(a => a.action)).toEqual(['profile.hide', 'profile.restore', 'profile.verify']);
    expect(created.status).toBe(201);
  });

  it('rejects unauthenticated, forged, expired and non-student tokens', async () => {
    for (const method of ['get', 'post', 'patch'] as const) {
      expect((await request(app)[method]('/api/designers/me').send(profileInput())).status).toBe(401);
    }
    const invalid = [
      jwt.sign({ typ: 'student', roll: OWNER, identityVerified: true }, 'synthetic-wrong-test-key'),
      signed({ typ: 'student', roll: OWNER, identityVerified: true }, { expiresIn: -1 }),
      signed({ role: 'admin', identityVerified: true }),
      signed({ typ: 'public_meet', identityVerified: true }),
    ];
    for (const token of invalid) {
      expect((await request(app).post('/api/designers/me').set('Authorization', `Bearer ${token}`).send(profileInput())).status).toBe(401);
    }
  });

  it('requires an explicit verified claim on every write; bypass/legacy sessions can only read', async () => {
    await create();
    const tokens = [
      signBypassStudentToken(OWNER),
      signed({ typ: 'student', roll: OWNER }),
      signed({ typ: 'student', roll: OWNER, bypass: false }),
      signed({ typ: 'student', roll: OWNER, identityVerified: 'true' }),
      signed({ typ: 'student', roll: OWNER, identityVerified: true, bypass: true }),
    ];
    const writes: [string, string, object][] = [
      ['post', '/api/designers/me', profileInput()], ['patch', '/api/designers/me', { bio: 'x' }],
      ['put', '/api/designers/me/links', { links: [] }], ['put', '/api/designers/me/skills', { skills: [] }],
      ['put', '/api/designers/me/disciplines', { domainIds: [] }], ['patch', '/api/designers/me/visibility', { visibility: 'public' }],
    ];
    for (const token of tokens) {
      expect(verifyStudentToken(token)).toBe(OWNER);
      expect((await request(app).get('/api/designers/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      for (const [method, url, body] of writes) {
        const call = request(app);
        const pending = method === 'post' ? call.post(url) : method === 'put' ? call.put(url) : call.patch(url);
        expect((await pending.set('Authorization', `Bearer ${token}`).send(body)).status).toBe(403);
      }
    }
  });

  it('derives ownership from the signature, rejecting owner/verification/moderation fields', async () => {
    await create();
    for (const extra of [{ ownerRoll: OWNER }, { owner_roll: OWNER }, { id: 'x' }, { verified: true }, { verifiedAt: 'now' }, { moderationStatus: 'active' }, { visibility: 'public' }, { bypass: false }]) {
      expect((await request(app).post('/api/designers/me').set(auth(OTHER)).send({ ...profileInput('other-design'), ...extra })).status).toBe(400);
      expect((await request(app).patch('/api/designers/me').set(auth(OTHER)).send({ displayName: 'Changed', ...extra })).status).toBe(400);
    }
    expect((await request(app).patch('/api/designers/me').set(auth(OTHER)).send({ displayName: 'Changed' })).status).toBe(404);
    await create(OTHER, 'other-design');
    await request(app).patch(`/api/designers/me?ownerRoll=${OWNER}`).set(auth(OTHER)).send({ displayName: 'Other changed' });
    expect((await request(app).get('/api/designers/me').set(auth())).body.displayName).toBe('Ada');
    expect((await query('SELECT owner_roll FROM designer_profiles WHERE handle = $1', ['ada-design']))[0].owner_roll).toBe(OWNER);
  });

  it('enforces one owner and normalised unique handles, including concurrent claims', async () => {
    expect((await Promise.all([create(), create(OWNER, 'different-handle')])).map(r => r.status).sort()).toEqual([201, 409]);
    const mine = await request(app).get('/api/designers/me').set(auth());
    expect((await create(OTHER, mine.body.handle.toUpperCase())).status).toBe(409);
    await create(OTHER, 'other-design');
    expect((await request(app).patch('/api/designers/me').set(auth(OTHER)).send({ handle: mine.body.handle })).status).toBe(409);
    expect((await query('SELECT count(*)::int AS count FROM designer_profiles WHERE owner_roll = $1', [OWNER]))[0].count).toBe(1);
    await query('DELETE FROM designer_profiles');
    expect((await Promise.all([create(OWNER, 'same-handle'), create(OTHER, 'SAME-HANDLE')])).map(r => r.status).sort()).toEqual([201, 409]);
  });

  it('validates handle, reserved words, field types and lengths; a missing account cannot create a profile', async () => {
    for (const body of [
      profileInput('ab'), profileInput('a'.repeat(31)), profileInput('bad_handle'), profileInput('-bad'), profileInput('bad-'),
      profileInput('bad--handle'), profileInput('admin'), profileInput('api'), profileInput('designers'), profileInput('me'),
      { ...profileInput(), displayName: ' ' }, { ...profileInput(), displayName: 'a'.repeat(101) },
      { ...profileInput(), displayName: 'zero​width' }, { ...profileInput(), displayName: 'rtl‮override' },
      { ...profileInput(), bio: 'a'.repeat(501) }, { ...profileInput(), bio: 5 }, { ...profileInput(), headline: 'h'.repeat(81) },
    ]) expect((await request(app).post('/api/designers/me').set(auth()).send(body)).status).toBe(400);
    expect((await request(app).patch('/api/designers/me').set(auth()).send({})).status).toBe(400);
    expect((await create('239999', 'no-account')).status).toBe(403);
  });

  it('reports handle availability and throttles renames to once per 30 days', async () => {
    await create();
    await create(OTHER, 'taken-name');
    const check = (h: string) => request(app).get(`/api/designers/handle-available?handle=${h}`).set(auth());
    expect((await check('fresh-name')).body).toEqual({ available: true });
    expect((await check('taken-name')).body).toEqual({ available: false, reason: 'taken' });
    expect((await check('admin')).body).toEqual({ available: false, reason: 'reserved' });
    expect((await check('x')).body).toEqual({ available: false, reason: 'invalid' });
    expect((await check('ada-design')).body).toEqual({ available: true }); // your own handle
    expect((await request(app).patch('/api/designers/me').set(auth()).send({ handle: 'ada-renamed' })).status).toBe(200);
    const again = await request(app).patch('/api/designers/me').set(auth()).send({ handle: 'ada-again' });
    expect(again.status).toBe(429);
    expect(again.body.handleChangeableAt).toBeTruthy();
    expect((await request(app).patch('/api/designers/me').set(auth()).send({ bio: 'edits still fine' })).status).toBe(200);
  });

  it('refuses a display name that belongs to a verified member', async () => {
    await create(OWNER, 'real-ada', { displayName: 'Ada Lovelace' });
    await query(`UPDATE designer_profiles SET verified_at = NOW() WHERE owner_roll = $1`, [OWNER]);
    expect((await create(OTHER, 'fake-ada', { displayName: 'ada lovelace' })).status).toBe(409);
    expect((await create(OTHER, 'fake-ada', { displayName: 'Ada Lovelace II' })).status).toBe(201);
    expect((await request(app).patch('/api/designers/me').set(auth(OTHER)).send({ displayName: 'ADA LOVELACE' })).status).toBe(409);
  });

  it('validates and stores links, skills and disciplines with explicit limits', async () => {
    await create();
    const put = (path: string, body: object) => request(app).put(`/api/designers/me/${path}`).set(auth()).send(body);
    const ok = await put('links', { links: [{ kind: 'behance', url: 'https://www.behance.net/ada' }, { kind: 'website', url: 'https://ada.example.com/' }] });
    expect(ok.status).toBe(200);
    for (const bad of [
      { kind: 'website', url: 'http://ada.example.com' }, { kind: 'website', url: 'javascript:alert(1)' },
      { kind: 'website', url: 'https://user:pw@ada.example.com' }, { kind: 'website', url: 'https://localhost/x' },
      { kind: 'website', url: 'https://127.0.0.1/x' }, { kind: 'instagram', url: 'https://evil.example.com/ada' },
      { kind: 'github', url: 'https://notgithub.com/ada' }, { kind: 'mailto', url: 'mailto:a@b.c' },
    ]) expect((await put('links', { links: [bad] })).status).toBe(400);
    expect((await put('links', { links: Array.from({ length: 7 }, (_, i) => ({ kind: 'website', url: `https://a${i}.example.com` })) })).status).toBe(400);

    expect((await put('skills', { skills: ['  Figma ', 'figma', 'Motion Design', 'C++'] })).body).toEqual({ skills: ['figma', 'motion design', 'c++'] });
    expect((await put('skills', { skills: Array.from({ length: 13 }, (_, i) => `skill${i}`) })).status).toBe(400);
    expect((await put('skills', { skills: ['<script>'] })).status).toBe(400);

    await query(`INSERT INTO domains(id, title, full_name) VALUES('d-ui','UI/UX','UI/UX Design'),('d-3d','3D','3D Animation'),('d-ps','PS','Photoshop'),('d-ai','AI','Illustrator') ON CONFLICT DO NOTHING`);
    expect((await put('disciplines', { domainIds: ['d-ui', 'd-3d'] })).status).toBe(200);
    expect((await put('disciplines', { domainIds: ['d-ui', 'd-3d', 'd-ps', 'd-ai'] })).status).toBe(400);
    expect((await put('disciplines', { domainIds: ['nope'] })).status).toBe(400);
    const me = (await request(app).get('/api/designers/me').set(auth())).body;
    expect(me.links).toEqual([{ kind: 'behance', url: 'https://www.behance.net/ada' }, { kind: 'website', url: 'https://ada.example.com/' }]);
    expect(me.disciplines.map((d: { id: string }) => d.id).sort()).toEqual(['d-3d', 'd-ui']);
    expect(me.skills).toEqual(['figma', 'motion design', 'c++']);
  });

  it('derives batch from the roll only when the owner opts in, and never exposes the roll', async () => {
    await create(OWNER, 'ada-design', { showBatch: true });
    await request(app).patch('/api/designers/me/visibility').set(auth()).send({ visibility: 'public' });
    const body = (await request(app).get('/api/designers/ada-design')).body;
    expect(body.batch).toBe('Y23');
    expect(JSON.stringify(body)).not.toMatch(/230001/);
    await request(app).patch('/api/designers/me').set(auth()).send({ showBatch: false });
    expect((await request(app).get('/api/designers/ada-design')).body.batch).toBeNull();
  });

  it('previews exactly the public projection', async () => {
    await create();
    const preview = await request(app).get('/api/designers/me/preview').set(auth());
    expect(preview.status).toBe(200);
    expect(Object.keys(preview.body).sort()).toEqual([...PUBLIC_KEYS, 'visibleToPublic'].sort());
    expect(preview.body.visibleToPublic).toBe(false);
  });

  it('issues verified identity only from real OTP success, and denies a real bypass-login session', async () => {
    const codeHash = await bcrypt.hash('123456', 10);
    await query(`INSERT INTO student_otps(roll_number, email, code_hash, name, expires_at)
      VALUES($1, 'synthetic@iitk.ac.in', $2, 'Ada', NOW() + INTERVAL '10 minutes')`, [OWNER, codeHash]);
    const otp = await request(app).post('/api/auth/student/verify-otp').send({ rollNumber: OWNER, code: '123456' });
    expect(otp.status).toBe(200);
    expect((await request(app).post('/api/designers/me').set('Authorization', `Bearer ${otp.body.token}`).send(profileInput())).status).toBe(201);
    await query(`UPDATE app_settings SET value = 'true' WHERE key = 'student_otp_bypass_enabled'`);
    try {
      const bypass = await request(app).post('/api/auth/student/bypass-login').send({ rollNumber: OWNER });
      expect(bypass.status).toBe(200);
      expect((await request(app).patch('/api/designers/me').set('Authorization', `Bearer ${bypass.body.token}`).send({ displayName: 'Impostor' })).status).toBe(403);
      expect((await request(app).patch('/api/designers/me').set('Authorization', `Bearer ${otp.body.token}`).send({ bio: 'Still verified' })).status).toBe(200);
    } finally {
      await query(`UPDATE app_settings SET value = 'false' WHERE key = 'student_otp_bypass_enabled'`);
    }
  });
});

describe('abuse limits', () => {
  it('rate-limits handle probing (limiters are skipped in tests unless explicitly enabled)', async () => {
    process.env.RATE_LIMIT_IN_TESTS = '1';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 32; i++) {
        statuses.push((await request(app).get(`/api/designers/handle-available?handle=probe-${i}`).set(auth())).status);
      }
      expect(statuses.slice(0, 30).every(s => s === 200)).toBe(true);
      expect(statuses.slice(30)).toEqual([429, 429]);
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });
});

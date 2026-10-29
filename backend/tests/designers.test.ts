import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { initSchema } from '../src/db/schema';
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
const create = (roll = OWNER, handle = 'ada-design') => request(app).post('/api/designers/me').set(auth(roll)).send(profileInput(handle));
const ART = 'designer-pr1-art';

beforeEach(async () => {
  await query('DELETE FROM artwork_attribution_audit WHERE artwork_id = $1', [ART]);
  await query('DELETE FROM artworks WHERE id = $1', [ART]);
  for (const roll of [OWNER, OTHER]) {
    await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
      VALUES($1, $2, '01 Jan 2026', 'Private account name', $3)`, [roll, `private-${roll}`, `${roll}@iitk.ac.in`]);
  }
});

function expectPublicProfile(body: Record<string, unknown>) {
  expect(Object.keys(body).sort()).toEqual(['bio', 'createdAt', 'displayName', 'handle', 'id', 'updatedAt']);
  expect(JSON.stringify(body)).not.toMatch(/230001|230002|@iitk|private-|owner_roll|unique_id|otp|bypass|identityVerified/);
}

async function seedArtwork() {
  await query(`INSERT INTO artworks(id, title, artist, domain, image_url, likes, featured)
    VALUES($1, 'Existing work', 'Ada', 'UI/UX Design', 'https://example.test/legacy.png', 1, true)`, [ART]);
  await query('INSERT INTO artwork_likes(artwork_id, roll_number) VALUES($1, $2)', [ART, OWNER]);
  await query(`INSERT INTO artwork_comments(id, artwork_id, sender, text) VALUES($1, $2, 'Legacy sender', 'Existing comment')`, [`${ART}-comment`, ART]);
}
const attribute = (id: string | null) => request(app).patch(`/api/artworks/${ART}/attribution`).set(admin()).send({ creatorDesignerId: id });

// Real routes + real Postgres constraints, no mocked ownership decisions.
describe('owner-controlled designer identity', () => {
  it('returns null before creation, then creates, reads, updates and looks up a public-safe profile', async () => {
    expect((await request(app).get('/api/designers/me').set(auth())).body).toBeNull();
    const created = await request(app).post('/api/designers/me').set(auth()).send({ ...profileInput('  ADA-Design  '), displayName: '  Ada  ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ handle: 'ada-design', displayName: 'Ada' });
    expectPublicProfile(created.body);
    expect((await request(app).get('/api/designers/me').set(auth())).body).toEqual(created.body);
    const changed = await request(app).patch('/api/designers/me').set(auth()).send({ displayName: 'Ada Designer', bio: null });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ id: created.body.id, handle: 'ada-design', displayName: 'Ada Designer', bio: null });
    expectPublicProfile(changed.body);
    const publicRead = await request(app).get('/api/designers/ADA-DESIGN');
    expect(publicRead.status).toBe(200);
    expect(publicRead.body).toEqual(changed.body);
    expect((await request(app).get('/api/designers/unknown-designer')).status).toBe(404);
  });

  it('rejects unauthenticated, forged, expired and non-student tokens', async () => {
    for (const method of ['get', 'post', 'patch'] as const) {
      const req = request(app)[method]('/api/designers/me');
      expect((await req.send(profileInput())).status).toBe(401);
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

  it('requires an explicit verified claim; bypass/legacy sessions retain reads but cannot write', async () => {
    await create();
    const tokens = [
      signBypassStudentToken(OWNER),
      signed({ typ: 'student', roll: OWNER }),
      signed({ typ: 'student', roll: OWNER, bypass: false }),
      signed({ typ: 'student', roll: OWNER, identityVerified: 'true' }),
      signed({ typ: 'student', roll: OWNER, identityVerified: true, bypass: true }),
    ];
    for (const token of tokens) {
      expect(verifyStudentToken(token)).toBe(OWNER);
      expect((await request(app).get('/api/designers/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
      for (const method of ['post', 'patch'] as const) {
        expect((await request(app)[method]('/api/designers/me?verified=true&bypass=false')
          .set('Authorization', `Bearer ${token}`).send(profileInput())).status).toBe(403);
      }
    }
  });

  it('derives ownership from the signature, rejecting owner/verification/attribution fields', async () => {
    const ownerProfile = await create();
    for (const extra of [{ ownerRoll: OWNER }, { owner_roll: OWNER }, { accountId: OWNER }, { verified: true }, { bypass: false }, { creatorDesignerId: ownerProfile.body.id }]) {
      expect((await request(app).post('/api/designers/me').set(auth(OTHER)).send({ ...profileInput('other-design'), ...extra })).status).toBe(400);
      expect((await request(app).patch('/api/designers/me').set(auth(OTHER)).send({ displayName: 'Changed', ...extra })).status).toBe(400);
    }
    expect((await request(app).patch(`/api/designers/${ownerProfile.body.id}`).set(auth(OTHER)).send({ displayName: 'Stolen' })).status).toBe(404);
    expect((await request(app).patch('/api/designers/me').set(auth(OTHER)).send({ displayName: 'Changed' })).status).toBe(404);
    await create(OTHER, 'other-design');
    await request(app).patch(`/api/designers/me?ownerRoll=${OWNER}`).set(auth(OTHER)).send({ displayName: 'Other changed' });
    expect((await request(app).get('/api/designers/me').set(auth())).body.displayName).toBe('Ada');
    const rows = await query('SELECT owner_roll FROM designer_profiles WHERE id = $1', [ownerProfile.body.id]);
    expect(rows[0].owner_roll).toBe(OWNER);
  });

  it('enforces one owner and normalized unique handles, including concurrent creates and conflicting updates', async () => {
    const sameOwner = await Promise.all([create(), create(OWNER, 'different-handle')]);
    expect(sameOwner.map(r => r.status).sort()).toEqual([201, 409]);
    const mine = await request(app).get('/api/designers/me').set(auth());
    expect((await create(OTHER, mine.body.handle.toUpperCase())).status).toBe(409);
    await create(OTHER, 'other-design');
    expect((await request(app).patch('/api/designers/me').set(auth(OTHER)).send({ handle: mine.body.handle })).status).toBe(409);
    expect((await query('SELECT count(*)::int AS count FROM designer_profiles WHERE owner_roll = $1', [OWNER]))[0].count).toBe(1);
  });

  it('handles simultaneous handle claims by different accounts with exactly one winner', async () => {
    const results = await Promise.all([create(OWNER, 'same-handle'), create(OTHER, 'SAME-HANDLE')]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  });

  it('validates handle, field types and lengths; missing account cannot create a profile', async () => {
    for (const body of [
      profileInput('ab'), profileInput('a'.repeat(31)), profileInput('bad_handle'), profileInput('-bad'), profileInput('bad-'),
      profileInput('bad--handle'), { ...profileInput(), displayName: ' ' }, { ...profileInput(), displayName: 'a'.repeat(101) },
      { ...profileInput(), bio: 'a'.repeat(501) }, { ...profileInput(), bio: 5 },
    ]) expect((await request(app).post('/api/designers/me').set(auth()).send(body)).status).toBe(400);
    expect((await request(app).patch('/api/designers/me').set(auth()).send({})).status).toBe(400);
    expect((await create('239999', 'no-account')).status).toBe(403);
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
      // Another bypass login changes the account audit flag, not the trust of
      // a previously OTP-verified session (verification is session-specific).
      expect((await request(app).patch('/api/designers/me').set('Authorization', `Bearer ${otp.body.token}`).send({ bio: 'Still verified' })).status).toBe(200);
    } finally {
      await query(`UPDATE app_settings SET value = 'false' WHERE key = 'student_otp_bypass_enabled'`);
    }
  });
});

describe('administrator-verified Gallery attribution', () => {
  it('sets, repeats and clears attribution atomically without altering legacy Gallery fields', async () => {
    const profile = await create();
    await seedArtwork();
    const before = (await request(app).get('/api/artworks').set(auth())).body.find((a: { id: string }) => a.id === ART);
    expect(before.creatorDesignerId).toBeNull();
    expect((await attribute(profile.body.id)).body).toEqual({ artworkId: ART, creatorDesignerId: profile.body.id, changed: true });
    expect((await attribute(profile.body.id)).body.changed).toBe(false);
    const attributed = (await request(app).get('/api/artworks').set(auth())).body.find((a: { id: string }) => a.id === ART);
    expect(attributed).toEqual({ ...before, creatorDesignerId: profile.body.id });
    expect((await attribute(null)).body.changed).toBe(true);
    const audit = await query('SELECT * FROM artwork_attribution_audit WHERE artwork_id = $1 ORDER BY id', [ART]);
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ previous_designer_id: null, new_designer_id: profile.body.id, actor: 'admin' });
    expect(audit[1]).toMatchObject({ previous_designer_id: profile.body.id, new_designer_id: null, actor: 'admin' });
    expect(audit[0].created_at).toBeInstanceOf(Date);
    expect((await request(app).get('/api/artworks').set(auth())).body.find((a: { id: string }) => a.id === ART)).toEqual(before);
    // The ordinary edit flow ignores creator fields; it still accepts legacy
    // metadata. Neither matching artist labels nor editing them claims work.
    const edit = await request(app).put(`/api/artworks/${ART}`).set(admin()).field('title', 'Existing work').field('creatorDesignerId', profile.body.id);
    expect(edit.status).toBe(200);
    expect(edit.body.creatorDesignerId).toBeNull();
    expect((await request(app).post(`/api/artworks/${ART}/like`).set(auth(OTHER))).status).toBe(200);
    expect((await request(app).post(`/api/artworks/${ART}/comments`).set(auth(OTHER)).send({ sender: 'Other', text: 'More discussion' })).status).toBe(201);
  });

  it('rejects unauthenticated, student and bypass attribution; validates IDs and request shape', async () => {
    const profile = await create();
    await seedArtwork();
    for (const token of [null, signStudentToken(OWNER), signBypassStudentToken(OWNER)]) {
      for (const id of [profile.body.id, null]) {
        const req = request(app).patch(`/api/artworks/${ART}/attribution`);
        if (token) req.set('Authorization', `Bearer ${token}`);
        expect((await req.send({ creatorDesignerId: id })).status).toBe(401);
      }
    }
    expect((await attribute('not-a-uuid')).status).toBe(400);
    expect((await attribute('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await request(app).patch('/api/artworks/no-artwork/attribution').set(admin()).send({ creatorDesignerId: null })).status).toBe(404);
    for (const body of [{}, { creatorDesignerId: null, actor: 'someone' }, { creatorDesignerId: null, verified: true }]) {
      expect((await request(app).patch(`/api/artworks/${ART}/attribution`).set(admin()).send(body)).status).toBe(400);
    }
    expect(await query('SELECT * FROM artwork_attribution_audit WHERE artwork_id = $1', [ART])).toHaveLength(0);
  });

  it('serializes competing admin changes into an accurate transition chain', async () => {
    const first = await create();
    const second = await create(OTHER, 'other-design');
    await seedArtwork();
    const responses = await Promise.all([attribute(first.body.id), attribute(second.body.id)]);
    expect(responses.every(r => r.status === 200)).toBe(true);
    const audit = await query('SELECT * FROM artwork_attribution_audit WHERE artwork_id = $1 ORDER BY id', [ART]);
    expect(audit).toHaveLength(2);
    expect(audit[0].previous_designer_id).toBeNull();
    expect(audit[1].previous_designer_id).toBe(audit[0].new_designer_id);
    expect((await query('SELECT creator_designer_id FROM artworks WHERE id = $1', [ART]))[0].creator_designer_id).toBe(audit[1].new_designer_id);
  });

  it('rolls back the attribution if writing its audit fails', async () => {
    const profile = await create();
    await seedArtwork();
    // Test-only DB trigger, removed even on failure. This exercises the actual
    // transaction, not an injected fake pretending that persistence failed.
    await query(`CREATE FUNCTION pr1_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
    await query(`CREATE TRIGGER pr1_reject_audit BEFORE INSERT ON artwork_attribution_audit FOR EACH ROW EXECUTE FUNCTION pr1_reject_audit()`);
    try {
      expect((await attribute(profile.body.id)).status).toBe(500);
      expect((await query('SELECT creator_designer_id FROM artworks WHERE id = $1', [ART]))[0].creator_designer_id).toBeNull();
      expect(await query('SELECT * FROM artwork_attribution_audit WHERE artwork_id = $1', [ART])).toHaveLength(0);
    } finally {
      await query('DROP TRIGGER pr1_reject_audit ON artwork_attribution_audit');
      await query('DROP FUNCTION pr1_reject_audit()');
    }
  });

  it('a Gallery save to Moodboards grants no authorship; startup initialization preserves Gallery data', async () => {
    await create(); // matching display name = Ada, deliberately not ownership
    await seedArtwork();
    const board = await request(app).post('/api/boards').set(auth()).send({ name: 'References' });
    expect(board.status).toBe(201);
    expect((await request(app).post(`/api/boards/${board.body.id}/items`).set(auth()).send({ image_url: 'https://example.test/legacy.png', note: 'Existing work' })).status).toBe(201);
    const before = (await request(app).get('/api/artworks')).body.find((a: { id: string }) => a.id === ART);
    await initSchema();
    const after = (await request(app).get('/api/artworks')).body.find((a: { id: string }) => a.id === ART);
    expect(after).toEqual(before);
    expect(after.creatorDesignerId).toBeNull();
    expect(after).toMatchObject({ id: ART, artist: 'Ada', likes: 1, mediaUrl: 'https://example.test/legacy.png', featured: true });
    expect(after.comments).toHaveLength(1);
  });
});

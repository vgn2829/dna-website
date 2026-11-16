import { beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { localRequest } from './localServer';

// DNA 2.0 V1 — Gallery attribution: accepted credits replace the legacy text,
// legacy text is kept where nothing structured exists, and a withdrawn credit
// leaves every public view immediately (including the legacy text an admin
// attributed to that student).

const app = createApp();
const request = localRequest(app);
const A = '230101';
const B = '230102';
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const admin = () => ({ Authorization: `Bearer ${jwt.sign({ role: 'admin' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}` });

async function profile(roll: string, handle: string) {
  expect((await request(app).post('/api/designers/me').set(auth(roll)).send({ handle, displayName: `Name ${handle}` })).status).toBe(201);
  expect((await request(app).patch('/api/designers/me/visibility').set(auth(roll)).send({ visibility: 'public' })).status).toBe(200);
  return (await query<{ id: string }>('SELECT id FROM designer_profiles WHERE owner_roll = $1', [roll]))[0].id;
}
async function artwork(id: string, artist: string) {
  await query(`INSERT INTO artworks(id, title, artist, domain, image_url, likes) VALUES($1,$2,$3,'UI/UX Design','https://example.test/x.png',0)`, [id, `Work ${id}`, artist]);
}
const list = async () => (await request(app).get('/api/artworks')).body as Array<{ id: string; artist: string; credits: Array<{ displayName: string; handle: string | null }> }>;
const one = async (id: string) => (await request(app).get('/api/artworks/' + id)).body as { artist: string; credits: unknown[] };

beforeEach(async () => {
  await query(`DELETE FROM artworks WHERE id LIKE 'ga-%'`);
  for (const roll of [A, B]) {
    await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES($1,$2,'01 Jan 2026',$3,$4)`,
      [roll, `uid-${roll}`, `Student ${roll}`, `${roll}@iitk.ac.in`]);
  }
});

describe('Gallery attribution', () => {
  it('keeps the legacy artist text where no structured credit exists', async () => {
    await artwork('ga-legacy', 'Old School Artist');
    const row = (await list()).find(a => a.id === 'ga-legacy')!;
    expect(row.credits).toEqual([]);
    expect(row.artist).toBe('Old School Artist');
  });

  it('shows accepted credits with a link to a public profile, and never pending ones', async () => {
    const a = await profile(A, 'amy-art');
    const b = await profile(B, 'bo-art');
    await artwork('ga-credited', 'Amy and Bo');
    await request(app).post('/api/artworks/ga-credited/credits').set(admin()).send({ profileId: a, role: 'creator', isPrimary: true });
    await request(app).post('/api/artworks/ga-credited/credits').set(admin()).send({ profileId: b, role: 'contributor', invite: true });
    const row = (await list()).find(x => x.id === 'ga-credited')!;
    expect(row.credits.map(c => c.handle)).toEqual(['amy-art']);          // pending invite is not public
    expect(JSON.stringify(row)).not.toContain(A);                          // no roll numbers
    expect(JSON.stringify(row)).not.toContain('@iitk.ac.in');
  });

  it('removes a withdrawn credit — and the legacy text attributed to that student — from every public view at once', async () => {
    const a = await profile(A, 'amy-art');
    await artwork('ga-withdraw', 'Amy Student');
    const added = await request(app).post('/api/artworks/ga-withdraw/credits').set(admin()).send({ profileId: a, role: 'creator' });
    expect(added.status).toBe(201);
    expect((await one('ga-withdraw')).credits).toHaveLength(1);
    expect((await request(app).get('/api/designers/amy-art/works')).body.items).toHaveLength(1);

    const left = await request(app).post(`/api/designers/me/credits/${added.body.id}/respond`).set(auth(A)).send({ accept: false });
    expect(left.status).toBe(200);

    expect((await one('ga-withdraw')).credits).toEqual([]);
    expect((await one('ga-withdraw')).artist).toBe('');                    // legacy text no longer republishes the name
    expect((await list()).find(x => x.id === 'ga-withdraw')!.artist).toBe('');
    expect((await request(app).get('/api/designers/amy-art/works')).body.items).toHaveLength(0);
    expect((await request(app).get('/api/designers/amy-art')).body.worksCount).toBe(0);
  });

  it('does not blank legacy text for unrelated artwork, or when a pending invite is declined', async () => {
    const b = await profile(B, 'bo-art');
    await artwork('ga-other', 'Someone Else');
    await artwork('ga-invite', 'Studio Text');
    const inv = await request(app).post('/api/artworks/ga-invite/credits').set(admin()).send({ profileId: b, role: 'contributor', invite: true });
    await request(app).post(`/api/designers/me/credits/${inv.body.id}/respond`).set(auth(B)).send({ accept: false });
    expect((await one('ga-other')).artist).toBe('Someone Else');
    expect((await one('ga-invite')).artist).toBe('Studio Text');           // a declined *invitation* never claimed the text
  });
});

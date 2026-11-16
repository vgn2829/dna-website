import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { getStorage } from '../src/storage';
import { signBypassStudentToken, signStudentToken } from '../src/middleware/studentAuth';
import { processAvatar, sniffAvatarType } from '../src/lib/avatarImage';
import { localRequest } from './localServer';

const app = createApp();
const request = localRequest(app);
const A = '230201';
const B = '230202';
const auth = (roll = A) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

const png = (w = 40, h = 30) => sharp({ create: { width: w, height: h, channels: 3, background: '#2255ee' } }).png().toBuffer();
const upload = (buf: Buffer, headers: object = auth(), name = 'me.png', type = 'image/png') =>
  request(app).post('/api/designers/me/avatar').set(headers).attach('avatar', buf, { filename: name, contentType: type });
const avatarKey = async (roll: string) => (await query<{ avatar_key: string | null }>('SELECT avatar_key FROM designer_profiles WHERE owner_roll = $1', [roll]))[0]?.avatar_key ?? null;

beforeEach(async () => {
  for (const roll of [A, B]) {
    await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email) VALUES($1,$2,'01 Jan 2026',$3,$4)`,
      [roll, `uid-${roll}`, `Student ${roll}`, `${roll}@iitk.ac.in`]);
  }
});
const makeProfile = async (roll: string, handle: string) =>
  expect((await request(app).post('/api/designers/me').set(auth(roll)).send({ handle, displayName: handle })).status).toBe(201);

describe('avatar image processing (pure)', () => {
  it('identifies real images by their bytes only', async () => {
    expect(sniffAvatarType(await png())).toBe('png');
    expect(sniffAvatarType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffAvatarType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffAvatarType(Buffer.from('%PDF-1.7'))).toBeNull();
  });
  it('crops to a 512 square WebP and strips metadata', async () => {
    const withExif = await sharp({ create: { width: 900, height: 400, channels: 3, background: '#ff0000' } })
      .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-owner', ImageDescription: 'GPS 26.5N 80.2E' } } }).toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processAvatar(withExif);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const meta = await sharp(out.buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);
    expect(meta.exif).toBeUndefined();
    expect(out.buffer.includes(Buffer.from('secret-owner'))).toBe(false);
  });
  it('rejects a corrupt image that merely has a PNG header', async () => {
    const out = await processAvatar(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really a png')]));
    expect(out).toEqual({ ok: false, problem: 'unreadable' });
  });
});

describe('POST/DELETE /api/designers/me/avatar', () => {
  it('requires a verified student session', async () => {
    await makeProfile(A, 'amy-avatar');
    expect((await request(app).post('/api/designers/me/avatar').attach('avatar', await png(), 'a.png')).status).toBe(401);
    expect((await upload(await png(), { Authorization: `Bearer ${signBypassStudentToken(A)}` })).status).toBe(403);
    expect(await avatarKey(A)).toBeNull();
  });

  it('needs a profile first, and only ever changes the caller\'s own profile', async () => {
    expect((await upload(await png())).status).toBe(404);
    await makeProfile(A, 'amy-avatar'); await makeProfile(B, 'bo-avatar');
    expect((await upload(await png(), auth(A))).status).toBe(200);
    expect(await avatarKey(A)).toMatch(/^profiles\/.+\/avatar-.+\.webp$/);
    expect(await avatarKey(B)).toBeNull();
  });

  it('stores a re-encoded WebP, publishes only its URL, and replaces + deletes the previous object', async () => {
    await makeProfile(A, 'amy-avatar');
    await request(app).patch('/api/designers/me/visibility').set(auth()).send({ visibility: 'public' });
    const first = await upload(await png(120, 80));
    expect(first.status).toBe(200);
    const key1 = (await avatarKey(A))!;
    const stored = await getStorage().download(key1);
    expect((await sharp(stored).metadata()).format).toBe('webp');

    const pub = await request(app).get('/api/designers/amy-avatar');
    expect(pub.body.avatarUrl).toBe(first.body.avatarUrl);
    expect(JSON.stringify(pub.body)).not.toContain(A);

    expect((await upload(await png(64, 64))).status).toBe(200);
    const key2 = (await avatarKey(A))!;
    expect(key2).not.toBe(key1);
    await expect(getStorage().download(key1)).rejects.toBeDefined();   // old object is gone
    expect((await sharp(await getStorage().download(key2)).metadata()).width).toBe(512);
  });

  it('refuses non-images, SVG, GIF, oversize files and extra form fields', async () => {
    await makeProfile(A, 'amy-avatar');
    expect((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), auth(), 'a.svg', 'image/svg+xml')).status).toBe(400);
    expect((await upload(Buffer.from('GIF89a\x01\x00\x01\x00'), auth(), 'a.gif', 'image/gif')).status).toBe(400);
    expect((await upload(Buffer.from('hello'), auth(), 'a.png', 'image/png')).status).toBe(400);          // lying filename/type
    const big = Buffer.concat([await png(), Buffer.alloc(2 * 1024 * 1024 + 10, 1)]);
    expect((await upload(big)).status).toBe(413);
    expect((await request(app).post('/api/designers/me/avatar').set(auth()).field('role', 'admin').attach('avatar', await png(), 'a.png')).status).toBe(400);
    expect((await request(app).post('/api/designers/me/avatar').set(auth()).send({})).status).toBe(400);   // no file
    expect(await avatarKey(A)).toBeNull();
  });

  it('removes the image on DELETE', async () => {
    await makeProfile(A, 'amy-avatar');
    await upload(await png());
    const key = (await avatarKey(A))!;
    const del = await request(app).delete('/api/designers/me/avatar').set(auth());
    expect(del.status).toBe(200);
    expect(del.body.avatarUrl).toBeNull();
    expect(await avatarKey(A)).toBeNull();
    await expect(getStorage().download(key)).rejects.toBeDefined();
  });
});

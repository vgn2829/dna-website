import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { checkGoogleFormUrl } from '../src/lib/eventForm';
import { EVENT_ATTACHMENT_MAX_BYTES } from '../src/routes/events';

// ─────────────────────────────────────────────────────────────────────────
// Optional event extras (routes/events.ts): a Google Forms registration
// link and one attachment (e.g. a problem statement), each independent and
// optional, plus the idempotent `register` RSVP action form events use.
// Real HTTP router, local test DB, LocalStorageProvider (SUPABASE_* unset).
// Events and RSVPs are truncated after every test (tests/setup.ts).
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
const request = localRequest(app);
const UPLOADS = path.resolve(__dirname, '../uploads');
const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSf-test/viewform';
const SHORT_FORM = 'https://forms.gle/AbC123xyz';

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const ZIP_BYTES = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

let adminToken = '';
const admin = () => ({ Authorization: `Bearer ${adminToken}` });
const student = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });

beforeAll(async () => {
  adminToken = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token as string;
});

// tests/setup.ts truncates events after each test (this hook runs first),
// which never releases their stored attachments — remove them here so the
// local uploads folder doesn't accumulate test files.
afterEach(async () => {
  for (const { id } of await query<{ id: string }>('SELECT id FROM events')) {
    fs.rmSync(path.join(UPLOADS, 'events', id), { recursive: true, force: true });
  }
});

// Released attachments leave empty event folders behind on the local
// provider (it deletes files, not directories); prune them.
afterAll(() => {
  const root = path.join(UPLOADS, 'events');
  if (!fs.existsSync(root)) return;
  for (const dir of fs.readdirSync(root)) {
    const full = path.join(root, dir);
    if (fs.statSync(full).isDirectory() && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
  }
  if (fs.readdirSync(root).length === 0) fs.rmdirSync(root);
});

const BASE = { title: 'Poster Jam', date: '2099-12-01', time: '5 PM', location: 'LHC', content: 'Design a poster.', capacity: 2 };

function createMultipart(fields: Record<string, string>, file?: { bytes: Buffer; name: string }) {
  let req = request(app).post('/api/events').set(admin());
  for (const [k, v] of Object.entries({ ...BASE, capacity: String(BASE.capacity), ...fields })) req = req.field(k, v);
  return file ? req.attach('attachment', file.bytes, file.name) : req;
}
function updateMultipart(id: string, fields: Record<string, string>, file?: { bytes: Buffer; name: string }) {
  let req = request(app).put(`/api/events/${id}`).set(admin());
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return file ? req.attach('attachment', file.bytes, file.name) : req;
}
const rowOf = async (id: string) => (await query<{ attachment_key: string | null; registration_form_url: string | null; attachment_name: string | null }>(
  'SELECT attachment_key, registration_form_url, attachment_name FROM events WHERE id = $1', [id]))[0];
const objectExists = (key: string) => fs.existsSync(path.join(UPLOADS, key));
const listed = async (id: string, roll?: string) => {
  const res = await request(app).get('/api/events').set(roll ? student(roll) : {});
  return (res.body as Array<{ id: string }>).find(e => e.id === id) as Record<string, unknown>;
};
const rsvp = (id: string, roll: string, body: object = {}) => request(app).post(`/api/events/${id}/rsvp`).set(student(roll)).send(body);

describe('Google Forms URL allowlist', () => {
  it.each([
    FORM,
    `${FORM}?usp=sf_link`,
    'https://docs.google.com/forms/d/1AbCdEf/viewform',
    SHORT_FORM,
    'https://DOCS.GOOGLE.COM/forms/d/e/x/viewform',
  ])('accepts %s', url => {
    expect(checkGoogleFormUrl(url).ok).toBe(true);
  });
  it.each([
    ['plain http', 'http://docs.google.com/forms/d/e/x/viewform'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['lookalike suffix', 'https://docs.google.com.evil.example/forms/d/x'],
    ['lookalike subdomain', 'https://forms.gle.evil.example/abc'],
    ['host in path', 'https://evil.example/docs.google.com/forms/d/x'],
    ['credentials', 'https://user:pass@docs.google.com/forms/d/x/viewform'],
    ['custom port', 'https://docs.google.com:8443/forms/d/x/viewform'],
    ['non-form Google doc', 'https://docs.google.com/document/d/x/edit'],
    ['bare forms path', 'https://docs.google.com/forms/'],
    ['short link without id', 'https://forms.gle/'],
    ['empty', '   '],
    ['too long', `${FORM}?x=${'a'.repeat(2100)}`],
  ])('rejects %s', (_label, url) => {
    expect(checkGoogleFormUrl(url).ok).toBe(false);
  });
  it('rejects a form edit link with a specific explanation', () => {
    const r = checkGoogleFormUrl('https://docs.google.com/forms/d/1AbC/edit');
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/edit link/) });
  });
});

describe('registration form link on create and edit', () => {
  it('round-trips, is preserved by unrelated edits, and clears explicitly', async () => {
    const created = await request(app).post('/api/events').set(admin()).send({ ...BASE, registrationFormUrl: `  ${FORM}  ` });
    expect(created.status).toBe(201);
    expect(created.body.registrationFormUrl).toBe(FORM);
    const id = created.body.id as string;

    // undefined → kept
    expect((await request(app).put(`/api/events/${id}`).set(admin()).send({ title: 'Renamed' })).body.registrationFormUrl).toBe(FORM);
    // replaced
    expect((await request(app).put(`/api/events/${id}`).set(admin()).send({ registrationFormUrl: SHORT_FORM })).body.registrationFormUrl).toBe(SHORT_FORM);
    // '' clears (multipart and JSON); null clears
    expect((await updateMultipart(id, { registrationFormUrl: '' })).body.registrationFormUrl).toBeNull();
    await request(app).put(`/api/events/${id}`).set(admin()).send({ registrationFormUrl: FORM });
    expect((await request(app).put(`/api/events/${id}`).set(admin()).send({ registrationFormUrl: null })).body.registrationFormUrl).toBeNull();
    expect((await rowOf(id)).registration_form_url).toBeNull();
  });

  it('refuses unsafe links with a clear error and stores nothing', async () => {
    const bad = await request(app).post('/api/events').set(admin()).send({ ...BASE, registrationFormUrl: 'https://evil.example/form' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Google Forms link/);
    expect(await query('SELECT id FROM events')).toEqual([]);

    const id = (await request(app).post('/api/events').set(admin()).send({ ...BASE, registrationFormUrl: FORM })).body.id as string;
    const badEdit = await request(app).put(`/api/events/${id}`).set(admin()).send({ registrationFormUrl: 'javascript:alert(1)', title: 'Changed' });
    expect(badEdit.status).toBe(400);
    expect((await rowOf(id)).registration_form_url).toBe(FORM);
    expect((await query<{ title: string }>('SELECT title FROM events WHERE id = $1', [id]))[0].title).toBe(BASE.title);
  });

  it('an event created the old way (JSON, no extras) reads back with null extras', async () => {
    const res = await request(app).post('/api/events').set(admin()).send(BASE);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ registrationFormUrl: null, attachment: null });
    // A row predating the columns (all NULL) reads the same way.
    await query(`INSERT INTO events (id,title,date,time,location,content,capacity) VALUES ('evt-legacy','Old','2099-01-01','5 PM','LHC','x',10)`);
    expect(await listed('evt-legacy')).toMatchObject({ registrationFormUrl: null, attachment: null, registeredCount: 0 });
  });
});

describe('idempotent registration for form events', () => {
  it('register never cancels: repeats and retries keep exactly one registration', async () => {
    const id = (await request(app).post('/api/events').set(admin()).send({ ...BASE, registrationFormUrl: FORM })).body.id as string;
    const first = await rsvp(id, '23FRM01', { action: 'register' });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ registeredCount: 1, isRegistered: true, registrationFormUrl: FORM });
    const again = await rsvp(id, '23FRM01', { action: 'register' });
    expect(again.body).toEqual({ registeredCount: 1, isRegistered: true, registrationFormUrl: FORM });

    // Concurrent retries from the same student still count once.
    // (This file stays under the route's 20 RSVPs/min limiter.)
    const burst = await Promise.all(Array.from({ length: 3 }, () => rsvp(id, '23FRM02', { action: 'register' })));
    expect(burst.every(r => r.status === 200 && r.body.isRegistered === true)).toBe(true);
    expect((await query<{ n: number }>('SELECT count(*)::int AS n FROM event_rsvps WHERE event_id = $1', [id]))[0].n).toBe(2);
    expect((await listed(id)).registeredCount).toBe(2);

    // Explicit cancel is idempotent too.
    expect((await rsvp(id, '23FRM01', { action: 'cancel' })).body).toEqual({ registeredCount: 1, isRegistered: false, registrationFormUrl: FORM });
    expect((await rsvp(id, '23FRM01', { action: 'cancel' })).body).toEqual({ registeredCount: 1, isRegistered: false, registrationFormUrl: FORM });
  });

  it('still enforces capacity, the past-event window and authentication — and returns no form on failure', async () => {
    const full = (await request(app).post('/api/events').set(admin()).send({ ...BASE, capacity: 1, registrationFormUrl: FORM })).body.id as string;
    expect((await rsvp(full, '23FRM03', { action: 'register' })).status).toBe(200);
    const refused = await rsvp(full, '23FRM04', { action: 'register' });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: 'Event is at capacity' });

    await query(`INSERT INTO events (id,title,date,time,location,content,capacity,registration_form_url) VALUES ('evt-past','Past','2020-01-01','5 PM','LHC','x',10,$1)`, [FORM]);
    const past = await rsvp('evt-past', '23FRM05', { action: 'register' });
    expect(past.status).toBe(409);
    expect(past.body).not.toHaveProperty('registrationFormUrl');

    expect((await request(app).post(`/api/events/${full}/rsvp`).send({ action: 'register' })).status).toBe(401);
    expect((await rsvp(full, '23FRM03', { action: 'maybe' })).status).toBe(400);
  });

  it('events without a form keep the exact toggle behaviour and response', async () => {
    const id = (await request(app).post('/api/events').set(admin()).send(BASE)).body.id as string;
    expect((await rsvp(id, '23TGL01')).body).toEqual({ registeredCount: 1, isRegistered: true });
    expect((await rsvp(id, '23TGL01')).body).toEqual({ registeredCount: 0, isRegistered: false });
    expect((await rsvp(id, '23TGL01', {})).body).toEqual({ registeredCount: 1, isRegistered: true });
  });
});

describe('event attachment', () => {
  it('creates with an attachment in the same request and stores one object under a stable key', async () => {
    const res = await createMultipart({ registrationFormUrl: '' }, { bytes: PDF_BYTES, name: 'Problem Statement.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.registrationFormUrl).toBeNull();
    expect(res.body.attachment).toMatchObject({ name: 'Problem Statement.pdf', size: PDF_BYTES.length });
    const row = await rowOf(res.body.id);
    expect(row.attachment_key).toMatch(new RegExp(`^events/${res.body.id}/[0-9a-f-]{36}\\.pdf$`));
    expect(res.body.attachment.url).toContain(row.attachment_key);
    expect(objectExists(row.attachment_key!)).toBe(true);
    expect((await request(app).get(`/uploads/${row.attachment_key}`)).status).toBe(200);
    expect(res.body.capacity).toBe(BASE.capacity);
  });

  it('refuses wrong types, mismatched bytes, empty and oversized files — storing nothing', async () => {
    const before = fs.existsSync(path.join(UPLOADS, 'events')) ? fs.readdirSync(path.join(UPLOADS, 'events')).length : 0;
    for (const [file, pattern] of [
      [{ bytes: PDF_BYTES, name: 'run.exe' }, /must be one of/],
      [{ bytes: PNG_BYTES, name: 'brief.pdf' }, /does not match/],
      [{ bytes: Buffer.alloc(0), name: 'brief.pdf' }, /empty/],
      [{ bytes: Buffer.concat([PDF_BYTES, Buffer.alloc(EVENT_ATTACHMENT_MAX_BYTES)]), name: 'huge.pdf' }, /25 MB/],
    ] as const) {
      const res = await createMultipart({}, file);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(pattern);
    }
    expect(await query('SELECT id FROM events')).toEqual([]);
    const after = fs.existsSync(path.join(UPLOADS, 'events')) ? fs.readdirSync(path.join(UPLOADS, 'events')).length : 0;
    expect(after).toBe(before);
  });

  it('replaces (releasing the old object), survives unrelated edits, and removes', async () => {
    const id = (await createMultipart({}, { bytes: PDF_BYTES, name: 'v1.pdf' })).body.id as string;
    const v1 = (await rowOf(id)).attachment_key!;

    // Unrelated edit (JSON, as the old admin UI sent) keeps it.
    const edited = await request(app).put(`/api/events/${id}`).set(admin()).send({ title: 'Poster Jam 2', startsAt: null });
    expect(edited.status).toBe(200);
    expect(edited.body.attachment.name).toBe('v1.pdf');
    expect((await rowOf(id)).attachment_key).toBe(v1);

    // Replace with a different type.
    const replaced = await updateMultipart(id, { title: 'Poster Jam 3' }, { bytes: ZIP_BYTES, name: 'brief-kit.docx' });
    expect(replaced.status).toBe(200);
    expect(replaced.body.attachment.name).toBe('brief-kit.docx');
    const v2 = (await rowOf(id)).attachment_key!;
    expect(v2).not.toBe(v1);
    expect(objectExists(v2)).toBe(true);
    expect(objectExists(v1)).toBe(false);

    // Both at once is refused, and changes nothing.
    expect((await updateMultipart(id, { removeAttachment: 'true' }, { bytes: PDF_BYTES, name: 'x.pdf' })).status).toBe(400);
    expect((await rowOf(id)).attachment_key).toBe(v2);

    // Remove.
    const removed = await request(app).put(`/api/events/${id}`).set(admin()).send({ removeAttachment: true });
    expect(removed.body.attachment).toBeNull();
    expect((await rowOf(id)).attachment_key).toBeNull();
    expect(objectExists(v2)).toBe(false);
  });

  it('never deletes an object something else still references', async () => {
    const a = (await createMultipart({}, { bytes: PDF_BYTES, name: 'shared.pdf' })).body.id as string;
    const key = (await rowOf(a)).attachment_key!;
    // Another event pointing at the same object (e.g. a manual copy).
    const b = (await request(app).post('/api/events').set(admin()).send(BASE)).body.id as string;
    await query('UPDATE events SET attachment_key = $1, attachment_name = $2 WHERE id = $3', [key, 'shared.pdf', b]);

    await request(app).put(`/api/events/${a}`).set(admin()).send({ removeAttachment: true });
    expect(objectExists(key)).toBe(true); // still used by event b

    // A saved board referencing the object also keeps it.
    await query(`INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
      VALUES ('23REF01', 'IITK-DnA-23REF01-AAAA', '01 Jan 2026', 'Ref', 'ref@iitk.ac.in') ON CONFLICT DO NOTHING`);
    const ws = ((await request(app).get('/api/workspaces').set(student('23REF01'))).body as Array<{ id: string; is_personal: boolean }>).find(w => w.is_personal)!.id;
    const board = (await request(app).post('/api/boards').set(student('23REF01')).send({ name: 'Board', workspace_id: ws })).body.id as string;
    await query('UPDATE boards SET canvas_data = $1 WHERE id = $2', [JSON.stringify({ src: `/uploads/${key}` }), board]);
    expect((await request(app).delete(`/api/events/${b}`).set(admin())).status).toBe(204);
    expect(objectExists(key)).toBe(true);
    await query('DELETE FROM boards WHERE id = $1', [board]);
    await query('DELETE FROM workspaces WHERE id = $1', [ws]);
    fs.rmSync(path.join(UPLOADS, key), { force: true }); // test cleanup only
  });

  it('deleting an event releases its attachment', async () => {
    const id = (await createMultipart({}, { bytes: PNG_BYTES, name: 'brief.png' })).body.id as string;
    const key = (await rowOf(id)).attachment_key!;
    expect((await request(app).delete(`/api/events/${id}`).set(admin())).status).toBe(204);
    expect(objectExists(key)).toBe(false);
  });

  it('students and anonymous callers cannot create, replace, remove or delete — nothing is stored', async () => {
    const id = (await createMultipart({}, { bytes: PDF_BYTES, name: 'brief.pdf' })).body.id as string;
    const key = (await rowOf(id)).attachment_key!;
    const filesBefore = fs.readdirSync(path.join(UPLOADS, 'events', id)).length;
    for (const headers of [student('23STU01'), {}]) {
      expect((await request(app).post('/api/events').set(headers).field('title', 'x').attach('attachment', PDF_BYTES, 'x.pdf')).status).toBe(401);
      expect((await request(app).put(`/api/events/${id}`).set(headers).attach('attachment', PDF_BYTES, 'x.pdf')).status).toBe(401);
      expect((await request(app).put(`/api/events/${id}`).set(headers).send({ removeAttachment: true })).status).toBe(401);
      expect((await request(app).delete(`/api/events/${id}`).set(headers)).status).toBe(401);
    }
    expect((await rowOf(id)).attachment_key).toBe(key);
    expect(fs.readdirSync(path.join(UPLOADS, 'events', id)).length).toBe(filesBefore);
    await request(app).delete(`/api/events/${id}`).set(admin());
  });
});

describe('the four configurations', () => {
  it('neither, form only, attachment only and both read back independently', async () => {
    const neither = (await request(app).post('/api/events').set(admin()).send(BASE)).body.id as string;
    const formOnly = (await request(app).post('/api/events').set(admin()).send({ ...BASE, registrationFormUrl: FORM })).body.id as string;
    const fileOnly = (await createMultipart({}, { bytes: PDF_BYTES, name: 'brief.pdf' })).body.id as string;
    const both = (await createMultipart({ registrationFormUrl: SHORT_FORM }, { bytes: PDF_BYTES, name: 'brief.pdf' })).body.id as string;

    expect(await listed(neither)).toMatchObject({ registrationFormUrl: null, attachment: null });
    expect(await listed(formOnly)).toMatchObject({ registrationFormUrl: FORM, attachment: null });
    expect(await listed(fileOnly)).toMatchObject({ registrationFormUrl: null, attachment: { name: 'brief.pdf' } });
    expect(await listed(both)).toMatchObject({ registrationFormUrl: SHORT_FORM, attachment: { name: 'brief.pdf' } });

    // Registration: toggle where there's no form, idempotent register where there is.
    expect((await rsvp(neither, '23CMB01')).body).toEqual({ registeredCount: 1, isRegistered: true });
    expect((await rsvp(fileOnly, '23CMB01')).body).toEqual({ registeredCount: 1, isRegistered: true });
    expect((await rsvp(formOnly, '23CMB01', { action: 'register' })).body.registrationFormUrl).toBe(FORM);
    expect((await rsvp(both, '23CMB01', { action: 'register' })).body.registrationFormUrl).toBe(SHORT_FORM);

    for (const id of [fileOnly, both]) await request(app).delete(`/api/events/${id}`).set(admin());
  });
});

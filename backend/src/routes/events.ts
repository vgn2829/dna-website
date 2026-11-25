import { Router, type Request } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { pool, query } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { requireStudent, optionalStudent } from '../middleware/studentAuth';
import { getEventStatus, parseIstDate, validateEventTime } from '../lib/eventDate';
import { checkGoogleFormUrl } from '../lib/eventForm';
import { diskUploadSingle, readFileHead } from '../lib/diskUpload';
import { getStorage, StorageTooLargeError } from '../storage';
import { findStorageReferences } from '../storage/references';
import { param } from '../routeParams';

export const eventsRouter = Router();

const rsvpLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Too many requests, please slow down.' } });

type EventRow = {
  id: string; title: string; date: string; time: string;
  location: string; content: string; capacity: number; registered_count: number;
  notified_at: string | null; starts_at: string | null;
  registration_form_url: string | null;
  attachment_key: string | null; attachment_name: string | null;
  attachment_mime: string | null; attachment_size: string | number | null;
};

// ── Event attachment (e.g. a problem statement) ─────────────────────────
// One optional file per event, uploaded by an admin with the event's create
// or edit request (multipart field "attachment"). It goes through the same
// pipeline as Gallery uploads: streamed to a temp file (lib/diskUpload.ts),
// type checked from the file's own bytes, stored once via the
// StorageProvider under a fresh key events/<eventId>/<uuid>.<ext>. The row
// keeps that stable key; the URL is derived when the event is read. PDFs and
// images open in the browser; Office files and ZIPs are served as downloads
// under their original name (application/octet-stream, like library files).
// The storage inventory treats events/ as an unmanaged namespace, so these
// objects are never orphan-cleanup candidates (storage/inventory.ts).
export const EVENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const EVENT_ATTACHMENT_LIMIT_LABEL = '25 MB';

const PDF = (b: Buffer) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const PNG = (b: Buffer) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
const JPG = (b: Buffer) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
const WEBP = (b: Buffer) => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
const ZIP = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04; // also .docx/.pptx

const ATTACHMENT_TYPES: Record<string, { mime: string; inline: boolean; check: (b: Buffer) => boolean }> = {
  pdf:  { mime: 'application/pdf', inline: true, check: PDF },
  png:  { mime: 'image/png',       inline: true, check: PNG },
  jpg:  { mime: 'image/jpeg',      inline: true, check: JPG },
  jpeg: { mime: 'image/jpeg',      inline: true, check: JPG },
  webp: { mime: 'image/webp',      inline: true, check: WEBP },
  docx: { mime: 'application/octet-stream', inline: false, check: ZIP },
  pptx: { mime: 'application/octet-stream', inline: false, check: ZIP },
  zip:  { mime: 'application/octet-stream', inline: false, check: ZIP },
};
export const EVENT_ATTACHMENT_EXTENSIONS = Object.keys(ATTACHMENT_TYPES);

// Multipart only: a JSON request passes through untouched (multer skips any
// body that isn't multipart/form-data), so older JSON clients keep working.
const attachmentUpload = diskUploadSingle('attachment');

type CheckedAttachment = { ext: string; mime: string; name: string; size: number; path: string };

// Validates an uploaded attachment; returns an error message on refusal.
async function checkAttachment(file: Express.Multer.File): Promise<CheckedAttachment | string> {
  const name = file.originalname.slice(0, 255);
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const spec = ATTACHMENT_TYPES[ext];
  if (!spec) return `Attachment must be one of: ${EVENT_ATTACHMENT_EXTENSIONS.filter(e => e !== 'jpeg').map(e => e.toUpperCase()).join(', ')}`;
  if (file.size === 0) return 'The attachment is empty (0 bytes)';
  if (file.size > EVENT_ATTACHMENT_MAX_BYTES) return `Attachment exceeds the ${EVENT_ATTACHMENT_LIMIT_LABEL} limit`;
  if (!spec.check(await readFileHead(file.path))) return 'Attachment content does not match its file type';
  return { ext: ext === 'jpeg' ? 'jpg' : ext, mime: spec.mime, name, size: file.size, path: file.path };
}

async function storeAttachment(eventId: string, a: CheckedAttachment): Promise<string> {
  const key = `events/${eventId}/${uuidv4()}.${a.ext}`;
  await getStorage().uploadFile(key, a.path, a.mime);
  return key;
}

// Removes a replaced/removed attachment's object — only when no event row
// and no saved board/template/version content references it any more.
async function releaseAttachment(key: string): Promise<void> {
  try {
    const stillUsed = await query('SELECT 1 FROM events WHERE attachment_key = $1 LIMIT 1', [key]);
    if (stillUsed.length > 0) return;
    if ((await findStorageReferences(key, 1)).length > 0) return;
    await getStorage().delete(key);
  } catch (err) {
    // A leftover object is a storage-cost leak, never a correctness issue.
    console.error('Event attachment cleanup failed (object retained):', key, err);
  }
}

function attachmentOf(row: EventRow) {
  if (!row.attachment_key) return null;
  const ext = row.attachment_key.slice(row.attachment_key.lastIndexOf('.') + 1);
  const inline = ATTACHMENT_TYPES[ext]?.inline ?? false;
  const name = row.attachment_name ?? `attachment.${ext}`;
  return {
    name,
    size: row.attachment_size === null ? null : Number(row.attachment_size),
    // PDFs and images open in the browser; everything else downloads.
    url: getStorage().getPublicUrl(row.attachment_key, inline ? undefined : { download: name }),
  };
}

function formatEvent(row: EventRow, isRegistered = false) {
  return {
    id: row.id, title: row.title, date: row.date, time: row.time,
    location: row.location, content: row.content,
    capacity: row.capacity, registeredCount: row.registered_count, isRegistered,
    notifiedAt: row.notified_at ?? null,
    // Machine-readable start instant, used by the reminder job; null until an
    // admin sets it (the free-text `time` field above remains the display label).
    startsAt: row.starts_at ?? null,
    // Both optional; null for events without them (existing events included).
    registrationFormUrl: row.registration_form_url ?? null,
    attachment: attachmentOf(row),
  };
}

// The optional registration form field of a create/update request, JSON or
// multipart. undefined → leave as is; null or '' → no form; otherwise it
// must pass lib/eventForm.ts.
type FormField = { kind: 'absent' } | { kind: 'set'; url: string | null } | { kind: 'invalid'; error: string };
function readFormField(raw: unknown): FormField {
  if (raw === undefined) return { kind: 'absent' };
  if (raw === null || raw === '') return { kind: 'set', url: null };
  if (typeof raw !== 'string') return { kind: 'invalid', error: 'Invalid registration form link' };
  if (raw.trim() === '') return { kind: 'set', url: null };
  const checked = checkGoogleFormUrl(raw);
  return checked.ok ? { kind: 'set', url: checked.url } : { kind: 'invalid', error: checked.error };
}

// Multipart bodies carry every field as a string: '' means "not set".
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const blankToNull = (v: unknown) => (v === '' ? null : v);

eventsRouter.get('/', optionalStudent, async (req, res) => {
  const roll = req.studentRoll;
  const rows = await query<EventRow>('SELECT * FROM events ORDER BY date ASC');
  if (!roll) { res.json(rows.map(r => formatEvent(r))); return; }

  const rsvps = await query<{ event_id: string }>(
    'SELECT event_id FROM event_rsvps WHERE roll_number=$1', [roll]
  );
  const rsvpSet = new Set(rsvps.map(r => r.event_id));
  res.json(rows.map(r => formatEvent(r, rsvpSet.has(r.id))));
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(parseIstDate(value)), 'Invalid calendar date'),
  time: z.string().min(1).max(50).refine(validateEventTime, 'Invalid event time'),
  location: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  capacity: z.coerce.number().int().min(1).max(10000),
  // Optional machine-readable start instant (ISO 8601). Not required at
  // create time — existing/older flows that only fill in the free-text
  // `time` label keep working; the reminder job simply skips events with no
  // startsAt rather than forcing this field everywhere.
  startsAt: z.preprocess(blankToUndefined, z.string().datetime().nullable().optional()),
});

// POST /api/events — JSON (as before) or multipart with an optional
// "attachment" file. Everything is validated before anything is stored, and
// a failed insert removes the just-stored attachment, so a refused request
// never leaves a half-created event or a stray file.
eventsRouter.post('/', requireAdmin, attachmentUpload, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request' }); return; }
  const form = readFormField(body.registrationFormUrl);
  if (form.kind === 'invalid') { res.status(400).json({ error: form.error }); return; }
  let attachment: CheckedAttachment | null = null;
  if (req.file) {
    const checked = await checkAttachment(req.file);
    if (typeof checked === 'string') { res.status(400).json({ error: checked }); return; }
    attachment = checked;
  }

  const { title, date, time, location, content, capacity, startsAt } = parsed.data;
  const id = `evt-${uuidv4().slice(0, 8)}`;
  let attachmentKey: string | null = null;
  if (attachment) {
    try {
      attachmentKey = await storeAttachment(id, attachment);
    } catch (err) {
      if (err instanceof StorageTooLargeError) { res.status(413).json({ error: 'This attachment is larger than the storage service currently accepts' }); return; }
      throw err;
    }
  }
  try {
    await query(
      `INSERT INTO events (id,title,date,time,location,content,capacity,starts_at,
         registration_form_url,attachment_key,attachment_name,attachment_mime,attachment_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, title, date, time, location, content, capacity, startsAt ?? null,
        form.kind === 'set' ? form.url : null,
        attachmentKey, attachment?.name ?? null, attachment?.mime ?? null, attachment?.size ?? null]
    );
  } catch (err) {
    if (attachmentKey) await getStorage().delete(attachmentKey).catch(() => {});
    throw err;
  }
  const rows = await query<EventRow>('SELECT * FROM events WHERE id=$1', [id]);
  res.status(201).json(formatEvent(rows[0]));
});

const updateSchema = z.object({
  title:    z.string().min(1).max(200).optional(),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(parseIstDate(value)), 'Invalid calendar date').optional(),
  time:     z.string().min(1).max(50).refine(validateEventTime, 'Invalid event time').optional(),
  location: z.string().min(1).max(200).optional(),
  content:  z.string().min(1).max(2000).optional(),
  capacity: z.coerce.number().int().min(1).max(10000).optional(),
  startsAt: z.preprocess(blankToNull, z.string().datetime().nullable().optional()),
  // true (or 'true' in multipart) removes the current attachment.
  removeAttachment: z.union([z.boolean(), z.enum(['true', 'false']).transform(v => v === 'true')]).optional(),
});

// PUT /api/events/:id — partial update, JSON (as before) or multipart.
// Fields left out are kept, so editing other details never touches the
// form link or attachment. registrationFormUrl: null/'' clears it. A new
// "attachment" file replaces the current one; removeAttachment clears it.
// The row is updated first; only then is the previous object released
// (releaseAttachment), and only if nothing else references it.
eventsRouter.put('/:id', requireAdmin, optionalStudent, attachmentUpload, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request' }); return; }
  const form = readFormField(body.registrationFormUrl);
  if (form.kind === 'invalid') { res.status(400).json({ error: form.error }); return; }
  let attachment: CheckedAttachment | null = null;
  if (req.file) {
    const checked = await checkAttachment(req.file);
    if (typeof checked === 'string') { res.status(400).json({ error: checked }); return; }
    attachment = checked;
  }
  const d = parsed.data;
  if (attachment && d.removeAttachment) { res.status(400).json({ error: 'Replace or remove the attachment, not both' }); return; }

  const cur = await query<{ registered_count: number }>(
    'SELECT registered_count FROM events WHERE id=$1', [req.params.id]
  );
  if (cur.length === 0) { res.status(404).json({ error: 'Event not found' }); return; }
  // Don't let capacity drop below the number of people already registered.
  if (d.capacity !== undefined && d.capacity < cur[0].registered_count) {
    res.status(409).json({ error: `Capacity cannot be below current registrations (${cur[0].registered_count})` });
    return;
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (d.title    !== undefined) { sets.push(`title = $${i++}`);    vals.push(d.title); }
  if (d.date     !== undefined) { sets.push(`date = $${i++}`);     vals.push(d.date); }
  if (d.time     !== undefined) { sets.push(`time = $${i++}`);     vals.push(d.time); }
  if (d.location !== undefined) { sets.push(`location = $${i++}`); vals.push(d.location); }
  if (d.content  !== undefined) { sets.push(`content = $${i++}`);  vals.push(d.content); }
  if (d.capacity !== undefined) { sets.push(`capacity = $${i++}`); vals.push(d.capacity); }
  if (d.startsAt !== undefined) { sets.push(`starts_at = $${i++}`); vals.push(d.startsAt); }
  if (form.kind === 'set')      { sets.push(`registration_form_url = $${i++}`); vals.push(form.url); }
  const attachmentChanges = Boolean(attachment || d.removeAttachment);
  if (sets.length === 0 && !attachmentChanges) { res.status(400).json({ error: 'Nothing to update' }); return; }

  let newKey: string | null = null;
  if (attachment) {
    try {
      newKey = await storeAttachment(param(req.params.id), attachment);
    } catch (err) {
      if (err instanceof StorageTooLargeError) { res.status(413).json({ error: 'This attachment is larger than the storage service currently accepts' }); return; }
      throw err;
    }
  }
  if (attachmentChanges) {
    sets.push(`attachment_key = $${i++}`);  vals.push(newKey);
    sets.push(`attachment_name = $${i++}`); vals.push(attachment?.name ?? null);
    sets.push(`attachment_mime = $${i++}`); vals.push(attachment?.mime ?? null);
    sets.push(`attachment_size = $${i++}`); vals.push(attachment?.size ?? null);
  }
  vals.push(req.params.id);

  // The previous key is read under the same row lock as the update, so two
  // concurrent replacements each release exactly the object they replaced.
  let updated: EventRow | undefined;
  let previousKey: string | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query<{ attachment_key: string | null }>(
      'SELECT attachment_key FROM events WHERE id=$1 FOR UPDATE', [req.params.id]
    );
    previousKey = before.rows[0]?.attachment_key ?? null;
    const result = await client.query<EventRow>(`UPDATE events SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    updated = result.rows[0];
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (newKey) await getStorage().delete(newKey).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (!updated) {
    if (newKey) await getStorage().delete(newKey).catch(() => {});
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  if (attachmentChanges && previousKey && previousKey !== newKey) await releaseAttachment(previousKey);

  const roll = req.studentRoll;
  let isRegistered = false;
  if (roll) {
    const r = await query('SELECT 1 FROM event_rsvps WHERE event_id=$1 AND roll_number=$2', [req.params.id, roll]);
    isRegistered = r.length > 0;
  }
  res.json(formatEvent(updated, isRegistered));
});

eventsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const result = await pool.query<{ attachment_key: string | null }>('DELETE FROM events WHERE id=$1 RETURNING attachment_key', [req.params.id]);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Event not found' }); return; }
  const key = result.rows[0].attachment_key;
  if (key) await releaseAttachment(key);
  res.status(204).end();
});

// POST /api/events/:id/rsvp { action? }
//   no action (older clients, events without a form) — TOGGLE, exactly as
//     before: register if not registered, otherwise cancel.
//   action 'register' — idempotent: registers, or leaves an existing
//     registration as it is. A form-enabled event uses this, so a repeated
//     click or a retried request can never cancel a reservation.
//   action 'cancel' — idempotent cancel.
// Registering always enforces the past-event and capacity rules under a row
// lock. For an event with a form, the response carries its validated
// registration form link — what the client opens after registering.
const rsvpSchema = z.object({ action: z.enum(['register', 'cancel']).optional() });

function rsvpAction(req: Request): 'toggle' | 'register' | 'cancel' | null {
  const parsed = rsvpSchema.safeParse(req.body ?? {});
  return parsed.success ? parsed.data.action ?? 'toggle' : null;
}

eventsRouter.post('/:id/rsvp', rsvpLimiter, requireStudent, async (req, res) => {
  const roll = req.studentRoll!;
  const action = rsvpAction(req);
  if (!action) { res.status(400).json({ error: 'Invalid RSVP action' }); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Read event inside the transaction with a row lock so concurrent RSVPs
    // see the authoritative registered_count and can't both pass the capacity check.
    const evtRows = await client.query<EventRow>(
      'SELECT * FROM events WHERE id=$1 FOR UPDATE', [req.params.id]
    );
    if (evtRows.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    const evt = evtRows.rows[0];

    const existing = await client.query(
      'SELECT 1 FROM event_rsvps WHERE event_id=$1 AND roll_number=$2', [req.params.id, roll]
    );
    const wasRegistered = existing.rows.length > 0;
    const register = action === 'register' || (action === 'toggle' && !wasRegistered);
    let isRegistered: boolean;
    if (!register) {
      if (wasRegistered) {
        await client.query('DELETE FROM event_rsvps WHERE event_id=$1 AND roll_number=$2', [req.params.id, roll]);
        await client.query('UPDATE events SET registered_count=GREATEST(0,registered_count-1) WHERE id=$1', [req.params.id]);
      }
      isRegistered = false;
    } else if (wasRegistered) {
      // 'register' on an existing registration: nothing to change.
      isRegistered = true;
    } else {
      if (getEventStatus({ date: evt.date, time: evt.time, startsAt: evt.starts_at }) === 'past') {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'This event is no longer accepting RSVPs' });
        return;
      }
      if (evt.registered_count >= evt.capacity) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Event is at capacity' });
        return;
      }
      await client.query('INSERT INTO event_rsvps(event_id,roll_number) VALUES($1,$2)', [req.params.id, roll]);
      await client.query('UPDATE events SET registered_count=registered_count+1 WHERE id=$1', [req.params.id]);
      isRegistered = true;
    }
    await client.query('COMMIT');
    const updated = await query<{ registered_count: number }>('SELECT registered_count FROM events WHERE id=$1', [req.params.id]);
    // registrationFormUrl only for an event that has one, so a no-form
    // event's response is exactly what it always was.
    res.json({
      registeredCount: updated[0].registered_count, isRegistered,
      ...(evt.registration_form_url ? { registrationFormUrl: evt.registration_form_url } : {}),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

eventsRouter.get('/:id/registrants', requireAdmin, async (req, res) => {
  const result = await query<{
    roll_number: string; name: string | null; email: string | null; rsvped_at: string | null;
  }>(`
    SELECT r.roll_number, ss.name, ss.email, r.created_at AS rsvped_at
    FROM event_rsvps r
    LEFT JOIN student_sessions ss ON ss.roll_number = r.roll_number
    WHERE r.event_id = $1
    ORDER BY r.created_at ASC NULLS LAST
  `, [req.params.id]);

  res.json({ event_id: req.params.id, count: result.length, registrants: result });
});

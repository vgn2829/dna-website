import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { pool, query } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { requireStudent, optionalStudent } from '../middleware/studentAuth';

export const eventsRouter = Router();

const rsvpLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Too many requests, please slow down.' } });

type EventRow = {
  id: string; title: string; date: string; time: string;
  location: string; content: string; capacity: number; registered_count: number;
};

function formatEvent(row: EventRow, isRegistered = false) {
  return {
    id: row.id, title: row.title, date: row.date, time: row.time,
    location: row.location, content: row.content,
    capacity: row.capacity, registeredCount: row.registered_count, isRegistered,
  };
}

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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().min(1).max(50),
  location: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  capacity: z.number().int().min(1).max(10000),
});

eventsRouter.post('/', requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { title, date, time, location, content, capacity } = parsed.data;
  const id = `evt-${uuidv4().slice(0, 8)}`;
  await query(
    'INSERT INTO events (id,title,date,time,location,content,capacity) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, title, date, time, location, content, capacity]
  );
  const rows = await query<EventRow>('SELECT * FROM events WHERE id=$1', [id]);
  res.status(201).json(formatEvent(rows[0]));
});

const updateSchema = z.object({
  title:    z.string().min(1).max(200).optional(),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time:     z.string().min(1).max(50).optional(),
  location: z.string().min(1).max(200).optional(),
  content:  z.string().min(1).max(2000).optional(),
  capacity: z.coerce.number().int().min(1).max(10000).optional(),
});

eventsRouter.put('/:id', requireAdmin, optionalStudent, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const d = parsed.data;
  if (d.title    !== undefined) { sets.push(`title = $${i++}`);    vals.push(d.title); }
  if (d.date     !== undefined) { sets.push(`date = $${i++}`);     vals.push(d.date); }
  if (d.time     !== undefined) { sets.push(`time = $${i++}`);     vals.push(d.time); }
  if (d.location !== undefined) { sets.push(`location = $${i++}`); vals.push(d.location); }
  if (d.content  !== undefined) { sets.push(`content = $${i++}`);  vals.push(d.content); }
  if (d.capacity !== undefined) { sets.push(`capacity = $${i++}`); vals.push(d.capacity); }
  if (sets.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
  vals.push(req.params.id);
  const result = await pool.query(`UPDATE events SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Event not found' }); return; }
  const roll = req.studentRoll;
  let isRegistered = false;
  if (roll) {
    const r = await query('SELECT 1 FROM event_rsvps WHERE event_id=$1 AND roll_number=$2', [req.params.id, roll]);
    isRegistered = r.length > 0;
  }
  res.json(formatEvent(result.rows[0] as EventRow, isRegistered));
});

eventsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM events WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Event not found' }); return; }
  res.status(204).end();
});

eventsRouter.post('/:id/rsvp', rsvpLimiter, requireStudent, async (req, res) => {
  const roll = req.studentRoll!;

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
    let isRegistered: boolean;
    if (existing.rows.length > 0) {
      await client.query('DELETE FROM event_rsvps WHERE event_id=$1 AND roll_number=$2', [req.params.id, roll]);
      await client.query('UPDATE events SET registered_count=GREATEST(0,registered_count-1) WHERE id=$1', [req.params.id]);
      isRegistered = false;
    } else {
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
    res.json({ registeredCount: updated[0].registered_count, isRegistered });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

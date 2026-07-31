import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/client';
import { drainMailQueue, sendEventReminders, type DueReminder } from '../services/mailer';

const router = Router();

// Render's free tier spins the web service down when idle, so there is no
// always-on process to run an in-process setInterval — this endpoint is hit
// by an external scheduler (e.g. cron-job.org) roughly every 10 minutes to
// both keep the service warm and drive time-based work: draining any queued
// broadcast mail (see mailer.ts sendBroadcast) and sending event reminders
// due in the next ~65 minutes. Protected by a shared secret rather than admin
// auth since the caller is a third-party scheduler, not a logged-in admin.
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireTickSecret(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  const secret = process.env.INTERNAL_TICK_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'INTERNAL_TICK_SECRET not configured' });
    return;
  }
  const provided = (req.headers['x-tick-secret'] as string | undefined) ?? (req.query.secret as string | undefined);
  if (!provided || !timingSafeEqual(provided, secret)) {
    res.status(401).json({ error: 'Invalid tick secret' });
    return;
  }
  next();
}

// Reminder window: events starting within the next 65 minutes, wider than the
// ~10-minute tick interval so every RSVP gets several chances to be caught
// even if a tick is missed or delayed. reminder_sent_at IS NULL is the dedup
// guard — once stamped, a row drops out of this query for good.
const REMINDER_WINDOW_MINUTES = 65;

router.post('/tick', requireTickSecret, async (_req, res) => {
  const report = { queueDrained: true, remindersSent: 0, remindersDeferred: 0 };

  try {
    await drainMailQueue();
  } catch (err) {
    console.error('Tick: mail queue drain failed:', err);
    report.queueDrained = false;
  }

  try {
    const due = await pool.query<{
      event_id: string; roll_number: string; email: string; name: string | null;
      title: string; date: string; time: string; location: string;
    }>(`
      SELECT r.event_id, r.roll_number, ss.email, ss.name,
             e.title, e.date, e.time, e.location
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
      JOIN student_sessions ss ON ss.roll_number = r.roll_number
      WHERE r.reminder_sent_at IS NULL
        AND ss.email IS NOT NULL
        AND e.starts_at IS NOT NULL
        AND e.starts_at BETWEEN NOW() AND NOW() + INTERVAL '${REMINDER_WINDOW_MINUTES} minutes'
    `);

    const dueReminders: DueReminder[] = due.rows.map(r => ({
      eventId: r.event_id, rollNumber: r.roll_number, email: r.email, name: r.name,
      title: r.title, date: r.date, time: r.time, venue: r.location,
    }));

    const { sent } = await sendEventReminders(dueReminders);

    for (const r of sent) {
      await pool.query(
        `UPDATE event_rsvps SET reminder_sent_at = NOW()
         WHERE event_id = $1 AND roll_number = $2 AND reminder_sent_at IS NULL`,
        [r.eventId, r.rollNumber]
      );
    }

    report.remindersSent = sent.length;
    report.remindersDeferred = dueReminders.length - sent.length;
  } catch (err) {
    console.error('Tick: reminder pass failed:', err);
  }

  res.json({ success: true, ...report });
});

export default router;

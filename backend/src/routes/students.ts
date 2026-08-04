import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';
import { requireAdmin } from '../middleware/adminAuth';
import { param } from '../routeParams';

const progressWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many progress updates — please slow down' },
});

const progressReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests — please slow down' },
});

const existsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests — please slow down' },
});

export const studentsRouter = Router();

const VALID_ID = /^[a-zA-Z0-9_-]{1,100}$/;

// Used by the login modal to decide whether to show the "register" fields.
// Returns only booleans — no name/email/uniqueId is exposed without a verified token.
studentsRouter.get('/:roll/exists', existsLimiter, async (req, res) => {
  try {
    const roll = param(req.params.roll).trim().toUpperCase();
    const rows = await query<{ name: string | null; email: string | null }>(
      'SELECT name, email FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    if (rows.length === 0) {
      res.json({ exists: false, hasProfile: false });
      return;
    }
    const row = rows[0];
    res.json({ exists: true, hasProfile: !!(row.name && row.email) });
  } catch (err) {
    console.error('Exists check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

studentsRouter.get('/:roll/progress', progressReadLimiter, requireStudent, async (req, res) => {
  const roll = req.studentRoll!;
  const watched = await query<{ video_id: string }>('SELECT video_id FROM student_watched_videos WHERE roll_number=$1', [roll]);
  const quizzes = await query<{ domain_id: string }>('SELECT domain_id FROM student_completed_quizzes WHERE roll_number=$1', [roll]);
  res.json({ watchedVideos: watched.map(r => r.video_id), completedQuizzes: quizzes.map(r => r.domain_id) });
});

studentsRouter.post('/:roll/progress/videos/:videoId', progressWriteLimiter, requireStudent, async (req, res) => {
  const roll = req.studentRoll!;
  if (!VALID_ID.test(param(req.params.videoId))) { res.status(400).json({ error: 'Invalid video ID' }); return; }
  const exists = await query('SELECT 1 FROM student_sessions WHERE roll_number=$1', [roll]);
  if (exists.length === 0) { res.status(404).json({ error: 'Student not found' }); return; }
  await query(
    'INSERT INTO student_watched_videos(roll_number,video_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [roll, param(req.params.videoId)]
  );
  res.status(204).end();
});

studentsRouter.delete('/:roll/progress/videos/:videoId', progressWriteLimiter, requireStudent, async (req, res) => {
  const roll = req.studentRoll!;
  if (!VALID_ID.test(param(req.params.videoId))) { res.status(400).json({ error: 'Invalid video ID' }); return; }
  await query('DELETE FROM student_watched_videos WHERE roll_number=$1 AND video_id=$2', [roll, req.params.videoId]);
  res.status(204).end();
});

// Quiz completion is recorded server-side by POST /domains/:id/quiz/submit
// (graded), so there is no client-asserted quiz-completion endpoint here.

// GET /api/students/overview — admin only. Powers the Overview tab's stat
// cards, batch breakdown, and day-wise activity chart. Batch is derived from
// the roll number's first two digits (ROLL_SCHEMA guarantees every valid
// roll starts with 2 digits), bucketed into "Other" outside a plausible
// admission-year range so a syntactically-valid-but-nonsense roll (e.g.
// "99xyz01") can't masquerade as a real batch. Shared by both the
// student_sessions batch chart and the login_events daily chart so the two
// can never disagree on what batch a roll number belongs to.
const MIN_BATCH_YEAR = 20;
const MAX_BATCH_YEAR = 30;

function deriveBatch(rollNumber: string): string {
  const yearDigits = rollNumber.slice(0, 2);
  const yearNum = Number(yearDigits);
  return yearNum >= MIN_BATCH_YEAR && yearNum <= MAX_BATCH_YEAR ? `Y${yearDigits}` : 'Other';
}

// Below this many days of accumulated login_events history, the daily chart
// is withheld entirely (dailyActivity: null) rather than shown near-empty —
// an empty/sparse chart on day one reads as broken, not new.
const MIN_DAYS_OF_DATA = 5;
const DAILY_ACTIVITY_WINDOW_DAYS = 30;

studentsRouter.get('/overview', requireAdmin, async (req, res) => {
  try {
    const rows = await query<{ roll_number: string; last_login: string | null }>(
      'SELECT roll_number, last_login FROM student_sessions',
      []
    );

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    let active7 = 0;
    let active30 = 0;
    const batchCounts = new Map<string, number>();

    for (const row of rows) {
      const batch = deriveBatch(row.roll_number);
      batchCounts.set(batch, (batchCounts.get(batch) ?? 0) + 1);

      if (row.last_login) {
        const age = now - new Date(row.last_login).getTime();
        if (age <= 7 * DAY_MS) active7++;
        if (age <= 30 * DAY_MS) active30++;
      }
    }

    const batches = [...batchCounts.entries()]
      .map(([batch, count]) => ({ batch, count }))
      .sort((a, b) => a.batch.localeCompare(b.batch));

    const earliestRows = await query<{ earliest: string | null }>(
      'SELECT MIN(logged_in_at) AS earliest FROM login_events',
      []
    );
    const earliest = earliestRows[0]?.earliest ?? null;
    const daysOfData = earliest ? (now - new Date(earliest).getTime()) / DAY_MS : 0;

    let dailyActivity: { since: string; days: { date: string; batches: Record<string, number>; total: number }[] } | null = null;

    if (earliest && daysOfData >= MIN_DAYS_OF_DATA) {
      const eventRows = await query<{ roll_number: string; logged_in_at: string }>(
        `SELECT roll_number, logged_in_at FROM login_events
         WHERE logged_in_at >= NOW() - INTERVAL '${DAILY_ACTIVITY_WINDOW_DAYS} days'
         ORDER BY logged_in_at ASC`,
        []
      );

      const dayMap = new Map<string, Record<string, number>>();
      for (const ev of eventRows) {
        const date = new Date(ev.logged_in_at).toISOString().slice(0, 10); // YYYY-MM-DD
        const batch = deriveBatch(ev.roll_number);
        const dayBatches = dayMap.get(date) ?? {};
        dayBatches[batch] = (dayBatches[batch] ?? 0) + 1;
        dayMap.set(date, dayBatches);
      }

      const days = [...dayMap.entries()]
        .map(([date, batchCountsForDay]) => ({
          date,
          batches: batchCountsForDay,
          total: Object.values(batchCountsForDay).reduce((sum, n) => sum + n, 0),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      dailyActivity = { since: earliest, days };
    }

    res.json({
      total: rows.length,
      active7d: active7,
      active30d: active30,
      batches,
      dailyActivity,
      collectingSince: !dailyActivity ? earliest : null,
    });
  } catch (err) {
    console.error('Students overview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/students/count — public. Just the registered-student total, for the
// homepage "Active Members" stat. A raw count isn't sensitive the way the full
// /overview payload is (roll numbers, batches, activity), so this skips
// requireAdmin — but it's still rate-limited since it's unauthenticated.
studentsRouter.get('/count', existsLimiter, async (_req, res) => {
  try {
    const rows = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM student_sessions', []);
    res.json({ total: rows[0]?.count ?? 0 });
  } catch (err) {
    console.error('Students count error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/students — admin only. Lightweight roster (no email) for the
// Overview tab's batch filter list. Full contact details stay behind
// existing student-facing endpoints — this is deliberately minimal.
studentsRouter.get('/', requireAdmin, async (req, res) => {
  try {
    const rows = await query<{ roll_number: string; name: string | null; registered_at: string; last_login: string | null }>(
      'SELECT roll_number, name, registered_at, last_login FROM student_sessions ORDER BY roll_number ASC',
      []
    );
    res.json(rows);
  } catch (err) {
    console.error('List students error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

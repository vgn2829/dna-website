import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { query } from '../db/client';
import { sendWelcomeEmail } from '../services/mailer';

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

export const studentsRouter = Router();

const VALID_ID  = /^[a-zA-Z0-9_-]{1,100}$/;
const ROLL_RE   = /^[0-9]{2}[a-zA-Z0-9]{4,6}$/i;

const sessionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { error: 'Too many session requests — try again in 5 minutes' },
});

const sessionSchema = z.object({
  rollNumber: z.string().regex(/^[0-9]{2}[a-zA-Z0-9]{4,6}$/i, 'Invalid roll number format').transform(s => s.trim().toUpperCase()),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long').trim(),
  email: z.string().email('Invalid email address').refine(e => e.toLowerCase().endsWith('@iitk.ac.in'), 'Only @iitk.ac.in email addresses are allowed').transform(e => e.toLowerCase()),
});

studentsRouter.get('/:roll/exists', async (req, res) => {
  try {
    const roll = req.params.roll.trim().toUpperCase();
    const rows = await query<{ roll_number: string; name: string | null; email: string | null }>(
      'SELECT roll_number, name, email FROM student_sessions WHERE roll_number = $1',
      [roll]
    );

    if (rows.length === 0) {
      res.json({ exists: false, hasProfile: false });
      return;
    }

    const row = rows[0];
    const hasProfile = !!(row.name && row.email);
    res.json({ exists: true, hasProfile });
  } catch (err) {
    console.error('Exists check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

studentsRouter.post('/sessions/login', async (req, res) => {
  try {
    const { rollNumber } = req.body;
    if (!rollNumber) {
      res.status(400).json({ error: 'Roll number required' });
      return;
    }

    const roll = String(rollNumber).trim().toUpperCase();
    const rows = await query<{
      roll_number: string;
      unique_id: string;
      registered_at: string;
      name: string;
      email: string;
    }>(
      `SELECT roll_number, unique_id, registered_at, name, email
       FROM student_sessions
       WHERE roll_number = $1 AND name IS NOT NULL AND email IS NOT NULL`,
      [roll]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Student not found or incomplete profile' });
      return;
    }

    const row = rows[0];
    res.json({
      rollNumber: row.roll_number,
      uniqueId: row.unique_id,
      registeredAt: row.registered_at,
      name: row.name,
      email: row.email,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

studentsRouter.post('/sessions', sessionLimiter, async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid roll number' }); return; }

  const { rollNumber: roll, name, email } = parsed.data;

  let existingRows = await query<{ roll_number: string; unique_id: string; registered_at: string }>(
    'SELECT roll_number, unique_id, registered_at FROM student_sessions WHERE roll_number=$1', [roll]
  );

  let uniqueId: string;
  let registeredAt: string;

  if (existingRows.length === 0) {
    const suffix = uuidv4().slice(0, 4).toUpperCase();
    uniqueId = `IITK-DnA-${roll}-${suffix}`;
    registeredAt = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    await query(
      `INSERT INTO student_sessions(roll_number,unique_id,registered_at,name,email)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (roll_number) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email`,
      [roll, uniqueId, registeredAt, name, email]
    );
    sendWelcomeEmail(name, email).catch(err => console.error('Welcome email failed:', err));
  } else {
    uniqueId = existingRows[0].unique_id;
    registeredAt = existingRows[0].registered_at;
    await query(
      'UPDATE student_sessions SET name=$1, email=$2 WHERE roll_number=$3',
      [name, email, roll]
    );
  }

  const groupCheck = await query<{ group_id: string }>(
    'SELECT group_id FROM audience_group_members WHERE roll_number = $1',
    [roll]
  );
  if (groupCheck.length > 0) {
    console.log(
      `Student ${roll} linked to groups:`,
      groupCheck.map((r) => r.group_id).join(', ')
    );
  }

  const watched = await query<{ video_id: string }>('SELECT video_id FROM student_watched_videos WHERE roll_number=$1', [roll]);
  const quizzes = await query<{ domain_id: string }>('SELECT domain_id FROM student_completed_quizzes WHERE roll_number=$1', [roll]);

  res.json({
    session: { rollNumber: roll, uniqueId, registeredAt, name, email },
    progress: { watchedVideos: watched.map(r => r.video_id), completedQuizzes: quizzes.map(r => r.domain_id) },
  });
});

studentsRouter.get('/:roll/profile', progressReadLimiter, async (req, res) => {
  const roll = req.params.roll.trim().toUpperCase();
  const rows = await query<{ roll_number: string; name: string | null }>(
    'SELECT roll_number, name FROM student_sessions WHERE roll_number=$1', [roll]
  );
  if (rows.length === 0) { res.status(404).json({ error: 'Student not found' }); return; }
  res.json({ rollNumber: rows[0].roll_number, name: rows[0].name });
});

studentsRouter.get('/:roll/progress', progressReadLimiter, async (req, res) => {
  const roll = req.params.roll.trim().toUpperCase();
  const exists = await query('SELECT 1 FROM student_sessions WHERE roll_number=$1', [roll]);
  if (exists.length === 0) { res.status(404).json({ error: 'Student not found' }); return; }

  const watched = await query<{ video_id: string }>('SELECT video_id FROM student_watched_videos WHERE roll_number=$1', [roll]);
  const quizzes = await query<{ domain_id: string }>('SELECT domain_id FROM student_completed_quizzes WHERE roll_number=$1', [roll]);
  res.json({ watchedVideos: watched.map(r => r.video_id), completedQuizzes: quizzes.map(r => r.domain_id) });
});

function ownerGuard(req: Parameters<Parameters<typeof studentsRouter.post>[1]>[0], res: Parameters<Parameters<typeof studentsRouter.post>[1]>[1]): boolean {
  const callerRoll = (req.headers['x-roll-number'] as string | undefined)?.trim().toUpperCase();
  if (!callerRoll || callerRoll !== req.params.roll.trim().toUpperCase()) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

studentsRouter.post('/:roll/progress/videos/:videoId', progressWriteLimiter, async (req, res) => {
  if (!ownerGuard(req, res)) return;
  const roll = req.params.roll.trim().toUpperCase();
  if (!ROLL_RE.test(roll)) { res.status(400).json({ error: 'Invalid roll number format' }); return; }
  if (!VALID_ID.test(req.params.videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
  const exists = await query('SELECT 1 FROM student_sessions WHERE roll_number=$1', [roll]);
  if (exists.length === 0) { res.status(404).json({ error: 'Student not found' }); return; }
  await query(
    'INSERT INTO student_watched_videos(roll_number,video_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [roll, req.params.videoId]
  );
  res.status(204).end();
});

studentsRouter.delete('/:roll/progress/videos/:videoId', progressWriteLimiter, async (req, res) => {
  if (!ownerGuard(req, res)) return;
  const roll = req.params.roll.trim().toUpperCase();
  if (!ROLL_RE.test(roll)) { res.status(400).json({ error: 'Invalid roll number format' }); return; }
  if (!VALID_ID.test(req.params.videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
  await query('DELETE FROM student_watched_videos WHERE roll_number=$1 AND video_id=$2', [roll, req.params.videoId]);
  res.status(204).end();
});

studentsRouter.post('/:roll/progress/quizzes/:domainId', progressWriteLimiter, async (req, res) => {
  if (!ownerGuard(req, res)) return;
  const roll = req.params.roll.trim().toUpperCase();
  if (!ROLL_RE.test(roll)) { res.status(400).json({ error: 'Invalid roll number format' }); return; }
  if (!VALID_ID.test(req.params.domainId)) { res.status(400).json({ error: 'Invalid domain ID' }); return; }
  const exists = await query('SELECT 1 FROM student_sessions WHERE roll_number=$1', [roll]);
  if (exists.length === 0) { res.status(404).json({ error: 'Student not found' }); return; }
  await query(
    'INSERT INTO student_completed_quizzes(roll_number,domain_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [roll, req.params.domainId]
  );
  res.status(204).end();
});

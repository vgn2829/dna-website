import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';

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
    const roll = req.params.roll.trim().toUpperCase();
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
  if (!VALID_ID.test(req.params.videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
  const exists = await query('SELECT 1 FROM student_sessions WHERE roll_number=$1', [roll]);
  if (exists.length === 0) { res.status(404).json({ error: 'Student not found' }); return; }
  await query(
    'INSERT INTO student_watched_videos(roll_number,video_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [roll, req.params.videoId]
  );
  res.status(204).end();
});

studentsRouter.delete('/:roll/progress/videos/:videoId', progressWriteLimiter, requireStudent, async (req, res) => {
  const roll = req.studentRoll!;
  if (!VALID_ID.test(req.params.videoId)) { res.status(400).json({ error: 'Invalid video ID' }); return; }
  await query('DELETE FROM student_watched_videos WHERE roll_number=$1 AND video_id=$2', [roll, req.params.videoId]);
  res.status(204).end();
});

// NOTE: quiz completion is still client-asserted here; item 12 (M-3) replaces
// this with a server-graded submit-answers endpoint.
studentsRouter.post('/:roll/progress/quizzes/:domainId', progressWriteLimiter, requireStudent, async (req, res) => {
  const roll = req.studentRoll!;
  if (!VALID_ID.test(req.params.domainId)) { res.status(400).json({ error: 'Invalid domain ID' }); return; }
  const exists = await query('SELECT 1 FROM student_sessions WHERE roll_number=$1', [roll]);
  if (exists.length === 0) { res.status(404).json({ error: 'Student not found' }); return; }
  await query(
    'INSERT INTO student_completed_quizzes(roll_number,domain_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [roll, req.params.domainId]
  );
  res.status(204).end();
});

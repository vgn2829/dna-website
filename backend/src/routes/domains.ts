import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool, query } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { requireStudent } from '../middleware/studentAuth';

export const domainsRouter = Router();

type DomainRow = { id: string; title: string; full_name: string; icon: string; tagline: string; description: string; color: string; display_order: number };
type VideoRow  = { id: string; domain_id: string; title: string; yt_id: string; difficulty: string; duration: string; sequence: number };
type QuizRow   = { id: number; domain_id: string; question: string; options: string; answer_index: number };

domainsRouter.get('/', async (_req, res) => {
  const [domains, videos, quizzes] = await Promise.all([
    query<DomainRow>('SELECT * FROM domains ORDER BY display_order ASC, created_at ASC'),
    query<VideoRow>('SELECT * FROM videos ORDER BY sequence ASC, created_at ASC'),
    query<QuizRow>('SELECT * FROM quiz_questions ORDER BY id ASC'),
  ]);

  const result: Record<string, object> = {};
  for (const d of domains) {
    result[d.id] = {
      id: d.id, title: d.title, fullName: d.full_name, icon: d.icon,
      tagline: d.tagline, description: d.description, color: d.color,
      videos: videos.filter(v => v.domain_id === d.id)
        .map(v => ({ id: v.id, title: v.title, ytId: v.yt_id, difficulty: v.difficulty, duration: v.duration, sequence: v.sequence })),
      quizzes: quizzes.filter(q => q.domain_id === d.id)
        .map(q => {
          let options: string[] = [];
          try { options = JSON.parse(q.options) as string[]; } catch { options = []; }
          // answer_index is NOT sent to clients — quizzes are graded server-side.
          return { q: q.question, options };
        }),
    };
  }
  res.json(result);
});

// Server-side quiz grading. Records completion only when the submission passes,
// so XP/completion can't be self-asserted and answer keys never reach the client.
const quizSubmitSchema = z.object({
  answers: z.array(z.number().int().min(0).max(50)).min(1).max(50),
});

domainsRouter.post('/:id/quiz/submit', requireStudent, async (req, res) => {
  const parsed = quizSubmitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid submission' }); return; }

  const questions = await query<QuizRow>(
    'SELECT * FROM quiz_questions WHERE domain_id=$1 ORDER BY id ASC', [req.params.id]
  );
  if (questions.length === 0) { res.status(404).json({ error: 'No quiz for this domain' }); return; }
  if (parsed.data.answers.length !== questions.length) {
    res.status(400).json({ error: 'Answer count does not match question count' }); return;
  }

  const results = questions.map((q, i) => parsed.data.answers[i] === q.answer_index);
  const correct = results.filter(Boolean).length;
  const passed = correct === questions.length;

  if (passed) {
    await query(
      'INSERT INTO student_completed_quizzes(roll_number,domain_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [req.studentRoll!, req.params.id]
    );
  }

  res.json({ passed, correct, total: questions.length, results });
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'domain';
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await query('SELECT 1 FROM domains WHERE id=$1', [slug]);
    if (rows.length === 0) return slug;
    slug = `${base}-${n++}`;
  }
  throw new Error(`Could not generate a unique slug for base "${base}" after 20 attempts`);
}

const domainCreateSchema = z.object({
  title:       z.string().min(1).max(100),
  fullName:    z.string().min(1).max(200),
  icon:        z.string().min(1).max(100).default('fa-layer-group'),
  tagline:     z.string().max(300).default(''),
  description: z.string().max(1000).default(''),
  color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#007AFF'),
});

domainsRouter.post('/', requireAdmin, async (req, res) => {
  const parsed = domainCreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { title, fullName, icon, tagline, description, color } = parsed.data;
  const id = await uniqueSlug(slugify(title));

  const maxOrder = await query<{ max: number }>('SELECT COALESCE(MAX(display_order),0) AS max FROM domains');
  const displayOrder = (maxOrder[0].max as unknown as number) + 1;

  await query(
    'INSERT INTO domains(id,title,full_name,icon,tagline,description,color,display_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, title, fullName, icon, tagline, description, color, displayOrder]
  );
  res.status(201).json({ id, title, fullName, icon, tagline, description, color, videos: [], quizzes: [] });
});

const domainUpdateSchema = z.object({
  title:       z.string().min(1).max(100).optional(),
  fullName:    z.string().min(1).max(200).optional(),
  icon:        z.string().min(1).max(100).optional(),
  tagline:     z.string().max(300).optional(),
  description: z.string().max(1000).optional(),
  color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

domainsRouter.put('/:id', requireAdmin, async (req, res) => {
  const existing = await query<DomainRow>('SELECT * FROM domains WHERE id=$1', [req.params.id]);
  if (existing.length === 0) { res.status(404).json({ error: 'Domain not found' }); return; }

  const parsed = domainUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const d = parsed.data;
  if (d.title       !== undefined) { sets.push(`title = $${i++}`);       vals.push(d.title); }
  if (d.fullName    !== undefined) { sets.push(`full_name = $${i++}`);    vals.push(d.fullName); }
  if (d.icon        !== undefined) { sets.push(`icon = $${i++}`);         vals.push(d.icon); }
  if (d.tagline     !== undefined) { sets.push(`tagline = $${i++}`);      vals.push(d.tagline); }
  if (d.description !== undefined) { sets.push(`description = $${i++}`);  vals.push(d.description); }
  if (d.color       !== undefined) { sets.push(`color = $${i++}`);        vals.push(d.color); }
  if (sets.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
  vals.push(req.params.id);
  const result = await pool.query(`UPDATE domains SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  const row = result.rows[0] as DomainRow;
  res.json({ id: row.id, title: row.title, fullName: row.full_name, icon: row.icon, tagline: row.tagline, description: row.description, color: row.color });
});

domainsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM domains WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Domain not found' }); return; }
  res.status(204).end();
});

function normalizeYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const short = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];
  const long = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (long) return long[1];
  return null;
}

const videoSchema = z.object({
  title:      z.string().min(1).max(200),
  ytUrl:      z.string().min(1),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']),
  duration:   z.string().min(1).max(20),
  sequence:   z.coerce.number().int().min(1).optional(),
});

domainsRouter.post('/:id/videos', requireAdmin, async (req, res) => {
  const domain = await query('SELECT 1 FROM domains WHERE id=$1', [req.params.id]);
  if (domain.length === 0) { res.status(404).json({ error: 'Domain not found' }); return; }

  const parsed = videoSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const ytId = normalizeYouTubeId(parsed.data.ytUrl);
  if (!ytId) { res.status(400).json({ error: 'Invalid YouTube URL or ID' }); return; }

  if (/^(javascript|data):/i.test(parsed.data.ytUrl)) {
    res.status(400).json({ error: 'Invalid YouTube URL or ID' });
    return;
  }

  const { title, difficulty, duration, sequence: rawSeq } = parsed.data;

  let seq: number;
  if (rawSeq !== undefined) {
    seq = rawSeq;
  } else {
    const maxRow = await query<{ max: string }>('SELECT COALESCE(MAX(sequence),0)+1 AS max FROM videos WHERE domain_id=$1', [req.params.id]);
    seq = Number(maxRow[0].max);
  }

  const id = `${req.params.id}-${uuidv4().slice(0, 8)}`;
  await query(
    'INSERT INTO videos(id,domain_id,title,yt_id,difficulty,duration,sequence) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, req.params.id, title, ytId, difficulty, duration, seq]
  );
  res.status(201).json({ id, title, ytId, difficulty, duration, sequence: seq });
});

domainsRouter.delete('/:id/videos/:videoId', requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM videos WHERE id=$1 AND domain_id=$2', [req.params.videoId, req.params.id]);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Video not found' }); return; }
  res.status(204).end();
});

const videoUpdateSchema = z.object({
  title:      z.string().min(1).max(200).optional(),
  ytUrl:      z.string().min(1).optional(),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  duration:   z.string().min(1).max(20).optional(),
  sequence:   z.coerce.number().int().min(1).optional(),
});

domainsRouter.put('/:id/videos/:videoId', requireAdmin, async (req, res) => {
  const existing = await query<VideoRow>('SELECT * FROM videos WHERE id=$1 AND domain_id=$2', [req.params.videoId, req.params.id]);
  if (existing.length === 0) { res.status(404).json({ error: 'Video not found' }); return; }

  const parsed = videoUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  const d = parsed.data;
  if (d.title      !== undefined) { sets.push(`title = $${i++}`);      vals.push(d.title); }
  if (d.difficulty !== undefined) { sets.push(`difficulty = $${i++}`); vals.push(d.difficulty); }
  if (d.duration   !== undefined) { sets.push(`duration = $${i++}`);   vals.push(d.duration); }
  if (d.sequence   !== undefined) { sets.push(`sequence = $${i++}`);   vals.push(d.sequence); }
  if (d.ytUrl      !== undefined) {
    const ytId = normalizeYouTubeId(d.ytUrl);
    if (!ytId) { res.status(400).json({ error: 'Invalid YouTube URL or ID' }); return; }
    sets.push(`yt_id = $${i++}`); vals.push(ytId);
  }
  if (sets.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
  vals.push(req.params.videoId);
  vals.push(req.params.id);
  const result = await pool.query(`UPDATE videos SET ${sets.join(', ')} WHERE id = $${i++} AND domain_id = $${i} RETURNING *`, vals);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Video not found' }); return; }
  const v = result.rows[0] as VideoRow;
  res.json({ id: v.id, title: v.title, ytId: v.yt_id, difficulty: v.difficulty, duration: v.duration, sequence: v.sequence });
});

const seqPatchSchema = z.object({ sequence: z.coerce.number().int().min(1) });

domainsRouter.patch('/:id/videos/:videoId', requireAdmin, async (req, res) => {
  const parsed = seqPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const result = await pool.query(
    'UPDATE videos SET sequence=$1 WHERE id=$2 AND domain_id=$3 RETURNING *',
    [parsed.data.sequence, req.params.videoId, req.params.id]
  );
  if (result.rowCount === 0) { res.status(404).json({ error: 'Video not found' }); return; }
  const v = result.rows[0] as VideoRow;
  res.json({ id: v.id, title: v.title, ytId: v.yt_id, difficulty: v.difficulty, duration: v.duration, sequence: v.sequence });
});

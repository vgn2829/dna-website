import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool, query } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';

export const domainsRouter = Router();

type DomainRow = { id: string; title: string; full_name: string; icon: string; tagline: string; description: string; color: string; display_order: number };
type VideoRow  = { id: string; domain_id: string; title: string; yt_id: string; difficulty: string; duration: string };
type QuizRow   = { id: number; domain_id: string; question: string; options: string; answer_index: number };

domainsRouter.get('/', async (_req, res) => {
  const domains = await query<DomainRow>('SELECT * FROM domains ORDER BY display_order ASC, created_at ASC');
  const videos  = await query<VideoRow>('SELECT * FROM videos ORDER BY created_at ASC');
  const quizzes = await query<QuizRow>('SELECT * FROM quiz_questions ORDER BY id ASC');

  const result: Record<string, object> = {};
  for (const d of domains) {
    result[d.id] = {
      id: d.id, title: d.title, fullName: d.full_name, icon: d.icon,
      tagline: d.tagline, description: d.description, color: d.color,
      videos: videos.filter(v => v.domain_id === d.id)
        .map(v => ({ id: v.id, title: v.title, ytId: v.yt_id, difficulty: v.difficulty, duration: v.duration })),
      quizzes: quizzes.filter(q => q.domain_id === d.id)
        .map(q => {
          let options: string[] = [];
          try { options = JSON.parse(q.options) as string[]; } catch { options = []; }
          return { q: q.question, options, ans: q.answer_index };
        }),
    };
  }
  res.json(result);
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'domain';
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  for (;;) {
    const rows = await query('SELECT 1 FROM domains WHERE id=$1', [slug]);
    if (rows.length === 0) return slug;
    slug = `${base}-${n++}`;
  }
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

  const { title, difficulty, duration } = parsed.data;
  const id = `${req.params.id}-${uuidv4().slice(0, 8)}`;
  await query(
    'INSERT INTO videos(id,domain_id,title,yt_id,difficulty,duration) VALUES($1,$2,$3,$4,$5,$6)',
    [id, req.params.id, title, ytId, difficulty, duration]
  );
  res.status(201).json({ id, title, ytId, difficulty, duration });
});

domainsRouter.delete('/:id/videos/:videoId', requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM videos WHERE id=$1 AND domain_id=$2', [req.params.videoId, req.params.id]);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Video not found' }); return; }
  res.status(204).end();
});

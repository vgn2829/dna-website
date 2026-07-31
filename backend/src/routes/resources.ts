// RESOURCES_PAGE_FEATURE — built for audit item C7 but NOT currently needed by
// the club (frontend ResourcesPage.tsx isn't linked from anywhere active).
// Left in place, fully working, in case a future need — e.g. a blog /
// articles feature — wants this submit-then-approve shape. Not routed to from
// nav; do not extend unless that's decided first.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { pool, query } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { requireStudent } from '../middleware/studentAuth';

export const resourcesRouter = Router();

const submitLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many requests, please slow down.' } });

type ResourceRow = {
  id: string; title: string; url: string; author: string;
  domain_id: string | null; type: 'video' | 'article' | 'course';
  level: 'Beginner' | 'Intermediate' | 'Advanced'; duration_label: string;
  tags: string; display_order: number; submitted_by_roll: string | null;
  approved: boolean; created_at: string; domain_title: string | null;
};

// Only http(s) URLs so a stored value can never become a javascript:/data:
// sink when rendered as an <a href> — same refine pattern already used for
// live_sessions.meet_link in liveSessions.ts.
const httpsUrl = z.string().url().max(500).refine(
  u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } },
  'Resource link must be an https:// URL'
);

function formatResource(row: ResourceRow) {
  let tags: string[] = [];
  try { tags = JSON.parse(row.tags) as string[]; } catch { tags = []; }
  return {
    id: row.id, title: row.title, url: row.url, author: row.author,
    domainId: row.domain_id, domainTitle: row.domain_title,
    type: row.type, level: row.level, durationLabel: row.duration_label,
    tags, displayOrder: row.display_order,
    submittedByRoll: row.submitted_by_roll, approved: row.approved,
    createdAt: row.created_at,
  };
}

const SELECT_WITH_DOMAIN = `
  SELECT r.*, d.title AS domain_title
  FROM resources r
  LEFT JOIN domains d ON d.id = r.domain_id
`;

// GET /api/resources — public, approved only.
resourcesRouter.get('/', async (_req, res) => {
  const rows = await query<ResourceRow>(
    `${SELECT_WITH_DOMAIN} WHERE r.approved = true ORDER BY r.display_order ASC, r.created_at DESC`
  );
  res.json(rows.map(formatResource));
});

// GET /api/resources/pending — admin moderation queue.
resourcesRouter.get('/pending', requireAdmin, async (_req, res) => {
  const rows = await query<ResourceRow>(
    `${SELECT_WITH_DOMAIN} WHERE r.approved = false ORDER BY r.created_at ASC`
  );
  res.json(rows.map(formatResource));
});

const submitSchema = z.object({
  title: z.string().min(1).max(200),
  url: httpsUrl,
  author: z.string().max(100).default(''),
  domainId: z.string().max(100).nullable().optional(),
  type: z.enum(['video', 'article', 'course']),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']),
  durationLabel: z.string().max(50).default(''),
  tags: z.array(z.string().max(50)).max(10).default([]),
});

async function domainExists(domainId: string | null | undefined): Promise<boolean> {
  if (!domainId) return true; // null domain is allowed (uncategorized)
  const rows = await query('SELECT 1 FROM domains WHERE id=$1', [domainId]);
  return rows.length > 0;
}

// POST /api/resources — student submission. Identity comes from the verified
// JWT (requireStudent), never a client-supplied roll number. Starts
// unapproved — invisible on the public GET until an admin approves it.
resourcesRouter.post('/', submitLimiter, requireStudent, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request' }); return; }
  const d = parsed.data;

  if (!(await domainExists(d.domainId))) { res.status(400).json({ error: 'Domain not found' }); return; }

  const id = `res-${uuidv4().slice(0, 8)}`;
  await query(
    `INSERT INTO resources(id,title,url,author,domain_id,type,level,duration_label,tags,submitted_by_roll,approved)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
    [id, d.title, d.url, d.author, d.domainId ?? null, d.type, d.level, d.durationLabel, JSON.stringify(d.tags), req.studentRoll!]
  );

  const rows = await query<ResourceRow>(`${SELECT_WITH_DOMAIN} WHERE r.id=$1`, [id]);
  res.status(201).json(formatResource(rows[0]));
});

// POST /api/resources/admin — admin-authored, immediately live (approved=true,
// no submitted_by_roll), same "admin content ships live" convention as
// domains/team_members.
resourcesRouter.post('/admin', requireAdmin, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request' }); return; }
  const d = parsed.data;

  if (!(await domainExists(d.domainId))) { res.status(400).json({ error: 'Domain not found' }); return; }

  const maxOrder = await query<{ max: number }>('SELECT COALESCE(MAX(display_order),0) AS max FROM resources');
  const displayOrder = (maxOrder[0].max as unknown as number) + 1;

  const id = `res-${uuidv4().slice(0, 8)}`;
  await query(
    `INSERT INTO resources(id,title,url,author,domain_id,type,level,duration_label,tags,display_order,submitted_by_roll,approved)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,true)`,
    [id, d.title, d.url, d.author, d.domainId ?? null, d.type, d.level, d.durationLabel, JSON.stringify(d.tags), displayOrder]
  );

  const rows = await query<ResourceRow>(`${SELECT_WITH_DOMAIN} WHERE r.id=$1`, [id]);
  res.status(201).json(formatResource(rows[0]));
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  url: httpsUrl.optional(),
  author: z.string().max(100).optional(),
  domainId: z.string().max(100).nullable().optional(),
  type: z.enum(['video', 'article', 'course']).optional(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  durationLabel: z.string().max(50).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  approved: z.boolean().optional(),
});

// PUT /api/resources/:id — admin edit, including flipping `approved` (this is
// how a pending submission gets approved — no separate approve endpoint).
resourcesRouter.put('/:id', requireAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request' }); return; }
  const d = parsed.data;

  if (d.domainId !== undefined && !(await domainExists(d.domainId))) {
    res.status(400).json({ error: 'Domain not found' }); return;
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (d.title         !== undefined) { sets.push(`title = $${i++}`);          vals.push(d.title); }
  if (d.url           !== undefined) { sets.push(`url = $${i++}`);            vals.push(d.url); }
  if (d.author        !== undefined) { sets.push(`author = $${i++}`);         vals.push(d.author); }
  if (d.domainId       !== undefined) { sets.push(`domain_id = $${i++}`);      vals.push(d.domainId); }
  if (d.type           !== undefined) { sets.push(`type = $${i++}`);           vals.push(d.type); }
  if (d.level          !== undefined) { sets.push(`level = $${i++}`);          vals.push(d.level); }
  if (d.durationLabel  !== undefined) { sets.push(`duration_label = $${i++}`); vals.push(d.durationLabel); }
  if (d.tags           !== undefined) { sets.push(`tags = $${i++}`);           vals.push(JSON.stringify(d.tags)); }
  if (d.approved       !== undefined) { sets.push(`approved = $${i++}`);       vals.push(d.approved); }
  if (sets.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  vals.push(req.params.id);
  const result = await pool.query(`UPDATE resources SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Resource not found' }); return; }

  const rows = await query<ResourceRow>(`${SELECT_WITH_DOMAIN} WHERE r.id=$1`, [req.params.id]);
  res.json(formatResource(rows[0]));
});

const orderSchema = z.object({ displayOrder: z.coerce.number().int() });

// PATCH /api/resources/:id/order — mirrors team.ts's PATCH /:id/order.
resourcesRouter.patch('/:id/order', requireAdmin, async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'displayOrder must be an integer' }); return; }
  const result = await pool.query(
    'UPDATE resources SET display_order=$1 WHERE id=$2 RETURNING id',
    [parsed.data.displayOrder, req.params.id]
  );
  if (result.rowCount === 0) { res.status(404).json({ error: 'Resource not found' }); return; }
  res.json({ success: true });
});

resourcesRouter.delete('/:id', requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM resources WHERE id=$1', [req.params.id]);
  if (result.rowCount === 0) { res.status(404).json({ error: 'Resource not found' }); return; }
  res.status(204).end();
});

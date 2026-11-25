import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { param } from '../routeParams';
import { getStorage } from '../storage';
import {
  CARD_PROJECTS, DIRECTORY_SORTS, MAX_FEATURED, SHOWCASE_CATEGORIES, SORT_SQL,
  clampLimit, clampOffset, directoryCapabilities, isValidHandle, likePattern, previewBio, type DirectorySort,
} from '../lib/creatorDirectory';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// Creator Discovery (DNA 2.0 Milestone E) — see docs/dna-2.0/CREATOR_DISCOVERY.md.
//
// The directory lists ONLY profiles that are `visibility = 'public'` AND
// `moderation_status = 'active'` (PR #84's designer_profiles). That predicate
// is part of the SQL of every read — search, filters, featured, projects —
// so it is impossible for a filter, a featured row or a project credit to
// surface a private/members/hidden profile, and a visibility change takes
// effect on the very next request (responses are `no-store`).
//
// Every public response is built by an explicit serializer below. Internal
// ids, roll numbers, emails and storage keys are used inside queries only.
// Nothing here fetches a URL, and no profile/identity data is created or
// modified: featuring is a separate, admin-only `creator_features` row.
// ─────────────────────────────────────────────────────────────────────────

const skipInTests = () => process.env.NODE_ENV === 'test' && !process.env.CREATORS_TEST_LIMITS;
const listLimiter = rateLimit({ windowMs: 60_000, max: 60, skip: skipInTests, message: { error: 'Too many requests — please slow down' } });

const PUBLIC = `p.visibility = 'public' AND p.moderation_status = 'active'`;
const mediaUrl = (key: string | null) => (key ? getStorage().getPublicUrl(key) : null);
const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

interface CardRow {
  id: string; handle: string; display_name: string; headline: string | null; bio: string | null;
  avatar_key: string | null; skills: string[]; verified_at: string | null; featured_at: string | null;
  editorial_note?: string | null;
}

async function toCards(rows: CardRow[], withProjects: boolean) {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const [disc, projects] = await Promise.all([
    pool.query(
      `SELECT x.profile_id, d.id, d.title, d.color FROM designer_profile_disciplines x
         JOIN domains d ON d.id = x.domain_id WHERE x.profile_id = ANY($1::text[]) ORDER BY d.display_order, d.title`, [ids]),
    withProjects
      ? pool.query(
        `SELECT * FROM (
           SELECT p.id AS profile_id, sp.slug, sp.title, sp.category, c.role_label, a.public_key,
                  ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY (sp.featured_at IS NULL), sp.published_at DESC, sp.id) AS rn,
                  COUNT(*) OVER (PARTITION BY p.id) AS total
             FROM designer_profiles p
             JOIN showcase_credits c ON c.roll = p.owner_roll AND c.status = 'accepted'
             JOIN showcase_projects sp ON sp.id = c.project_id AND sp.status = 'published'
             LEFT JOIN showcase_assets a ON a.project_id = sp.id AND a.is_cover AND a.public_key IS NOT NULL
            WHERE p.id = ANY($1::text[]) AND ${PUBLIC}
         ) t WHERE rn <= ${CARD_PROJECTS}`, [ids])
      : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
  ]);
  return rows.map(r => {
    const mine = (projects.rows as Array<{ profile_id: string; slug: string; title: string; category: string | null; public_key: string | null; total: string }>).filter(p => p.profile_id === r.id);
    return {
      handle: r.handle,
      displayName: r.display_name,
      headline: r.headline,
      bio: previewBio(r.bio),
      avatarUrl: mediaUrl(r.avatar_key),
      verified: r.verified_at !== null,
      featured: r.featured_at !== null,
      editorialNote: r.featured_at !== null ? (r.editorial_note ?? null) : null,
      skills: r.skills.slice(0, 6),
      disciplines: (disc.rows as Array<{ profile_id: string; id: string; title: string; color: string }>).filter(d => d.profile_id === r.id).map(d => ({ id: d.id, title: d.title, color: d.color })),
      projectCount: mine.length ? Number(mine[0].total) : 0,
      projects: mine.map(p => ({ slug: p.slug, title: p.title, category: p.category, coverUrl: mediaUrl(p.public_key) })),
    };
  });
}

const CARD_COLUMNS = `p.id, p.handle, p.display_name, p.headline, p.bio, p.avatar_key, p.skills, p.verified_at, f.featured_at, f.editorial_note`;
const FROM = `designer_profiles p LEFT JOIN creator_features f ON f.profile_id = p.id`;

// GET /api/creators/capabilities — what this deployment can show (drives UI degradation).
router.get('/capabilities', async (_req, res) => {
  noStore(res);
  try { res.json(await directoryCapabilities()); } catch { res.json({ profiles: false, projects: false, artworkCredits: false }); }
});

// GET /api/creators?q=&discipline=&skill=&category=&sort=&limit=&offset=
router.get('/', listLimiter, async (req: Request, res: Response) => {
  try {
    noStore(res);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'featured';
    if (!(DIRECTORY_SORTS as readonly string[]).includes(sortRaw)) return res.status(400).json({ error: 'Invalid sort' });
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    if (category && !(SHOWCASE_CATEGORIES as readonly string[]).includes(category)) return res.status(400).json({ error: 'Invalid category' });
    const discipline = typeof req.query.discipline === 'string' ? req.query.discipline.slice(0, 100) : '';
    const skill = typeof req.query.skill === 'string' ? req.query.skill.trim().toLowerCase().slice(0, 30) : '';
    const tool = typeof req.query.tool === 'string' ? req.query.tool.trim().toLowerCase().slice(0, 30) : '';
    const department = typeof req.query.department === 'string' ? req.query.department.trim().slice(0, 60) : '';
    const featuredOnly = req.query.featured === '1';
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);

    const caps = await directoryCapabilities();
    if (!caps.profiles || (category && !caps.projects)) return res.json({ creators: [], total: 0, hasMore: false });

    const params: unknown[] = [];
    const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = [PUBLIC];
    if (q) {
      const l = bind(likePattern(q));
      // Public fields only: handle, display name, headline, skills, discipline titles.
      where.push(`(p.handle ILIKE ${l} OR p.display_name ILIKE ${l} OR p.headline ILIKE ${l} OR array_to_string(p.skills, ' ') ILIKE ${l} OR array_to_string(p.tools, ' ') ILIKE ${l}
        OR EXISTS (SELECT 1 FROM designer_profile_disciplines x JOIN domains d ON d.id = x.domain_id WHERE x.profile_id = p.id AND d.title ILIKE ${l}))`);
    }
    if (discipline) where.push(`EXISTS (SELECT 1 FROM designer_profile_disciplines x WHERE x.profile_id = p.id AND x.domain_id = ${bind(discipline)})`);
    if (skill) where.push(`p.skills @> ARRAY[${bind(skill)}]::text[]`);
    if (tool) where.push(`p.tools @> ARRAY[${bind(tool)}]::text[]`);
    if (department) where.push(`lower(p.department) = lower(${bind(department)})`);
    if (featuredOnly) where.push('f.featured_at IS NOT NULL');
    if (category) {
      where.push(`EXISTS (SELECT 1 FROM showcase_credits c JOIN showcase_projects sp ON sp.id = c.project_id
        WHERE c.roll = p.owner_roll AND c.status = 'accepted' AND sp.status = 'published' AND sp.category = ${bind(category)})`);
    }
    const whereSql = where.join(' AND ');
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${FROM} WHERE ${whereSql}`, params)).rows[0].n as number;
    const rows = (await pool.query(
      `SELECT ${CARD_COLUMNS} FROM ${FROM} WHERE ${whereSql} ORDER BY ${SORT_SQL[sortRaw as DirectorySort]} LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, params)).rows as CardRow[];
    res.json({ creators: await toCards(rows, caps.projects), total, hasMore: offset + rows.length < total });
  } catch (err) {
    console.error('Creator directory error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/creators/facets — counts over PUBLIC profiles only.
router.get('/facets', listLimiter, async (_req, res) => {
  try {
    noStore(res);
    const caps = await directoryCapabilities();
    if (!caps.profiles) return res.json({ total: 0, disciplines: [], skills: [], tools: [], departments: [], categories: [] });
    const [total, disc, skills, cats, tools, depts] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM designer_profiles p WHERE ${PUBLIC}`),
      pool.query(`SELECT d.id, d.title, d.color, COUNT(*)::int AS count FROM designer_profile_disciplines x
                    JOIN designer_profiles p ON p.id = x.profile_id AND ${PUBLIC} JOIN domains d ON d.id = x.domain_id
                   GROUP BY d.id, d.title, d.color, d.display_order ORDER BY d.display_order, d.title`),
      pool.query(`SELECT s AS skill, COUNT(*)::int AS count FROM designer_profiles p, unnest(p.skills) s WHERE ${PUBLIC} GROUP BY s ORDER BY count DESC, s LIMIT 40`),
      caps.projects
        ? pool.query(`SELECT sp.category, COUNT(DISTINCT p.id)::int AS count FROM designer_profiles p
                        JOIN showcase_credits c ON c.roll = p.owner_roll AND c.status = 'accepted'
                        JOIN showcase_projects sp ON sp.id = c.project_id AND sp.status = 'published' AND sp.category IS NOT NULL
                       WHERE ${PUBLIC} GROUP BY sp.category`)
        : Promise.resolve({ rows: [] }),
      pool.query(`SELECT t AS tool, COUNT(*)::int AS count FROM designer_profiles p, unnest(p.tools) t WHERE ${PUBLIC} GROUP BY t ORDER BY count DESC, t LIMIT 40`),
      pool.query(`SELECT p.department AS department, COUNT(*)::int AS count FROM designer_profiles p WHERE ${PUBLIC} AND p.department IS NOT NULL AND btrim(p.department) <> '' GROUP BY p.department ORDER BY count DESC, p.department LIMIT 30`),
    ]);
    res.json({ total: total.rows[0].n, disciplines: disc.rows, skills: skills.rows, tools: tools.rows, departments: depts.rows, categories: cats.rows });
  } catch (err) {
    console.error('Creator facets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/creators/featured — admin-featured creators that are STILL public + active.
router.get('/featured', listLimiter, async (_req, res) => {
  try {
    noStore(res);
    const caps = await directoryCapabilities();
    if (!caps.profiles) return res.json({ creators: [] });
    const rows = (await pool.query(
      `SELECT ${CARD_COLUMNS} FROM designer_profiles p JOIN creator_features f ON f.profile_id = p.id
        WHERE ${PUBLIC} ORDER BY (f.display_order IS NULL), f.display_order ASC, f.featured_at DESC, p.handle ASC LIMIT ${MAX_FEATURED}`)).rows as CardRow[];
    res.json({ creators: await toCards(rows, caps.projects) });
  } catch (err) {
    console.error('Featured creators error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Admin: featuring ─────────────────────────────────────────────────────
// Registered BEFORE '/:handle/projects'. Only an admin token passes requireAdmin;
// a student token (even the profile's owner) is rejected, so nobody can feature themselves.

router.get('/admin/list', requireAdmin, async (req, res) => {
  try {
    const caps = await directoryCapabilities();
    if (!caps.profiles) return res.json({ creators: [], total: 0, featuredCount: 0, max: MAX_FEATURED, available: false });
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const params: unknown[] = [];
    const where = [PUBLIC];
    if (q) { params.push(likePattern(q)); where.push(`(p.handle ILIKE $1 OR p.display_name ILIKE $1)`); }
    if (req.query.featured === '1') where.push('f.featured_at IS NOT NULL');
    const rows = (await pool.query(
      `SELECT p.id, p.handle, p.display_name, p.owner_roll, p.verified_at, f.featured_at, f.display_order, f.editorial_note FROM ${FROM}
        WHERE ${where.join(' AND ')} ORDER BY (f.featured_at IS NULL), (f.display_order IS NULL), f.display_order, f.featured_at DESC, lower(p.display_name) LIMIT 100`, params)).rows as Array<CardRow & { owner_roll: string; display_order: number | null }>;
    const featuredCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM designer_profiles p JOIN creator_features f ON f.profile_id = p.id WHERE ${PUBLIC}`)).rows[0].n as number;
    res.json({
      available: true, max: MAX_FEATURED, featuredCount, total: rows.length,
      creators: rows.map(r => ({ id: r.id, handle: r.handle, displayName: r.display_name, ownerRoll: r.owner_roll, verified: r.verified_at !== null, featured: r.featured_at !== null, featuredAt: r.featured_at, displayOrder: r.display_order, editorialNote: r.editorial_note ?? null })),
    });
  } catch (err) {
    console.error('Creator admin list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/admin/:id/featured', requireAdmin, async (req, res) => {
  try {
    const parsed = z.object({ featured: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'featured must be true or false' });
    if (!(await directoryCapabilities()).profiles) return res.status(409).json({ error: 'Creator profiles are not available yet' });
    const id = param(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const p = (await client.query(`SELECT id, visibility, moderation_status FROM designer_profiles WHERE id = $1 FOR UPDATE`, [id])).rows[0] as
        { id: string; visibility: string; moderation_status: string } | undefined;
      if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Creator not found' }); }
      let changed = false;
      if (parsed.data.featured) {
        // Featuring never overrides privacy: only a public, active profile can be featured.
        if (p.visibility !== 'public' || p.moderation_status !== 'active') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Only public creators can be featured' }); }
        const count = (await client.query(`SELECT COUNT(*)::int AS n FROM designer_profiles p JOIN creator_features f ON f.profile_id = p.id WHERE ${PUBLIC} AND p.id <> $1`, [id])).rows[0].n as number;
        const already = (await client.query('SELECT 1 FROM creator_features WHERE profile_id = $1', [id])).rows.length > 0;
        if (!already && count >= MAX_FEATURED) { await client.query('ROLLBACK'); return res.status(409).json({ error: `You can feature up to ${MAX_FEATURED} creators — unfeature one first` }); }
        changed = (await client.query('INSERT INTO creator_features (profile_id) VALUES ($1) ON CONFLICT DO NOTHING', [id])).rowCount === 1;
      } else {
        changed = (await client.query('DELETE FROM creator_features WHERE profile_id = $1', [id])).rowCount === 1;
      }
      if (changed) {
        await client.query(
          `INSERT INTO creator_audit_log (entity_type, entity_id, action, actor_kind, actor_roll, detail) VALUES ('profile', $1, $2, 'admin', NULL, $3::jsonb)`,
          [id, parsed.data.featured ? 'profile.feature' : 'profile.unfeature', JSON.stringify({ featured: parsed.data.featured })]);
      }
      await client.query('COMMIT');
      res.json({ featured: parsed.data.featured, changed });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  } catch (err) {
    console.error('Creator feature error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/creators/admin/:id/featured — edit display order / editorial note of an ALREADY featured creator.
// Admin only, strict body (nothing else is assignable), and never changes who is featured or visible.
router.patch('/admin/:id/featured', requireAdmin, async (req, res) => {
  try {
    const parsed = z.object({
      displayOrder: z.number().int().min(0).max(999).nullable().optional(),
      editorialNote: z.string().trim().max(200).nullable().optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success || (parsed.data.displayOrder === undefined && parsed.data.editorialNote === undefined)) {
      return res.status(400).json({ error: 'Provide displayOrder (0–999 or null) and/or editorialNote (up to 200 characters)' });
    }
    if (!(await directoryCapabilities()).profiles) return res.status(409).json({ error: 'Creator profiles are not available yet' });
    const id = param(req.params.id);
    const sets: string[] = []; const vals: unknown[] = [id];
    if (parsed.data.displayOrder !== undefined) { vals.push(parsed.data.displayOrder); sets.push(`display_order = $${vals.length}`); }
    if (parsed.data.editorialNote !== undefined) { vals.push(parsed.data.editorialNote ? parsed.data.editorialNote : null); sets.push(`editorial_note = $${vals.length}`); }
    const r = await pool.query(`UPDATE creator_features SET ${sets.join(', ')} WHERE profile_id = $1 RETURNING display_order, editorial_note`, vals);
    if (!r.rows.length) return res.status(404).json({ error: 'This creator is not featured' });
    await pool.query(
      `INSERT INTO creator_audit_log (entity_type, entity_id, action, actor_kind, actor_roll, detail) VALUES ('profile', $1, 'profile.feature_edit', 'admin', NULL, $2::jsonb)`,
      [id, JSON.stringify({ displayOrder: r.rows[0].display_order, hasNote: r.rows[0].editorial_note !== null })]);
    res.json({ displayOrder: r.rows[0].display_order, editorialNote: r.rows[0].editorial_note });
  } catch (err) {
    console.error('Creator feature edit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/creators/:handle/projects?limit=&offset= — PUBLISHED projects this creator is credited on
// (accepted credits only). A non-public/hidden/unknown handle is the same 404.
router.get('/:handle/projects', listLimiter, async (req: Request, res: Response) => {
  try {
    noStore(res);
    const handle = param(req.params.handle);
    const caps = await directoryCapabilities();
    if (!isValidHandle(handle) || !caps.profiles) return res.status(404).json({ error: 'Creator not found' });
    const profile = (await pool.query(`SELECT p.id, p.owner_roll FROM designer_profiles p WHERE p.handle = $1 AND ${PUBLIC}`, [handle])).rows[0] as { id: string; owner_roll: string } | undefined;
    if (!profile) return res.status(404).json({ error: 'Creator not found' });
    if (!caps.projects) return res.json({ projects: [], total: 0, hasMore: false });
    const limit = clampLimit(req.query.limit, 12, 24);
    const offset = clampOffset(req.query.offset);
    const base = `FROM showcase_credits c JOIN showcase_projects sp ON sp.id = c.project_id AND sp.status = 'published'
                  LEFT JOIN showcase_assets a ON a.project_id = sp.id AND a.is_cover AND a.public_key IS NOT NULL
                  WHERE c.roll = $1 AND c.status = 'accepted'`;
    const total = (await pool.query(`SELECT COUNT(*)::int AS n ${base}`, [profile.owner_roll])).rows[0].n as number;
    const rows = (await pool.query(
      `SELECT sp.slug, sp.title, sp.summary, sp.category, sp.featured_at, sp.published_at, c.role_label, c.is_owner, a.public_key ${base}
        ORDER BY sp.published_at DESC, sp.id DESC LIMIT $2 OFFSET $3`, [profile.owner_roll, limit, offset])).rows as Array<{
        slug: string; title: string; summary: string | null; category: string | null; featured_at: string | null; published_at: string; role_label: string | null; is_owner: boolean; public_key: string | null }>;
    res.json({
      total, hasMore: offset + rows.length < total,
      projects: rows.map(r => ({ slug: r.slug, title: r.title, summary: r.summary, category: r.category, featured: r.featured_at !== null,
        publishedAt: r.published_at, roleLabel: r.role_label, isOwner: r.is_owner, coverUrl: mediaUrl(r.public_key) })),
    });
  } catch (err) {
    console.error('Creator projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

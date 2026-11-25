import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/client';
import { requireStudent } from '../middleware/studentAuth';
import { requireAdmin } from '../middleware/adminAuth';
import { param } from '../routeParams';
import { getStorage } from '../storage';
import { assetImageUrl, type AssetRow } from './assets';
import {
  OWNER_DELETABLE, OWNER_EDITABLE, SHOWCASE_STATUSES, canTransition, submissionProblems,
  type Actor, type ShowcaseStatus,
} from '../lib/showcaseState';
import {
  LIMITS, SHOWCASE_CATEGORIES, WORK_MIME_TYPES, likePattern, normalizeLinks, normalizeTags, slugify,
} from '../lib/showcaseValidation';
import { copyWorksToPublic, deleteObjects } from '../lib/showcasePublish';
import { identityCapabilities, ownsArtwork, publicProfileHandles } from '../lib/creatorIdentity';
import { accessFor, can, collaboratorList, contentIsEditable, logActivity, type Access, type Permission } from '../lib/showcaseAccess';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────
// Public Project Showcase (DNA 2.0 Milestone D) — see
// docs/dna-2.0/PUBLIC_PROJECT_SHOWCASE.md for the model and rules.
//
//  /projects, /projects/:slug, /facets, /capabilities   PUBLIC (published only)
//  /mine…, /invitations…, /credits…                      student (owner / contributor)
//  /admin…                                               admin only (review, publish, feature)
//
// Invariants enforced here:
//  • Public reads select only status='published' rows and return explicit
//    allowlisted fields — never rolls, emails, asset ids or private URLs.
//  • Every lifecycle change goes through lib/showcaseState.canTransition.
//  • Students can only act on projects they own; a foreign id is a 404.
//  • Publishing COPIES files to a new public key (lib/showcasePublish); no
//    visibility flag is ever flipped.
// ─────────────────────────────────────────────────────────────────────────

// Skipped under NODE_ENV=test unless a test opts in (SHOWCASE_TEST_LIMITS), so suites aren't throttled by one shared IP.
const skipInTest = () => process.env.NODE_ENV === 'test' && !process.env.SHOWCASE_TEST_LIMITS;
const writeLimiter = rateLimit({ windowMs: 60_000, max: 90, skip: skipInTest, message: { error: 'Too many requests — please slow down' } });
const inviteLimiter = rateLimit({ windowMs: 60_000, max: 20, skip: skipInTest, message: { error: 'Too many requests — please slow down' } });

interface ProjectRow {
  id: string; owner_roll: string; slug: string; title: string; summary: string | null; description: string | null;
  category: string | null; tags: string[]; links: Array<{ label: string; url: string }>; status: ShowcaseStatus;
  review_note: string | null; featured_at: string | null; submitted_at: string | null; published_at: string | null;
  created_at: string; updated_at: string;
}
interface WorkRowFull { id: string; project_id: string; asset_id: string | null; caption: string | null; position: number; is_cover: boolean; public_key: string | null; width: number | null; height: number | null; added_by_roll: string | null }
interface CreditRow { id: string; project_id: string; roll: string; role_label: string | null; contribution: string | null; display_name: string | null; position: number; status: 'accepted' | 'pending' | 'declined'; is_owner: boolean; invited_at: string; responded_at: string | null }

const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';
const normRoll = (r: string) => r.trim().toUpperCase();
const publicUrl = (key: string | null) => (key ? getStorage().getPublicUrl(key) : null);

// ── Shared helpers ───────────────────────────────────────────────────────

async function uniqueSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title);
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 70)}-${Math.random().toString(36).slice(2, 6)}`;
    const hit = await pool.query('SELECT 1 FROM showcase_projects WHERE slug = $1 AND ($2::text IS NULL OR id <> $2)', [candidate, excludeId ?? null]);
    if (hit.rows.length === 0) return candidate;
  }
  return `${base.slice(0, 60)}-${uuidv4().slice(0, 8)}`;
}

async function logEvent(db: { query: typeof pool.query }, projectId: string, from: string | null, to: string, kind: 'student' | 'admin' | 'system', roll: string | null, reason?: string | null) {
  await db.query(
    'INSERT INTO showcase_events (project_id, from_status, to_status, actor_kind, actor_roll, reason) VALUES ($1,$2,$3,$4,$5,$6)',
    [projectId, from, to, kind, roll, reason?.trim() || null],
  );
}

async function loadProject(id: string): Promise<ProjectRow | null> {
  return ((await pool.query('SELECT * FROM showcase_projects WHERE id = $1', [id])).rows[0] as ProjectRow | undefined) ?? null;
}
async function loadOwned(id: string, roll: string): Promise<ProjectRow | null> {
  const p = await loadProject(id);
  return p && p.owner_roll === roll ? p : null;
}

/** Loads a project the caller may open as owner / editor / viewer. Anyone else — including a pending invitee — gets null (callers answer 404). */
async function loadAccessible(id: string, roll: string): Promise<{ project: ProjectRow; access: Access } | null> {
  const project = await loadProject(id);
  if (!project) return null;
  const access = await accessFor(project, roll);
  return access ? { project, access } : null;
}

async function projectParts(id: string) {
  const [disc, works, credits] = await Promise.all([
    pool.query('SELECT d.id, d.title FROM showcase_project_disciplines pd JOIN domains d ON d.id = pd.domain_id WHERE pd.project_id = $1 ORDER BY d.display_order, d.title', [id]),
    pool.query('SELECT * FROM showcase_assets WHERE project_id = $1 ORDER BY position, id', [id]),
    pool.query('SELECT * FROM showcase_credits WHERE project_id = $1 ORDER BY is_owner DESC, position, invited_at', [id]),
  ]);
  return { disciplines: disc.rows as Array<{ id: string; title: string }>, works: works.rows as WorkRowFull[], credits: credits.rows as CreditRow[] };
}

/** Applies one lifecycle change atomically (optimistic on the current status) and records the event. */
async function moveProject(p: ProjectRow, to: ShowcaseStatus, actor: Actor, actorRoll: string | null, reason: string | null, extra?: (client: { query: typeof pool.query }) => Promise<void>): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const check = canTransition(p.status, to, actor, reason);
  if (!check.ok) return check;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE showcase_projects SET status = $3, updated_at = NOW(),
         review_note = CASE WHEN $3 IN ('changes_requested','rejected') THEN $4 WHEN $3 IN ('submitted','published') THEN NULL ELSE review_note END,
         submitted_at = CASE WHEN $3 = 'submitted' THEN NOW() ELSE submitted_at END,
         published_at = CASE WHEN $3 = 'published' THEN NOW() ELSE published_at END,
         featured_at = CASE WHEN $3 = 'published' THEN featured_at ELSE NULL END
       WHERE id = $1 AND status = $2`,
      [p.id, p.status, to, reason?.trim() || null],
    );
    if (res.rowCount === 0) { await client.query('ROLLBACK'); return { ok: false, status: 409, error: 'This project was just changed — refresh and try again' }; }
    if (extra) await extra(client);
    await logEvent(client, p.id, p.status, to, actor === 'admin' ? 'admin' : 'student', actorRoll, reason);
    await logActivity(client, p.id, actor === 'admin' ? null : actorRoll, 'status.changed', { from: p.status, to });
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function dropPublicCopies(projectId: string) {
  const keys = (await pool.query('SELECT public_key FROM showcase_assets WHERE project_id = $1 AND public_key IS NOT NULL', [projectId])).rows.map((r: { public_key: string }) => r.public_key);
  await pool.query('UPDATE showcase_assets SET public_key = NULL, public_mime = NULL WHERE project_id = $1', [projectId]);
  await deleteObjects(keys);
}

// ── Public serializers (explicit allowlists) ─────────────────────────────

async function publicCards(rows: ProjectRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const [disc, covers, credits] = await Promise.all([
    pool.query('SELECT pd.project_id, d.id, d.title FROM showcase_project_disciplines pd JOIN domains d ON d.id = pd.domain_id WHERE pd.project_id = ANY($1::text[]) ORDER BY d.display_order, d.title', [ids]),
    pool.query('SELECT project_id, public_key, width, height FROM showcase_assets WHERE project_id = ANY($1::text[]) AND is_cover AND public_key IS NOT NULL', [ids]),
    pool.query(`SELECT * FROM showcase_credits WHERE project_id = ANY($1::text[]) AND status = 'accepted' ORDER BY is_owner DESC, position, invited_at`, [ids]),
  ]);
  const handles = await publicProfileHandles([...new Set((credits.rows as CreditRow[]).map(c => c.roll))]);
  return rows.map(r => ({
    slug: r.slug, title: r.title, summary: r.summary, category: r.category, tags: r.tags,
    featured: !!r.featured_at, publishedAt: r.published_at,
    disciplines: (disc.rows as Array<{ project_id: string; id: string; title: string }>).filter(d => d.project_id === r.id).map(d => ({ id: d.id, title: d.title })),
    cover: (() => { const c = (covers.rows as Array<{ project_id: string; public_key: string; width: number | null; height: number | null }>).find(x => x.project_id === r.id); return c ? { url: publicUrl(c.public_key), width: c.width, height: c.height } : null; })(),
    credits: (credits.rows as CreditRow[]).filter(c => c.project_id === r.id).map(c => ({
      displayName: c.display_name, roleLabel: c.role_label, isOwner: c.is_owner,
      ...(handles.has(c.roll) ? { profile: { handle: handles.get(c.roll) } } : {}),
    })),
  }));
}

// ── PUBLIC ───────────────────────────────────────────────────────────────

router.get('/capabilities', async (_req, res) => {
  try { res.json(await identityCapabilities()); } catch { res.json({ profiles: false, artworkCredits: false }); }
});

// GET /api/showcase/disciplines — the existing `domains` as a light id/title list for pickers and filters.
router.get('/disciplines', async (_req, res) => {
  try {
    res.json({ disciplines: (await pool.query('SELECT id, title FROM domains ORDER BY display_order, title')).rows });
  } catch (err) {
    console.error('Showcase disciplines error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/showcase/projects?q=&category=&discipline=&tag=&featured=1&sort=&limit=&offset=
router.get('/projects', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    if (category && !(SHOWCASE_CATEGORIES as readonly string[]).includes(category)) return res.status(400).json({ error: 'Invalid category' });
    const discipline = typeof req.query.discipline === 'string' ? req.query.discipline.slice(0, 100) : '';
    const tags = normalizeTags(typeof req.query.tag === 'string' ? req.query.tag.split(',').slice(0, 5) : []);
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
    const SORTS: Record<string, string> = {
      newest: 'p.published_at DESC, p.id DESC', oldest: 'p.published_at ASC, p.id ASC',
      title: 'lower(p.title) ASC, p.id ASC', featured: '(p.featured_at IS NULL) ASC, p.featured_at DESC, p.published_at DESC, p.id DESC',
    };
    if (!SORTS[sortRaw]) return res.status(400).json({ error: 'Invalid sort' });
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 48) : 24;
    const offsetRaw = Number(req.query.offset);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.min(Math.floor(offsetRaw), 5000) : 0;

    const params: unknown[] = [];
    const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = [`p.status = 'published'`];
    if (q) { const l = bind(likePattern(q)); where.push(`(p.title ILIKE ${l} OR p.summary ILIKE ${l} OR p.description ILIKE ${l} OR array_to_string(p.tags, ' ') ILIKE ${l})`); }
    if (category) where.push(`p.category = ${bind(category)}`);
    if (discipline) where.push(`EXISTS (SELECT 1 FROM showcase_project_disciplines pd WHERE pd.project_id = p.id AND pd.domain_id = ${bind(discipline)})`);
    if (tags.length) where.push(`p.tags @> ${bind(tags)}::text[]`);
    if (req.query.featured === '1') where.push('p.featured_at IS NOT NULL');
    const whereSql = where.join(' AND ');
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM showcase_projects p WHERE ${whereSql}`, params)).rows[0].n as number;
    const rows = (await pool.query(`SELECT p.* FROM showcase_projects p WHERE ${whereSql} ORDER BY ${SORTS[sortRaw]} LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, params)).rows as ProjectRow[];
    res.json({ projects: await publicCards(rows), total, hasMore: offset + rows.length < total });
  } catch (err) {
    console.error('Showcase list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/showcase/facets — counts over PUBLISHED projects only.
router.get('/facets', async (_req, res) => {
  try {
    const [cats, discs, tags] = await Promise.all([
      pool.query(`SELECT category, COUNT(*)::int AS count FROM showcase_projects WHERE status = 'published' AND category IS NOT NULL GROUP BY category`),
      pool.query(`SELECT d.id, d.title, COUNT(*)::int AS count FROM showcase_project_disciplines pd JOIN showcase_projects p ON p.id = pd.project_id AND p.status = 'published' JOIN domains d ON d.id = pd.domain_id GROUP BY d.id, d.title, d.display_order ORDER BY d.display_order, d.title`),
      pool.query(`SELECT t AS tag, COUNT(*)::int AS count FROM showcase_projects p, unnest(p.tags) t WHERE p.status = 'published' GROUP BY t ORDER BY count DESC, t LIMIT 40`),
    ]);
    res.json({ categories: cats.rows, disciplines: discs.rows, tags: tags.rows });
  } catch (err) {
    console.error('Showcase facets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/showcase/projects/:slug — published only; everything else is a 404.
router.get('/projects/:slug', async (req: Request, res: Response) => {
  try {
    const p = (await pool.query(`SELECT * FROM showcase_projects WHERE slug = $1 AND status = 'published'`, [param(req.params.slug)])).rows[0] as ProjectRow | undefined;
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const [card] = await publicCards([p]);
    const works = (await pool.query('SELECT * FROM showcase_assets WHERE project_id = $1 AND public_key IS NOT NULL ORDER BY position, id', [p.id])).rows as WorkRowFull[];
    const artworks = (await pool.query(
      `SELECT a.id, a.title, a.image_url, a.media_type FROM showcase_artworks sa JOIN artworks a ON a.id = sa.artwork_id WHERE sa.project_id = $1 ORDER BY sa.position`, [p.id],
    )).rows as Array<{ id: string; title: string; image_url: string | null; media_type: string }>;
    res.json({
      ...card,
      description: p.description,
      links: p.links,
      works: works.map(w => ({ url: publicUrl(w.public_key), caption: w.caption, width: w.width, height: w.height })),
      artworks: artworks.map(a => ({ id: a.id, title: a.title, imageUrl: a.image_url, mediaType: a.media_type })),
    });
  } catch (err) {
    console.error('Showcase detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── STUDENT: own projects ────────────────────────────────────────────────

async function ownerView(p: ProjectRow, roll: string, access: Access = 'owner') {
  const parts = await projectParts(p.id);
  const isOwner = access === 'owner';
  const assetIds = parts.works.flatMap(w => (w.asset_id ? [w.asset_id] : []));
  const assets = assetIds.length ? (await pool.query('SELECT * FROM assets WHERE id = ANY($1::text[])', [assetIds])).rows as AssetRow[] : [];
  const boards = (await pool.query('SELECT b.id, b.name FROM showcase_boards sb JOIN boards b ON b.id = sb.board_id WHERE sb.project_id = $1 ORDER BY b.name', [p.id])).rows;
  const artworks = (await pool.query('SELECT a.id, a.title, a.image_url FROM showcase_artworks sa JOIN artworks a ON a.id = sa.artwork_id WHERE sa.project_id = $1 ORDER BY sa.position', [p.id])).rows;
  const events = (await pool.query('SELECT from_status, to_status, actor_kind, reason, created_at FROM showcase_events WHERE project_id = $1 ORDER BY id', [p.id])).rows;
  const owner = parts.credits.find(c => c.is_owner);
  const problems = submissionProblems({
    title: p.title, summary: p.summary, description: p.description, category: p.category,
    disciplineCount: parts.disciplines.length, workCount: parts.works.length, coverCount: parts.works.filter(w => w.is_cover).length,
    pendingCredits: parts.credits.filter(c => c.status === 'pending').length, ownerDisplayName: owner?.display_name ?? null,
    missingSources: parts.works.filter(w => !w.asset_id).length,
  });
  return {
    id: p.id, slug: p.slug, title: p.title, summary: p.summary, description: p.description, category: p.category, tags: p.tags, links: p.links,
    status: p.status, reviewNote: p.review_note, featured: !!p.featured_at, submittedAt: p.submitted_at, publishedAt: p.published_at,
    createdAt: p.created_at, updatedAt: p.updated_at, editable: (OWNER_EDITABLE as readonly string[]).includes(p.status),
    disciplines: parts.disciplines,
    works: parts.works.map(w => {
      const a = assets.find(x => x.id === w.asset_id);
      return {
        id: w.id, assetId: w.asset_id, caption: w.caption, isCover: w.is_cover, position: w.position,
        filename: a?.filename ?? null, previewUrl: a ? assetImageUrl(a) : null, width: a?.width ?? null, height: a?.height ?? null,
        sourceMissing: !w.asset_id, published: !!w.public_key, addedByYou: (w.added_by_roll ?? p.owner_roll) === roll,
      };
    }),
    // Roll numbers are the owner's working data only. Everyone else sees names, and only people who have accepted.
    credits: parts.credits
      .filter(c => isOwner || c.status === 'accepted' || c.roll === roll)
      .map(c => ({ id: c.id, roll: isOwner || c.roll === roll ? c.roll : null, roleLabel: c.role_label, contribution: c.contribution, displayName: c.display_name, status: c.status, isOwner: c.is_owner })),
    access,
    permissions: (['view', 'comment', 'edit_content', 'edit_works', 'remove_any_work', 'edit_references', 'manage_collaborators', 'manage_credits', 'lifecycle', 'delete_project', 'moderate_comments'] as Permission[]).filter(x => can(access, x)),
    contentEditable: contentIsEditable(p.status),
    collaborators: await collaboratorList(p, roll, access),
    // Moodboard links are the owner's private process notes: names and ids stay with the owner.
    boards: isOwner ? boards : [], artworks,
    events: events.map((e: { from_status: string | null; to_status: string; actor_kind: string; reason: string | null; created_at: string }) => ({ from: e.from_status, to: e.to_status, by: e.actor_kind, reason: e.reason, at: e.created_at })),
    problems,
    viewerIsOwner: isOwner,
  };
}

router.get('/mine', requireStudent, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const rows = (await pool.query(
      `SELECT p.*, (SELECT public_key FROM showcase_assets a WHERE a.project_id = p.id AND a.is_cover) AS _k,
              (SELECT asset_id FROM showcase_assets a WHERE a.project_id = p.id AND a.is_cover) AS _asset
       FROM showcase_projects p WHERE p.owner_roll = $1 ORDER BY p.updated_at DESC`, [roll])).rows as Array<ProjectRow & { _asset: string | null }>;
    const assetIds = rows.flatMap(r => (r._asset ? [r._asset] : []));
    const assets = assetIds.length ? (await pool.query('SELECT * FROM assets WHERE id = ANY($1::text[])', [assetIds])).rows as AssetRow[] : [];
    res.json({
      projects: rows.map(r => ({
        id: r.id, slug: r.slug, title: r.title, status: r.status, reviewNote: r.review_note, updatedAt: r.updated_at,
        coverUrl: (() => { const a = assets.find(x => x.id === r._asset); return a ? assetImageUrl(a) : null; })(),
      })),
    });
  } catch (err) {
    console.error('Showcase mine error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const createSchema = z.object({ title: z.string().trim().min(3).max(120) });
router.post('/mine', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Give the project a title (3–120 characters)' });
    const active = (await pool.query(`SELECT COUNT(*)::int AS n FROM showcase_projects WHERE owner_roll = $1 AND status <> 'archived'`, [roll])).rows[0].n as number;
    if (active >= LIMITS.activeProjectsPerStudent) return res.status(400).json({ error: `You can have up to ${LIMITS.activeProjectsPerStudent} active projects — archive or delete one first` });
    const name = ((await pool.query('SELECT name FROM student_sessions WHERE roll_number = $1', [roll])).rows[0] as { name: string | null } | undefined)?.name ?? null;
    const id = uuidv4();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let slug = await uniqueSlug(parsed.data.title);
      for (let i = 0; ; i++) {
        try {
          await client.query('SAVEPOINT s');
          await client.query('INSERT INTO showcase_projects (id, owner_roll, slug, title) VALUES ($1,$2,$3,$4)', [id, roll, slug, parsed.data.title]);
          break;
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT s');
          if (!isUnique(e) || i > 3) throw e;
          slug = `${slugify(parsed.data.title).slice(0, 70)}-${Math.random().toString(36).slice(2, 6)}`;
        }
      }
      await client.query(`INSERT INTO showcase_credits (id, project_id, roll, role_label, display_name, status, is_owner, responded_at) VALUES ($1,$2,$3,'Creator',$4,'accepted',true,NOW())`, [uuidv4(), id, roll, name]);
      await logEvent(client, id, null, 'draft', 'student', roll);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
    res.status(201).json(await ownerView((await loadProject(id))!, roll));
  } catch (err) {
    console.error('Showcase create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/mine/:id', requireStudent, async (req, res) => {
  try {
    const found = await loadAccessible(param(req.params.id), req.studentRoll!);
    if (!found) return res.status(404).json({ error: 'Project not found' });
    res.json(await ownerView(found.project, req.studentRoll!, found.access));
  } catch (err) {
    console.error('Showcase get error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const linkShape = z.object({ label: z.string().max(60).optional(), url: z.string().max(4096) });
const patchSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  summary: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.enum(SHOWCASE_CATEGORIES).nullable().optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  links: z.array(linkShape).max(20).optional(),
  discipline_ids: z.array(z.string().min(1).max(100)).max(20).optional(),
  owner_display_name: z.string().trim().min(1).max(60).optional(),
  owner_role_label: z.string().trim().max(40).nullable().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' });

/**
 * Loads a project for a CONTENT change. Non-members get 404; a member lacking `permission` gets 403;
 * everyone (owner included) gets 409 while the project is frozen for review/publication.
 */
async function requireEditableFor(req: Request, res: Response, permission: Permission): Promise<{ project: ProjectRow; access: Access } | null> {
  const found = await loadAccessible(param(req.params.id), req.studentRoll!);
  if (!found) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (!can(found.access, permission)) { res.status(403).json({ error: 'You don’t have permission to do that on this project' }); return null; }
  if (!contentIsEditable(found.project.status)) {
    res.status(409).json({ error: found.project.status === 'published' ? 'Archive a published project before editing it' : 'Withdraw this submission to edit it' });
    return null;
  }
  return found;
}
/** Owner-only content change (credits, references). Collaborators of any role get the same 404 as strangers would not — they get an honest 403. */
async function requireEditable(req: Request, res: Response): Promise<ProjectRow | null> {
  const found = await requireEditableFor(req, res, 'manage_credits');
  return found?.project ?? null;
}

router.patch('/mine/:id', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const found = await requireEditableFor(req, res, 'edit_content');
    if (!found) return;
    const p = found.project;
    const b = parsed.data;
    // The owner's own public credit (name + role shown on the project) is theirs alone to change.
    if ((b.owner_display_name !== undefined || b.owner_role_label !== undefined) && !can(found.access, 'manage_credits')) {
      return res.status(403).json({ error: 'Only the project owner can change the owner’s credit' });
    }
    let links = p.links;
    if (b.links !== undefined) {
      const cleaned = normalizeLinks(b.links);
      if (!cleaned) return res.status(400).json({ error: `Links must be public http(s) addresses (up to ${LIMITS.links})` });
      links = cleaned;
    }
    if (b.discipline_ids !== undefined) {
      const ids = [...new Set(b.discipline_ids)];
      if (ids.length > LIMITS.disciplines) return res.status(400).json({ error: `Pick up to ${LIMITS.disciplines} disciplines` });
      const ok = ids.length ? (await pool.query('SELECT id FROM domains WHERE id = ANY($1::text[])', [ids])).rows.length : 0;
      if (ok !== ids.length) return res.status(400).json({ error: 'Unknown discipline' });
    }
    const newSlug = b.title !== undefined && p.status === 'draft' && !p.submitted_at ? await uniqueSlug(b.title, p.id) : p.slug;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE showcase_projects SET title=$2, summary=$3, description=$4, category=$5, tags=$6, links=$7::jsonb, slug=$8, updated_at=NOW() WHERE id=$1`,
        [p.id, b.title ?? p.title, b.summary !== undefined ? b.summary : p.summary, b.description !== undefined ? b.description : p.description,
          b.category !== undefined ? b.category : p.category, b.tags !== undefined ? normalizeTags(b.tags) : p.tags, JSON.stringify(links), newSlug],
      );
      if (b.discipline_ids !== undefined) {
        await client.query('DELETE FROM showcase_project_disciplines WHERE project_id = $1', [p.id]);
        for (const d of [...new Set(b.discipline_ids)]) await client.query('INSERT INTO showcase_project_disciplines (project_id, domain_id) VALUES ($1,$2)', [p.id, d]);
      }
      if (b.owner_display_name !== undefined || b.owner_role_label !== undefined) {
        await client.query(
          `UPDATE showcase_credits SET display_name = COALESCE($2, display_name), role_label = CASE WHEN $3::boolean THEN $4 ELSE role_label END WHERE project_id = $1 AND is_owner`,
          [p.id, b.owner_display_name ?? null, b.owner_role_label !== undefined, b.owner_role_label ?? null],
        );
      }
      await logActivity(client, p.id, roll, 'content.updated', { fields: Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined) });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (isUnique(err)) return res.status(409).json({ error: 'Try a slightly different title' });
      throw err;
    } finally { client.release(); }
    res.json(await ownerView((await loadProject(p.id))!, roll, found.access));
  } catch (err) {
    console.error('Showcase patch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /mine/:id/works — replaces the ordered set of works. Sources must be the OWNER'S OWN active image assets.
const worksSchema = z.object({
  works: z.array(z.object({ asset_id: z.string().min(1).max(100), caption: z.string().trim().max(300).nullable().optional(), is_cover: z.boolean().optional() })).max(LIMITS.works),
});
router.put('/mine/:id/works', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = worksSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: `Add up to ${LIMITS.works} images` });
    const found = await requireEditableFor(req, res, 'edit_works');
    if (!found) return;
    const { project: p, access } = found;
    const list = parsed.data.works;
    const ids = list.map(w => w.asset_id);
    if (new Set(ids).size !== ids.length) return res.status(400).json({ error: 'An image was added twice' });
    if (list.filter(w => w.is_cover).length > 1) return res.status(400).json({ error: 'Choose one cover image' });

    const existing = (await pool.query('SELECT * FROM showcase_assets WHERE project_id = $1', [p.id])).rows as WorkRowFull[];
    const byAsset = new Map(existing.filter(w => w.asset_id).map(w => [w.asset_id as string, w]));
    const contributor = (w: WorkRowFull) => w.added_by_roll ?? p.owner_roll;

    // Removing an image: the owner may remove any; anyone else only what they added themselves.
    for (const w of existing) {
      const kept = w.asset_id ? ids.includes(w.asset_id) : false;
      if (!kept && !can(access, 'remove_any_work') && contributor(w) !== roll) {
        return res.status(403).json({ error: 'Only the owner can remove images that someone else added' });
      }
    }

    const assets = ids.length ? (await pool.query('SELECT * FROM assets WHERE id = ANY($1::text[])', [ids])).rows as AssetRow[] : [];
    let total = 0;
    for (const id of ids) {
      const a = assets.find(x => x.id === id);
      const already = byAsset.get(id);
      // A NEW image must be the caller's OWN active Asset Library image (someone else's Community asset is not theirs to showcase).
      // An image already in the project stays valid while its contributor still owns it, whoever is saving the list.
      const requiredOwner = already ? contributor(already) : roll;
      if (!a || a.owner_roll !== requiredOwner || a.status !== 'active' || a.kind !== 'image') return res.status(404).json({ error: 'Image not found in your Asset Library' });
      if (!a.mime_type || !(WORK_MIME_TYPES as readonly string[]).includes(a.mime_type)) return res.status(400).json({ error: 'Showcase images must be PNG, JPG or WebP' });
      if ((a.size_bytes ?? 0) > LIMITS.workBytes) return res.status(400).json({ error: 'Images must be 25 MB or smaller' });
      total += a.size_bytes ?? 0;
    }
    if (total > LIMITS.totalBytes) return res.status(400).json({ error: 'Images add up to more than 100 MB' });
    const coverIdx = list.some(w => w.is_cover) ? list.findIndex(w => w.is_cover) : 0;
    const added = ids.filter(id => !byAsset.has(id)).length;
    const removed = existing.filter(w => !w.asset_id || !ids.includes(w.asset_id)).length;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM showcase_assets WHERE project_id = $1', [p.id]);
      for (let i = 0; i < list.length; i++) {
        const a = assets.find(x => x.id === list[i].asset_id)!;
        const prior = byAsset.get(list[i].asset_id);
        // owner-added images stay NULL (the pre-collaboration meaning); everyone else is recorded by roll.
        const addedBy = prior ? prior.added_by_roll : (roll === p.owner_roll ? null : roll);
        await client.query('INSERT INTO showcase_assets (id, project_id, asset_id, caption, position, is_cover, width, height, added_by_roll) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [uuidv4(), p.id, list[i].asset_id, list[i].caption ?? null, i, i === coverIdx, a.width, a.height, addedBy]);
      }
      await client.query('UPDATE showcase_projects SET updated_at = NOW() WHERE id = $1', [p.id]);
      if (added || removed) await logActivity(client, p.id, roll, 'works.updated', { added, removed });
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
    res.json(await ownerView((await loadProject(p.id))!, roll, access));
  } catch (err) {
    console.error('Showcase works error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /mine/:id/boards — private process references (owner/member boards only; never public).
router.put('/mine/:id/boards', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = z.object({ board_ids: z.array(z.string().min(1).max(100)).max(10) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const p = (await requireEditableFor(req, res, 'edit_references'))?.project;
    if (!p) return;
    const ids = [...new Set(parsed.data.board_ids)];
    const ok = ids.length ? (await pool.query(
      `SELECT id FROM boards WHERE id = ANY($1::text[]) AND (owner_roll = $2 OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = boards.id AND m.roll_number = $2))`, [ids, roll])).rows.length : 0;
    if (ok !== ids.length) return res.status(404).json({ error: 'Moodboard not found' });
    await pool.query('DELETE FROM showcase_boards WHERE project_id = $1', [p.id]);
    for (const b of ids) await pool.query('INSERT INTO showcase_boards (project_id, board_id) VALUES ($1,$2)', [p.id, b]);
    res.json(await ownerView((await loadProject(p.id))!, roll));
  } catch (err) {
    console.error('Showcase boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /mine/:id/artworks — Gallery artworks the caller is CREDITED on (needs PR #84's credits; 403 before then).
router.put('/mine/:id/artworks', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = z.object({ artwork_ids: z.array(z.string().min(1).max(100)).max(12) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const p = (await requireEditableFor(req, res, 'edit_references'))?.project;
    if (!p) return;
    const ids = [...new Set(parsed.data.artwork_ids)];
    for (const id of ids) if (!(await ownsArtwork(roll, id))) return res.status(403).json({ error: 'You can only add artwork you are credited on' });
    await pool.query('DELETE FROM showcase_artworks WHERE project_id = $1', [p.id]);
    for (let i = 0; i < ids.length; i++) await pool.query('INSERT INTO showcase_artworks (project_id, artwork_id, position) VALUES ($1,$2,$3)', [p.id, ids[i], i]);
    res.json(await ownerView((await loadProject(p.id))!, roll));
  } catch (err) {
    console.error('Showcase artworks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Contributors (consent) ───────────────────────────────────────────────

router.post('/mine/:id/credits', requireStudent, inviteLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = z.object({ roll: z.string().trim().min(1).max(30), role_label: z.string().trim().max(40).nullable().optional(), contribution: z.string().trim().max(300).nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a roll number' });
    const p = await requireEditable(req, res);
    if (!p) return;
    const target = normRoll(parsed.data.roll);
    if (target === roll) return res.status(400).json({ error: 'You are already credited as the creator' });
    // Same answer whether the roll is unknown or the student has blocked this owner — no roster probing.
    const exists = await pool.query('SELECT 1 FROM student_sessions WHERE roll_number = $1', [target]);
    const blocked = await pool.query('SELECT 1 FROM showcase_collab_blocks WHERE blocker_roll = $1 AND blocked_roll = $2', [target, roll]);
    if (exists.rows.length === 0 || blocked.rows.length > 0) return res.status(404).json({ error: 'That student can’t be invited to this project' });
    const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM showcase_credits WHERE project_id = $1 AND NOT is_owner AND status <> 'declined'`, [p.id])).rows[0].n as number;
    const prior = (await pool.query('SELECT * FROM showcase_credits WHERE project_id = $1 AND roll = $2', [p.id, target])).rows[0] as CreditRow | undefined;
    if (prior && prior.status !== 'declined') return res.status(409).json({ error: 'Already invited' });
    if (count >= LIMITS.contributors) return res.status(400).json({ error: `Up to ${LIMITS.contributors} contributors` });
    if (prior) await pool.query(`UPDATE showcase_credits SET status='pending', role_label=$2, contribution=$3, display_name=NULL, responded_at=NULL, invited_at=NOW() WHERE id=$1`, [prior.id, parsed.data.role_label ?? null, parsed.data.contribution ?? null]);
    else await pool.query(`INSERT INTO showcase_credits (id, project_id, roll, role_label, contribution, position, status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
      [uuidv4(), p.id, target, parsed.data.role_label ?? null, parsed.data.contribution ?? null, count + 1]);
    res.status(201).json(await ownerView((await loadProject(p.id))!, roll));
  } catch (err) {
    console.error('Showcase invite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Changing a contributor's role/contribution after they accepted needs their fresh consent.
router.patch('/mine/:id/credits/:creditId', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = z.object({ role_label: z.string().trim().max(40).nullable().optional(), contribution: z.string().trim().max(300).nullable().optional() }).refine(v => Object.keys(v).length > 0).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const p = await requireEditable(req, res);
    if (!p) return;
    const c = (await pool.query('SELECT * FROM showcase_credits WHERE id = $1 AND project_id = $2 AND NOT is_owner', [param(req.params.creditId), p.id])).rows[0] as CreditRow | undefined;
    if (!c) return res.status(404).json({ error: 'Contributor not found' });
    await pool.query(
      `UPDATE showcase_credits SET role_label = $2, contribution = $3, status = CASE WHEN status = 'accepted' THEN 'pending' ELSE status END, responded_at = CASE WHEN status = 'accepted' THEN NULL ELSE responded_at END WHERE id = $1`,
      [c.id, parsed.data.role_label !== undefined ? parsed.data.role_label : c.role_label, parsed.data.contribution !== undefined ? parsed.data.contribution : c.contribution]);
    res.json(await ownerView((await loadProject(p.id))!, roll));
  } catch (err) {
    console.error('Showcase credit edit error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/mine/:id/credits/:creditId', requireStudent, writeLimiter, async (req, res) => {
  try {
    const p = await requireEditable(req, res);
    if (!p) return;
    const r = await pool.query('DELETE FROM showcase_credits WHERE id = $1 AND project_id = $2 AND NOT is_owner', [param(req.params.creditId), p.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Contributor not found' });
    res.json(await ownerView((await loadProject(p.id))!, req.studentRoll!));
  } catch (err) {
    console.error('Showcase credit delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// The invited student's side. Never reveals the owner's roll or email.
router.get('/invitations', requireStudent, async (req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT c.id, c.status, c.role_label, c.contribution, c.display_name, p.title, p.status AS project_status,
              (SELECT display_name FROM showcase_credits o WHERE o.project_id = p.id AND o.is_owner) AS owner_name
       FROM showcase_credits c JOIN showcase_projects p ON p.id = c.project_id
       WHERE c.roll = $1 AND NOT c.is_owner AND c.status IN ('pending','accepted') AND p.status NOT IN ('archived','rejected')
       ORDER BY c.invited_at DESC`, [req.studentRoll!])).rows;
    res.json({ invitations: rows.map(r => ({ id: r.id, status: r.status, roleLabel: r.role_label, contribution: r.contribution, displayName: r.display_name, projectTitle: r.title, projectStatus: r.project_status, ownerName: r.owner_name })) });
  } catch (err) {
    console.error('Showcase invitations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function respondToCredit(req: Request, res: Response, accept: boolean) {
  const roll = req.studentRoll!;
  const c = (await pool.query(
    `SELECT c.*, p.status AS project_status FROM showcase_credits c JOIN showcase_projects p ON p.id = c.project_id WHERE c.id = $1 AND c.roll = $2 AND NOT c.is_owner`,
    [param(req.params.id), roll])).rows[0] as (CreditRow & { project_status: ShowcaseStatus }) | undefined;
  if (!c || c.project_status === 'archived' || c.project_status === 'rejected') return res.status(404).json({ error: 'Invitation not found' });
  if (accept) {
    const parsed = z.object({ display_name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter the name you want to be credited as' });
    if (c.status !== 'pending') return res.status(409).json({ error: 'This invitation was already answered' });
    await pool.query(`UPDATE showcase_credits SET status='accepted', display_name=$2, responded_at=NOW() WHERE id=$1`, [c.id, parsed.data.display_name]);
  } else {
    // Declining/leaving is always allowed — it is their name — and removes any public credit immediately.
    await pool.query(`UPDATE showcase_credits SET status='declined', responded_at=NOW() WHERE id=$1`, [c.id]);
  }
  res.json({ success: true });
}
router.post('/invitations/:id/accept', requireStudent, writeLimiter, async (req, res) => { try { await respondToCredit(req, res, true); } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); } });
router.post('/invitations/:id/decline', requireStudent, writeLimiter, async (req, res) => { try { await respondToCredit(req, res, false); } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); } });

// ── Owner lifecycle actions ──────────────────────────────────────────────

async function ownerMove(req: Request, res: Response, to: ShowcaseStatus, beforeMove?: (p: ProjectRow) => Promise<string | null>) {
  const roll = req.studentRoll!;
  const p = await loadOwned(param(req.params.id), roll);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const check = canTransition(p.status, to, 'owner');
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  if (beforeMove) {
    const problem = await beforeMove(p);
    if (problem) return res.status(400).json({ error: problem });
  }
  const moved = await moveProject(p, to, 'owner', roll, null);
  if (!moved.ok) return res.status(moved.status).json({ error: moved.error });
  if (to === 'archived') await dropPublicCopies(p.id);
  res.json(await ownerView((await loadProject(p.id))!, roll));
}

router.post('/mine/:id/submit', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const p = await loadOwned(param(req.params.id), roll);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const check = canTransition(p.status, 'submitted', 'owner');
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    const view = await ownerView(p, roll);
    if (view.problems.length) return res.status(400).json({ error: 'Finish these before submitting', problems: view.problems });
    await ownerMove(req, res, 'submitted');
  } catch (err) { console.error('Showcase submit error:', err); res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/mine/:id/withdraw', requireStudent, writeLimiter, async (req, res) => { try { await ownerMove(req, res, 'draft'); } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); } });
router.post('/mine/:id/archive', requireStudent, writeLimiter, async (req, res) => { try { await ownerMove(req, res, 'archived'); } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); } });
router.post('/mine/:id/reopen', requireStudent, writeLimiter, async (req, res) => { try { await ownerMove(req, res, 'draft'); } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); } });

router.delete('/mine/:id', requireStudent, writeLimiter, async (req, res) => {
  try {
    const p = await loadOwned(param(req.params.id), req.studentRoll!);
    if (!p) return res.status(404).json({ error: 'Project not found' });
    if (!(OWNER_DELETABLE as readonly string[]).includes(p.status)) return res.status(409).json({ error: 'Withdraw or archive this project before deleting it' });
    await dropPublicCopies(p.id);
    await pool.query('DELETE FROM showcase_projects WHERE id = $1', [p.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Showcase delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── ADMIN ────────────────────────────────────────────────────────────────

router.get('/admin/projects', requireAdmin, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !(SHOWCASE_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const params: unknown[] = [];
    const where = [`p.status <> 'draft'`];
    if (status) { params.push(status); where.push(`p.status = $${params.length}`); }
    if (q) { params.push(likePattern(q)); where.push(`p.title ILIKE $${params.length}`); }
    const rows = (await pool.query(
      `SELECT p.id, p.slug, p.title, p.status, p.category, p.featured_at, p.submitted_at, p.published_at, p.updated_at,
              (SELECT display_name FROM showcase_credits c WHERE c.project_id = p.id AND c.is_owner) AS owner_name, p.owner_roll
       FROM showcase_projects p WHERE ${where.join(' AND ')}
       ORDER BY (p.status = 'submitted') DESC, p.submitted_at DESC NULLS LAST, p.updated_at DESC LIMIT 200`, params)).rows;
    res.json({ projects: rows.map(r => ({ id: r.id, slug: r.slug, title: r.title, status: r.status, category: r.category, featured: !!r.featured_at, submittedAt: r.submitted_at, publishedAt: r.published_at, updatedAt: r.updated_at, ownerName: r.owner_name, ownerRoll: r.owner_roll })) });
  } catch (err) {
    console.error('Showcase admin list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/projects/:id', requireAdmin, async (req, res) => {
  try {
    const p = await loadProject(param(req.params.id));
    if (!p) return res.status(404).json({ error: 'Project not found' });
    res.json(await ownerView(p, p.owner_roll));
  } catch (err) {
    console.error('Showcase admin get error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/projects/:id/transition', requireAdmin, async (req, res) => {
  try {
    const parsed = z.object({ to: z.enum(SHOWCASE_STATUSES), reason: z.string().trim().max(1000).nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const p = await loadProject(param(req.params.id));
    if (!p) return res.status(404).json({ error: 'Project not found' });
    const { to, reason } = parsed.data;
    const check = canTransition(p.status, to, 'admin', reason);
    if (!check.ok) return res.status(check.status).json({ error: check.error });

    if (to === 'published') {
      // Re-verify consent, then COPY the files; the status change commits only if every copy succeeded.
      const parts = await projectParts(p.id);
      if (parts.credits.some(c => c.status === 'pending')) return res.status(409).json({ error: 'A contributor has not accepted their credit yet' });
      if (parts.works.length === 0) return res.status(409).json({ error: 'The project has no images' });
      const copied = await copyWorksToPublic(p.id, p.owner_roll, parts.works);
      if (!copied.ok) return res.status(409).json({ error: copied.error });
      const moved = await moveProject(p, 'published', 'admin', null, reason ?? null, async client => {
        for (const c of copied.copies) await client.query('UPDATE showcase_assets SET public_key=$2, public_mime=$3, width=$4, height=$5 WHERE id=$1', [c.workId, c.key, c.mime, c.width, c.height]);
      }).catch(async err => { await deleteObjects(copied.copies.map(c => c.key)); throw err; });
      if (!moved.ok) { await deleteObjects(copied.copies.map(c => c.key)); return res.status(moved.status).json({ error: moved.error }); }
    } else {
      const moved = await moveProject(p, to, 'admin', null, reason ?? null);
      if (!moved.ok) return res.status(moved.status).json({ error: moved.error });
      if (to === 'archived') await dropPublicCopies(p.id);
    }
    res.json(await ownerView((await loadProject(p.id))!, p.owner_roll));
  } catch (err) {
    console.error('Showcase admin transition error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/projects/:id/feature', requireAdmin, async (req, res) => {
  try {
    const parsed = z.object({ featured: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const p = await loadProject(param(req.params.id));
    if (!p) return res.status(404).json({ error: 'Project not found' });
    if (p.status !== 'published') return res.status(409).json({ error: 'Only published projects can be featured' });
    await pool.query('UPDATE showcase_projects SET featured_at = $2 WHERE id = $1', [p.id, parsed.data.featured ? new Date().toISOString() : null]);
    await logEvent(pool, p.id, 'published', 'published', 'admin', null, parsed.data.featured ? 'Featured' : 'Unfeatured');
    res.json(await ownerView((await loadProject(p.id))!, p.owner_roll));
  } catch (err) {
    console.error('Showcase feature error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

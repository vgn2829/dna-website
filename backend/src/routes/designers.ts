import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client';
import { requireStudent, requireVerifiedStudent, optionalStudent } from '../middleware/studentAuth';
import { requireAdmin } from '../middleware/adminAuth';
import { param } from '../routeParams';
import { getStorage } from '../storage';
import { deriveBatch } from '../services/activityService';
import { canViewProfile, writeAudit, type ProfileVisibility } from '../lib/credits';
import {
  bioSchema, checkHandle, departmentSchema, displayNameSchema, headlineSchema, linksSchema,
  normalizeProfileLink, skillsSchema, type LinkKind,
} from '../lib/designerValidation';

export const designersRouter = Router();

// DNA 2.0 Phase 1 profile API (docs/dna-2.0/DNA_2.0_PHASE_1_TECHNICAL_SPEC.md §8.1).
//
// Ownership is ALWAYS derived from the authenticated token (req.studentRoll):
// no self-route takes a profile id, and every body schema is strict(), so an
// owner_roll / profile id / verified flag in a request is a 400, never data.
// Identity-affecting writes use requireVerifiedStudent (OTP-issued token only).
// Responses use explicit projections — never SELECT * and never a row spread.

const HANDLE_RENAME_COOLDOWN_DAYS = 30;
const MAX_DISCIPLINES = 3;

// Per-IP limits. Skipped under NODE_ENV=test (a single test file issues far more
// requests than a person would) unless RATE_LIMIT_IN_TESTS=1, which the
// dedicated rate-limit test sets to prove the limiters are really wired in.
const skipInTests = () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_IN_TESTS !== '1';
const limiter = (windowMs: number, max: number) =>
  rateLimit({ windowMs, max, skip: skipInTests, message: { error: 'Too many requests — please slow down' } });
const writeLimiter = limiter(60 * 1000, 30);
const availabilityLimiter = limiter(5 * 60 * 1000, 30);
const listLimiter = limiter(60 * 1000, 60);

interface ProfileRow {
  id: string; owner_roll: string; handle: string; handle_changed_at: Date | null;
  display_name: string; headline: string | null; bio: string | null; department: string | null;
  show_batch: boolean; skills: string[]; avatar_key: string | null; cover_key: string | null;
  visibility: ProfileVisibility; moderation_status: 'active' | 'hidden';
  verified_at: Date | null; created_at: Date;
}
// Explicit column list: adding a column to the table never changes a response.
const PROFILE_COLUMNS = `id, owner_roll, handle, handle_changed_at, display_name, headline, bio, department,
  show_batch, skills, avatar_key, cover_key, visibility, moderation_status, verified_at, created_at`;

const mediaUrl = (key: string | null) => (key ? getStorage().getPublicUrl(key) : null);

async function childrenOf(profileId: string) {
  const [links, disciplines, works] = await Promise.all([
    pool.query<{ kind: LinkKind; url: string }>(
      'SELECT kind, url FROM designer_profile_links WHERE profile_id = $1 ORDER BY position', [profileId]),
    pool.query<{ id: string; title: string; color: string }>(
      `SELECT d.id, d.title, d.color FROM designer_profile_disciplines x
         JOIN domains d ON d.id = x.domain_id WHERE x.profile_id = $1 ORDER BY d.display_order, d.title`, [profileId]),
    pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM artwork_credits c JOIN artworks a ON a.id = c.artwork_id
        WHERE c.profile_id = $1 AND c.status = 'accepted' AND a.status = 'published'`, [profileId]),
  ]);
  return { links: links.rows, disciplines: disciplines.rows, worksCount: works.rows[0].n };
}

/**
 * The ONLY serializer for what a stranger may see. No id, owner_roll, email,
 * visibility, moderation state or timestamps. Batch is derived from the roll
 * prefix at read time and only when the owner opted in.
 */
function toPublicProfile(row: ProfileRow, kids: Awaited<ReturnType<typeof childrenOf>>) {
  const batch = row.show_batch ? deriveBatch(row.owner_roll) : null;
  return {
    handle: row.handle,
    displayName: row.display_name,
    headline: row.headline,
    bio: row.bio,
    department: row.department,
    batch: batch && batch !== 'Other' ? batch : null,
    verified: row.verified_at !== null,
    avatarUrl: mediaUrl(row.avatar_key),
    coverUrl: mediaUrl(row.cover_key),
    disciplines: kids.disciplines,
    skills: row.skills,
    links: kids.links,
    worksCount: kids.worksCount,
  };
}

function toOwnerProfile(row: ProfileRow, kids: Awaited<ReturnType<typeof childrenOf>>) {
  const cooldownEnds = row.handle_changed_at
    ? new Date(row.handle_changed_at.getTime() + HANDLE_RENAME_COOLDOWN_DAYS * 86_400_000) : null;
  return {
    ...toPublicProfile(row, kids),
    showBatch: row.show_batch,
    visibility: row.visibility,
    moderationStatus: row.moderation_status,
    handleChangeableAt: cooldownEnds && cooldownEnds.getTime() > Date.now() ? cooldownEnds.toISOString() : null,
    createdAt: row.created_at,
  };
}

async function ownProfile(roll: string): Promise<ProfileRow | null> {
  const r = await pool.query<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM designer_profiles WHERE owner_roll = $1`, [roll]);
  return r.rows[0] ?? null;
}
const sendOwner = async (res: Response, row: ProfileRow, status = 200) =>
  res.status(status).json(toOwnerProfile(row, await childrenOf(row.id)));

// A display name equal to a VERIFIED member's name is refused (anti-impersonation).
async function nameBelongsToVerifiedOther(displayName: string, roll: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM designer_profiles WHERE lower(display_name) = lower($1) AND verified_at IS NOT NULL AND owner_roll <> $2 LIMIT 1`,
    [displayName, roll]);
  return r.rows.length > 0;
}

const profileFields = {
  handle: z.string(),
  displayName: displayNameSchema,
  headline: headlineSchema.nullable(),
  bio: bioSchema.nullable(),
  department: departmentSchema.nullable(),
  showBatch: z.boolean(),
};
const createSchema = z.object({
  handle: profileFields.handle, displayName: profileFields.displayName,
  headline: profileFields.headline.optional(), bio: profileFields.bio.optional(),
  department: profileFields.department.optional(), showBatch: profileFields.showBatch.optional(),
}).strict();
const updateSchema = z.object(profileFields).partial().strict().refine(b => Object.keys(b).length > 0);

const pgCode = (err: unknown) => (err as { code?: string }).code;

// ── Owner routes (static paths first so they can never be read as a handle) ──

designersRouter.get('/me', requireStudent, async (req, res) => {
  const row = await ownProfile(req.studentRoll!);
  if (!row) return res.json(null);
  return sendOwner(res, row);
});

designersRouter.post('/me', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid designer profile' });
  const handle = checkHandle(parsed.data.handle);
  if (!handle.ok) return res.status(400).json({ error: handle.reason === 'reserved' ? 'That handle is reserved' : 'Invalid handle' });
  const roll = req.studentRoll!;
  try {
    const account = await pool.query('SELECT 1 FROM student_sessions WHERE roll_number = $1', [roll]);
    if (!account.rows.length) return res.status(403).json({ error: 'Account not found' });
    if (await nameBelongsToVerifiedOther(parsed.data.displayName, roll)) {
      return res.status(409).json({ error: 'That name belongs to a verified member' });
    }
    const d = parsed.data;
    const inserted = await pool.query<ProfileRow>(
      `INSERT INTO designer_profiles(id, owner_roll, handle, display_name, headline, bio, department, show_batch)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${PROFILE_COLUMNS}`,
      [uuidv4(), roll, handle.handle, d.displayName, d.headline ?? null, d.bio ?? null, d.department ?? null, d.showBatch ?? false]);
    return sendOwner(res, inserted.rows[0], 201);
  } catch (err) {
    if (pgCode(err) === '23505') return res.status(409).json({ error: 'Designer profile or handle already exists' });
    if (pgCode(err) === '23503') return res.status(403).json({ error: 'Account not found' });
    throw err;
  }
});

designersRouter.patch('/me', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid designer profile update' });
  const roll = req.studentRoll!;
  const current = await ownProfile(roll);
  if (!current) return res.status(404).json({ error: 'Designer profile not found' });
  const b = parsed.data;

  let handle = current.handle;
  let handleChangedAt = current.handle_changed_at;
  if (b.handle !== undefined) {
    const checked = checkHandle(b.handle);
    if (!checked.ok) return res.status(400).json({ error: checked.reason === 'reserved' ? 'That handle is reserved' : 'Invalid handle' });
    if (checked.handle !== current.handle) {
      const unlocks = current.handle_changed_at
        ? current.handle_changed_at.getTime() + HANDLE_RENAME_COOLDOWN_DAYS * 86_400_000 : 0;
      if (unlocks > Date.now()) {
        return res.status(429).json({ error: 'Handles can be changed once every 30 days', handleChangeableAt: new Date(unlocks).toISOString() });
      }
      handle = checked.handle;
      handleChangedAt = new Date();
    }
  }
  if (b.displayName !== undefined && b.displayName.toLowerCase() !== current.display_name.toLowerCase()
      && await nameBelongsToVerifiedOther(b.displayName, roll)) {
    return res.status(409).json({ error: 'That name belongs to a verified member' });
  }
  try {
    const updated = await pool.query<ProfileRow>(
      `UPDATE designer_profiles SET handle=$2, handle_changed_at=$3, display_name=$4, headline=$5,
              bio=$6, department=$7, show_batch=$8, updated_at=NOW()
        WHERE owner_roll=$1 RETURNING ${PROFILE_COLUMNS}`,
      [roll, handle, handleChangedAt, b.displayName ?? current.display_name,
        b.headline !== undefined ? b.headline : current.headline,
        b.bio !== undefined ? b.bio : current.bio,
        b.department !== undefined ? b.department : current.department,
        b.showBatch ?? current.show_batch]);
    return sendOwner(res, updated.rows[0]);
  } catch (err) {
    if (pgCode(err) === '23505') return res.status(409).json({ error: 'Designer handle already exists' });
    throw err;
  }
});

designersRouter.get('/handle-available', requireStudent, availabilityLimiter, async (req, res) => {
  const checked = checkHandle(req.query.handle);
  if (!checked.ok) return res.json({ available: false, reason: checked.reason });
  const mine = await ownProfile(req.studentRoll!);
  if (mine?.handle === checked.handle) return res.json({ available: true });
  const taken = await pool.query('SELECT 1 FROM designer_profiles WHERE handle = $1', [checked.handle]);
  return res.json(taken.rows.length ? { available: false, reason: 'taken' } : { available: true });
});

designersRouter.put('/me/links', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const parsed = linksSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid links' });
  const links: { kind: LinkKind; url: string }[] = [];
  for (const l of parsed.data.links) {
    const url = normalizeProfileLink(l.kind, l.url);
    if (!url) return res.status(400).json({ error: `Invalid ${l.kind} link` });
    links.push({ kind: l.kind, url });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query<{ id: string }>('SELECT id FROM designer_profiles WHERE owner_roll = $1 FOR UPDATE', [req.studentRoll]);
    if (!p.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Designer profile not found' }); }
    await client.query('DELETE FROM designer_profile_links WHERE profile_id = $1', [p.rows[0].id]);
    for (const [i, l] of links.entries()) {
      await client.query('INSERT INTO designer_profile_links(id, profile_id, kind, url, position) VALUES($1,$2,$3,$4,$5)',
        [uuidv4(), p.rows[0].id, l.kind, l.url, i]);
    }
    await client.query('UPDATE designer_profiles SET updated_at = NOW() WHERE id = $1', [p.rows[0].id]);
    await client.query('COMMIT');
    return res.json({ links });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

designersRouter.put('/me/disciplines', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const parsed = z.object({ domainIds: z.array(z.string().min(1).max(100)).max(MAX_DISCIPLINES) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Choose up to ${MAX_DISCIPLINES} disciplines` });
  const ids = [...new Set(parsed.data.domainIds)];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query<{ id: string }>('SELECT id FROM designer_profiles WHERE owner_roll = $1 FOR UPDATE', [req.studentRoll]);
    if (!p.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Designer profile not found' }); }
    if (ids.length) {
      const known = await client.query('SELECT id FROM domains WHERE id = ANY($1::text[])', [ids]);
      if (known.rows.length !== ids.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Unknown discipline' }); }
    }
    await client.query('DELETE FROM designer_profile_disciplines WHERE profile_id = $1', [p.rows[0].id]);
    for (const id of ids) {
      await client.query('INSERT INTO designer_profile_disciplines(profile_id, domain_id) VALUES($1,$2)', [p.rows[0].id, id]);
    }
    await client.query('UPDATE designer_profiles SET updated_at = NOW() WHERE id = $1', [p.rows[0].id]);
    await client.query('COMMIT');
    return res.json({ domainIds: ids });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

designersRouter.put('/me/skills', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const parsed = z.object({ skills: skillsSchema }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid skills' });
  const r = await pool.query<{ skills: string[] }>(
    'UPDATE designer_profiles SET skills = $2, updated_at = NOW() WHERE owner_roll = $1 RETURNING skills',
    [req.studentRoll, parsed.data.skills]);
  if (!r.rows.length) return res.status(404).json({ error: 'Designer profile not found' });
  return res.json({ skills: r.rows[0].skills });
});

designersRouter.patch('/me/visibility', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const parsed = z.object({ visibility: z.enum(['private', 'members', 'public']) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid visibility' });
  const current = await ownProfile(req.studentRoll!);
  if (!current) return res.status(404).json({ error: 'Designer profile not found' });
  // A moderated profile cannot be re-published by its owner; making it MORE
  // private is always allowed.
  if (current.moderation_status === 'hidden' && parsed.data.visibility !== 'private') {
    return res.status(403).json({ error: 'This profile has been hidden by an administrator' });
  }
  await pool.query('UPDATE designer_profiles SET visibility = $2, updated_at = NOW() WHERE owner_roll = $1',
    [req.studentRoll, parsed.data.visibility]);
  return res.json({ visibility: parsed.data.visibility });
});

// Exactly what a stranger sees right now (ignores the caller's own identity).
designersRouter.get('/me/preview', requireStudent, async (req, res) => {
  const row = await ownProfile(req.studentRoll!);
  if (!row) return res.status(404).json({ error: 'Designer profile not found' });
  return res.json({ ...toPublicProfile(row, await childrenOf(row.id)), visibleToPublic: canViewProfile(row, undefined) });
});

// ── Credit invitations: the credited person decides (consent) ────────────────

designersRouter.get('/me/credits', requireStudent, async (req, res) => {
  const r = await pool.query(
    `SELECT c.id, c.artwork_id AS "artworkId", a.title AS "artworkTitle", c.role, c.role_label AS "roleLabel",
            c.status, c.source, c.created_at AS "createdAt"
       FROM artwork_credits c
       JOIN designer_profiles p ON p.id = c.profile_id
       JOIN artworks a ON a.id = c.artwork_id
      WHERE p.owner_roll = $1 AND a.status <> 'hidden'
      ORDER BY (c.status = 'pending') DESC, c.created_at DESC`, [req.studentRoll]);
  return res.json(r.rows);
});

designersRouter.post('/me/credits/:creditId/respond', requireVerifiedStudent, writeLimiter, async (req, res) => {
  const parsed = z.object({ accept: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid response' });
  const creditId = param(req.params.creditId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The join to owner_roll is the authorization: someone else's credit is "not found".
    const found = await client.query<{ id: string; status: string; is_primary: boolean; artwork_id: string }>(
      `SELECT c.id, c.status, c.is_primary, c.artwork_id FROM artwork_credits c
         JOIN designer_profiles p ON p.id = c.profile_id
        WHERE c.id = $1 AND p.owner_roll = $2 FOR UPDATE OF c`, [creditId, req.studentRoll]);
    const credit = found.rows[0];
    if (!credit) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Credit not found' }); }
    const next = parsed.data.accept ? 'accepted' : 'declined';
    if (credit.status === next) { await client.query('ROLLBACK'); return res.json({ id: credit.id, status: next, changed: false }); }
    // Accepting is only possible from a pending invitation; declining/leaving
    // is always possible, except that a primary creator cannot abandon the work.
    if (parsed.data.accept && credit.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This credit is no longer pending' }); }
    if (!parsed.data.accept && credit.is_primary) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'The primary creator cannot be removed this way — contact an administrator' }); }
    await client.query('UPDATE artwork_credits SET status = $2, responded_at = NOW() WHERE id = $1', [credit.id, next]);
    await writeAudit(client, { entityType: 'credit', entityId: credit.id, action: `credit.${next}`, actor: 'student', actorRoll: req.studentRoll, detail: { artworkId: credit.artwork_id } });
    await client.query('COMMIT');
    return res.json({ id: credit.id, status: next, changed: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// ── Admin moderation (shared admin principal; every change is audited) ───────

designersRouter.get('/admin/list', requireAdmin, async (_req, res) => {
  const r = await pool.query(
    `SELECT id, owner_roll AS "ownerRoll", handle, display_name AS "displayName", visibility,
            moderation_status AS "moderationStatus", verified_at AS "verifiedAt", created_at AS "createdAt"
       FROM designer_profiles ORDER BY created_at DESC LIMIT 500`);
  return res.json(r.rows);
});

designersRouter.patch('/admin/:id', requireAdmin, async (req, res) => {
  const parsed = z.object({ moderationStatus: z.enum(['active', 'hidden']).optional(), verified: z.boolean().optional() })
    .strict().refine(b => Object.keys(b).length > 0).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid moderation update' });
  const id = param(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ moderation_status: string; verified_at: Date | null }>(
      'SELECT moderation_status, verified_at FROM designer_profiles WHERE id = $1 FOR UPDATE', [id]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Designer profile not found' }); }
    const b = parsed.data;
    const was = cur.rows[0];
    const nextStatus = b.moderationStatus ?? was.moderation_status;
    const nextVerified = b.verified === undefined ? was.verified_at !== null : b.verified;
    if (nextStatus !== was.moderation_status) {
      await writeAudit(client, { entityType: 'profile', entityId: id, action: nextStatus === 'hidden' ? 'profile.hide' : 'profile.restore', actor: 'admin' });
    }
    if (nextVerified !== (was.verified_at !== null)) {
      await writeAudit(client, { entityType: 'profile', entityId: id, action: nextVerified ? 'profile.verify' : 'profile.unverify', actor: 'admin' });
    }
    const u = await client.query(
      `UPDATE designer_profiles SET moderation_status = $2,
              verified_at = CASE WHEN $3::boolean THEN COALESCE(verified_at, NOW()) ELSE NULL END, updated_at = NOW()
        WHERE id = $1 RETURNING id, moderation_status AS "moderationStatus", verified_at IS NOT NULL AS verified`,
      [id, nextStatus, nextVerified]);
    await client.query('COMMIT');
    return res.json(u.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// ── Public reads ─────────────────────────────────────────────────────────────

async function visibleProfile(req: Request, res: Response): Promise<ProfileRow | null> {
  const checked = checkHandle(param(req.params.handle));
  const notFound = () => { res.status(404).json({ error: 'Designer profile not found' }); return null; };
  if (!checked.ok) return notFound();
  const r = await pool.query<ProfileRow>(`SELECT ${PROFILE_COLUMNS} FROM designer_profiles WHERE handle = $1`, [checked.handle]);
  const row = r.rows[0];
  // Same 404 whether the profile does not exist or the viewer may not see it.
  if (!row || !canViewProfile(row, req.studentRoll)) return notFound();
  return row;
}

designersRouter.get('/:handle', optionalStudent, listLimiter, async (req, res) => {
  const row = await visibleProfile(req, res);
  if (!row) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.json(toPublicProfile(row, await childrenOf(row.id)));
});

designersRouter.get('/:handle/works', optionalStudent, listLimiter, async (req, res) => {
  const row = await visibleProfile(req, res);
  if (!row) return;
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '24'), 10) || 24, 1), 48);
  // Keyset cursor "<iso>|<id>" over (COALESCE(published_at, created_at), id) DESC.
  // The timestamp round-trips as microsecond text so ties never skip or repeat a row.
  let cursorTs: string | null = null; let cursorId: string | null = null;
  if (typeof req.query.cursor === 'string' && req.query.cursor) {
    const [ts, id] = req.query.cursor.split('|');
    if (!ts || !id || Number.isNaN(Date.parse(ts))) return res.status(400).json({ error: 'Invalid cursor' });
    cursorTs = ts; cursorId = id;
  }
  const r = await pool.query<{ id: string; title: string; domain: string; media_type: string; cover_url: string | null;
    storage_path: string | null; image_url: string | null; role: string; role_label: string | null; ts: string }>(
    `SELECT a.id, a.title, a.domain, a.media_type, a.cover_url, a.storage_path, a.image_url,
            c.role, c.role_label,
            to_char(COALESCE(a.published_at, a.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts
       FROM artwork_credits c JOIN artworks a ON a.id = c.artwork_id
      WHERE c.profile_id = $1 AND c.status = 'accepted' AND a.status = 'published'
        AND ($2::timestamptz IS NULL OR (COALESCE(a.published_at, a.created_at), a.id) < ($2::timestamptz, $3::text))
      ORDER BY COALESCE(a.published_at, a.created_at) DESC, a.id DESC LIMIT $4`,
    [row.id, cursorTs, cursorId, limit + 1]);
  const page = r.rows.slice(0, limit);
  const items = page.map(a => ({
    id: a.id, title: a.title, domain: a.domain, mediaType: a.media_type,
    coverUrl: a.cover_url ?? (a.media_type === 'image' ? (a.storage_path ? getStorage().getPublicUrl(a.storage_path) : a.image_url) : null),
    role: a.role, roleLabel: a.role_label, publishedAt: a.ts,
  }));
  const last = page[page.length - 1];
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ items, next: r.rows.length > limit && last ? `${last.ts}|${last.id}` : null });
});

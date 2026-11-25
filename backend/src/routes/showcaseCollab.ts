import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import type { PoolClient } from 'pg';
import { pool } from '../db/client';
import { requireStudent, requireVerifiedStudent } from '../middleware/studentAuth';
import { param } from '../routeParams';
import { assetImageUrl, type AssetRow } from './assets';
import { LIMITS } from '../lib/showcaseValidation';
import { deleteObjects } from '../lib/showcasePublish';
import {
  accessFor, can, collaboratorList, contentIsEditable, displayNames, logActivity, type Access, type CollabRole,
} from '../lib/showcaseAccess';

// ─────────────────────────────────────────────────────────────────────────
// Project collaboration (DNA 2.0 V1, Milestone F) — mounted at
// /api/showcase/collab. See docs/dna-2.0/COLLABORATION.md.
//
//  • ACCESS is separate from public ATTRIBUTION. Accepting an invitation gives
//    access; being named publicly still needs the person's own credit consent
//    (showcase_credits, unchanged). Removing someone's access never deletes a
//    credit they accepted; they can withdraw that credit themselves at any time.
//  • Every decision goes through lib/showcaseAccess (one matrix, one resolver).
//    Non-members get 404 so a project's existence is never revealed.
//  • Invitations are not enumeration oracles: an unknown, ineligible, blocking
//    or self-targeted invitee all get the same answer.
//  • No roll number, email or comment text is ever written to activity or sent
//    to anyone but the owner (rolls) — collaborators see names.
// ─────────────────────────────────────────────────────────────────────────

const router = Router();

const skipInTest = () => process.env.NODE_ENV === 'test' && !process.env.SHOWCASE_TEST_LIMITS;
const msg = { error: 'Too many requests — please slow down' };
const writeLimiter = rateLimit({ windowMs: 60_000, max: 60, skip: skipInTest, message: msg });
const inviteLimiter = rateLimit({
  windowMs: 60_000, max: 10, skip: skipInTest, message: msg,
  // Per signed-in student, so one person cannot probe the roster by rotating IPs or hide behind a shared one.
  keyGenerator: req => `invite:${(req as Request).studentRoll ?? 'anon'}`,
});
const commentLimiter = rateLimit({ windowMs: 60_000, max: 20, skip: skipInTest, message: msg, keyGenerator: req => `comment:${(req as Request).studentRoll ?? 'anon'}` });

export const COLLAB_LIMITS = {
  activeCollaborators: 10,        // pending + accepted, per project
  invitesPerDay: 30,              // per inviter, any project (DB-backed: survives restarts and multiple instances)
  declineCooldownDays: 7,         // an owner cannot re-invite someone who declined for a week
  commentChars: 2000,
  pageSize: 30,
} as const;

const GENERIC_INVITE_ERROR = 'That student can’t be invited to this project';
const isDeadProject = (status: string) => status === 'archived' || status === 'rejected';

interface ProjectRow { id: string; owner_roll: string; title: string; status: string }
interface CollabRow { id: string; project_id: string; roll: string; access_role: CollabRole; status: string; invited_by: string; invited_at: string; responded_at: string | null }

const loadProject = async (id: string) =>
  ((await pool.query('SELECT id, owner_roll, title, status FROM showcase_projects WHERE id = $1', [id])).rows[0] as ProjectRow | undefined) ?? null;

/** Loads the project and the caller's access, or answers 404 (non-members) — never reveals existence. */
async function member(req: Request, res: Response): Promise<{ project: ProjectRow; access: Access } | null> {
  const project = await loadProject(param(req.params.id));
  const access = project ? await accessFor(project, req.studentRoll!) : null;
  if (!project || !access) { res.status(404).json({ error: 'Project not found' }); return null; }
  return { project, access };
}
/** Owner-only: collaborators get an honest 403, strangers the same 404 as everywhere. */
async function ownerOnly(req: Request, res: Response): Promise<ProjectRow | null> {
  const m = await member(req, res);
  if (!m) return null;
  if (!can(m.access, 'manage_collaborators')) { res.status(403).json({ error: 'Only the project owner can do that' }); return null; }
  return m.project;
}

const fail = (res: Response, err: unknown, where: string) => {
  console.error(`Showcase collab ${where} error:`, err);
  res.status(500).json({ error: 'Internal server error' });
};

// ── Discovery: what's waiting for me / shared with me ────────────────────

router.get('/invitations', requireStudent, async (req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT c.id, c.access_role, c.invited_at, p.title, p.status, p.owner_roll,
              (SELECT COUNT(*)::int FROM showcase_credits k WHERE k.project_id = p.id AND k.roll = c.roll AND k.status = 'pending' AND NOT k.is_owner) AS credit_pending,
              (SELECT k.role_label FROM showcase_credits k WHERE k.project_id = p.id AND k.roll = c.roll AND k.status = 'pending' AND NOT k.is_owner) AS credit_role
         FROM showcase_collaborators c JOIN showcase_projects p ON p.id = c.project_id
        WHERE c.roll = $1 AND c.status = 'pending' AND p.status NOT IN ('archived','rejected')
        ORDER BY c.invited_at DESC`, [req.studentRoll!])).rows as Array<{ id: string; access_role: CollabRole; invited_at: string; title: string; status: string; owner_roll: string; credit_pending: number; credit_role: string | null }>;
    const names = await displayNames(rows.map(r => r.owner_roll));
    res.json({ invitations: rows.map(r => ({
      id: r.id, accessRole: r.access_role, invitedAt: r.invited_at, projectTitle: r.title, projectStatus: r.status,
      ownerName: names.get(r.owner_roll) ?? 'A DnA member', creditProposed: r.credit_pending > 0, creditRole: r.credit_role,
    })) });
  } catch (err) { fail(res, err, 'invitations'); }
});

router.get('/shared', requireStudent, async (req, res) => {
  try {
    const rows = (await pool.query(
      `SELECT p.id, p.slug, p.title, p.status, p.updated_at, p.owner_roll, c.access_role,
              (SELECT asset_id FROM showcase_assets a WHERE a.project_id = p.id AND a.is_cover) AS _asset
         FROM showcase_collaborators c JOIN showcase_projects p ON p.id = c.project_id
        WHERE c.roll = $1 AND c.status = 'accepted' AND p.status <> 'archived'
        ORDER BY p.updated_at DESC`, [req.studentRoll!])).rows as Array<{ id: string; slug: string; title: string; status: string; updated_at: string; owner_roll: string; access_role: CollabRole; _asset: string | null }>;
    const names = await displayNames(rows.map(r => r.owner_roll));
    const assetIds = rows.flatMap(r => (r._asset ? [r._asset] : []));
    const assets = assetIds.length ? (await pool.query('SELECT * FROM assets WHERE id = ANY($1::text[])', [assetIds])).rows as AssetRow[] : [];
    res.json({ projects: rows.map(r => {
      const a = assets.find(x => x.id === r._asset);
      return { id: r.id, slug: r.slug, title: r.title, status: r.status, updatedAt: r.updated_at, accessRole: r.access_role, ownerName: names.get(r.owner_roll) ?? 'A DnA member', coverUrl: a ? assetImageUrl(a) : null };
    }) });
  } catch (err) { fail(res, err, 'shared'); }
});

// ── Owner: invite / change role / withdraw / remove ──────────────────────

const inviteSchema = z.object({
  handle: z.string().trim().toLowerCase().min(3).max(30).optional(),
  roll: z.string().trim().min(1).max(30).optional(),
  access_role: z.enum(['editor', 'viewer']),
  // Optional: propose a public credit alongside the access. The person still has to accept it themselves.
  role_label: z.string().trim().max(40).nullable().optional(),
  contribution: z.string().trim().max(300).nullable().optional(),
}).strict().refine(v => (v.handle ? 1 : 0) + (v.roll ? 1 : 0) === 1, { message: 'Give either a username or a roll number' });

/** Resolves who to invite WITHOUT revealing why a lookup failed. Usernames only resolve for public, active profiles. */
async function resolveInvitee(input: { handle?: string; roll?: string }): Promise<string | null> {
  if (input.handle) {
    const r = await pool.query(`SELECT owner_roll FROM designer_profiles WHERE handle = $1 AND visibility = 'public' AND moderation_status = 'active'`, [input.handle]);
    return (r.rows[0]?.owner_roll as string | undefined) ?? null;
  }
  const roll = input.roll!.trim().toUpperCase();
  const r = await pool.query('SELECT roll_number FROM student_sessions WHERE roll_number = $1', [roll]);
  return (r.rows[0]?.roll_number as string | undefined) ?? null;
}

router.post('/projects/:id/collaborators', requireVerifiedStudent, inviteLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a student and a role' });
    const project = await ownerOnly(req, res);
    if (!project) return;
    if (!contentIsEditable(project.status as never)) return res.status(409).json({ error: 'Withdraw this submission to invite people' });

    const target = await resolveInvitee(parsed.data);
    const blocked = target ? (await pool.query('SELECT 1 FROM showcase_collab_blocks WHERE blocker_roll = $1 AND blocked_roll = $2', [target, roll])).rows.length > 0 : false;
    if (!target || target === roll || blocked) return res.status(404).json({ error: GENERIC_INVITE_ERROR });

    const daily = (await pool.query(`SELECT COUNT(*)::int AS n FROM showcase_collaborators WHERE invited_by = $1 AND invited_at > NOW() - INTERVAL '24 hours'`, [roll])).rows[0].n as number;
    if (daily >= COLLAB_LIMITS.invitesPerDay) return res.status(429).json({ error: 'You’ve sent a lot of invitations today — try again tomorrow' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialise concurrent invites to one project so the cap and the duplicate check cannot be raced past.
      await client.query('SELECT id FROM showcase_projects WHERE id = $1 FOR UPDATE', [project.id]);
      const prior = (await client.query('SELECT * FROM showcase_collaborators WHERE project_id = $1 AND roll = $2', [project.id, target])).rows[0] as CollabRow | undefined;
      if (prior && (prior.status === 'pending' || prior.status === 'accepted')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: prior.status === 'pending' ? 'Already invited — waiting for their reply' : 'Already on this project' });
      }
      if (prior?.status === 'declined' && prior.responded_at && Date.now() - new Date(prior.responded_at).getTime() < COLLAB_LIMITS.declineCooldownDays * 86_400_000) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: GENERIC_INVITE_ERROR });     // indistinguishable from "can't invite": they said no recently
      }
      const active = (await client.query(`SELECT COUNT(*)::int AS n FROM showcase_collaborators WHERE project_id = $1 AND status IN ('pending','accepted')`, [project.id])).rows[0].n as number;
      if (active >= COLLAB_LIMITS.activeCollaborators) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Up to ${COLLAB_LIMITS.activeCollaborators} collaborators per project` });
      }
      let id = prior?.id ?? uuidv4();
      if (prior) {
        await client.query(`UPDATE showcase_collaborators SET access_role=$2, status='pending', invited_by=$3, invited_at=NOW(), responded_at=NULL, updated_at=NOW() WHERE id=$1`, [prior.id, parsed.data.access_role, roll]);
      } else {
        await client.query(`INSERT INTO showcase_collaborators (id, project_id, roll, access_role, status, invited_by) VALUES ($1,$2,$3,$4,'pending',$5)`, [id, project.id, target, parsed.data.access_role, roll]);
      }
      // Optional public-credit proposal (reuses showcase_credits and its consent rules verbatim).
      if (parsed.data.role_label || parsed.data.contribution) {
        const credit = (await client.query('SELECT * FROM showcase_credits WHERE project_id = $1 AND roll = $2', [project.id, target])).rows[0] as { id: string; status: string } | undefined;
        const creditCount = (await client.query(`SELECT COUNT(*)::int AS n FROM showcase_credits WHERE project_id = $1 AND NOT is_owner AND status <> 'declined'`, [project.id])).rows[0].n as number;
        if (!credit || credit.status === 'declined') {
          if (creditCount < LIMITS.contributors) {
            if (credit) await client.query(`UPDATE showcase_credits SET status='pending', role_label=$2, contribution=$3, display_name=NULL, responded_at=NULL, invited_at=NOW() WHERE id=$1`, [credit.id, parsed.data.role_label ?? null, parsed.data.contribution ?? null]);
            else await client.query(`INSERT INTO showcase_credits (id, project_id, roll, role_label, contribution, position, status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`, [uuidv4(), project.id, target, parsed.data.role_label ?? null, parsed.data.contribution ?? null, creditCount + 1]);
          }
        }
      }
      const names = await displayNames([target]);
      await logActivity(client, project.id, roll, 'collaborator.invited', { name: names.get(target) ?? 'A DnA member', role: parsed.data.access_role });
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
    res.status(201).json({ collaborators: await collaboratorList(project, roll, 'owner') });
  } catch (err) { fail(res, err, 'invite'); }
});

router.patch('/projects/:id/collaborators/:cid', requireVerifiedStudent, writeLimiter, async (req, res) => {
  try {
    const parsed = z.object({ access_role: z.enum(['editor', 'viewer']) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose editor or viewer' });
    const project = await ownerOnly(req, res);
    if (!project) return;
    const row = (await pool.query(`UPDATE showcase_collaborators SET access_role = $3, updated_at = NOW()
        WHERE id = $1 AND project_id = $2 AND status IN ('pending','accepted') AND access_role <> $3 RETURNING roll`, [param(req.params.cid), project.id, parsed.data.access_role])).rows[0] as { roll: string } | undefined;
    if (!row) {
      const exists = (await pool.query(`SELECT 1 FROM showcase_collaborators WHERE id = $1 AND project_id = $2 AND status IN ('pending','accepted')`, [param(req.params.cid), project.id])).rows.length > 0;
      if (!exists) return res.status(404).json({ error: 'Collaborator not found' });
      // Already that role: idempotent success.
    } else {
      const names = await displayNames([row.roll]);
      await logActivity(pool, project.id, req.studentRoll!, 'collaborator.role_changed', { name: names.get(row.roll) ?? 'A DnA member', role: parsed.data.access_role });
    }
    res.json({ collaborators: await collaboratorList(project, req.studentRoll!, 'owner') });
  } catch (err) { fail(res, err, 'role'); }
});

/**
 * A credit that was only ever PROPOSED (never accepted) belongs to the invitation that carried it. When the invitation
 * ends — withdrawn, declined, removed or left — the proposal goes with it, otherwise it would sit pending forever and
 * block the owner from submitting. An ACCEPTED credit is the person's own consent and is never touched here.
 */
async function dropProposedCredit(client: PoolClient, projectId: string, roll: string): Promise<void> {
  await client.query(`DELETE FROM showcase_credits WHERE project_id = $1 AND roll = $2 AND status = 'pending' AND NOT is_owner`, [projectId, roll]);
}

/**
 * Takes back everything a person contributed to the project: images they added are removed (so their private
 * Asset Library files can no longer be published under this project), the cover is re-chosen, and a project that
 * no longer has any image is pulled out of review/publication. Their ACCEPTED CREDIT is deliberately left alone.
 */
async function withdrawContributions(client: PoolClient, project: ProjectRow, roll: string): Promise<{ removedWorks: number; demoted: boolean; staleKeys: string[] }> {
  const gone = (await client.query('DELETE FROM showcase_assets WHERE project_id = $1 AND added_by_roll = $2 RETURNING is_cover, public_key', [project.id, roll])).rows as Array<{ is_cover: boolean; public_key: string | null }>;
  const staleKeys = gone.flatMap(g => (g.public_key ? [g.public_key] : []));
  let demoted = false;
  if (gone.length > 0) {
    const left = (await client.query('SELECT id, is_cover FROM showcase_assets WHERE project_id = $1 ORDER BY position, id', [project.id])).rows as Array<{ id: string; is_cover: boolean }>;
    if (left.length > 0 && !left.some(l => l.is_cover)) await client.query('UPDATE showcase_assets SET is_cover = true WHERE id = $1', [left[0].id]);
    if (left.length === 0 && ['submitted', 'approved', 'published'].includes(project.status)) {
      await client.query(`UPDATE showcase_projects SET status = 'draft', featured_at = NULL, updated_at = NOW() WHERE id = $1`, [project.id]);
      await client.query(`INSERT INTO showcase_events (project_id, from_status, to_status, actor_kind, actor_roll, reason) VALUES ($1,$2,'draft','system',NULL,$3)`, [project.id, project.status, 'A contributor withdrew their images']);
      demoted = true;
    } else {
      await client.query('UPDATE showcase_projects SET updated_at = NOW() WHERE id = $1', [project.id]);
    }
  }
  return { removedWorks: gone.length, demoted, staleKeys };
}

router.delete('/projects/:id/collaborators/:cid', requireVerifiedStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const project = await ownerOnly(req, res);
    if (!project) return;
    const client = await pool.connect();
    let staleKeys: string[] = [];
    try {
      await client.query('BEGIN');
      const c = (await client.query(`SELECT * FROM showcase_collaborators WHERE id = $1 AND project_id = $2 AND status IN ('pending','accepted') FOR UPDATE`, [param(req.params.cid), project.id])).rows[0] as CollabRow | undefined;
      if (!c) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Collaborator not found' }); }
      const next = c.status === 'pending' ? 'withdrawn' : 'removed';
      await client.query(`UPDATE showcase_collaborators SET status = $2, responded_at = NOW(), updated_at = NOW() WHERE id = $1`, [c.id, next]);
      let removedWorks = 0;
      if (next === 'removed') { const w = await withdrawContributions(client, project, c.roll); removedWorks = w.removedWorks; staleKeys = w.staleKeys; }
      await dropProposedCredit(client, project.id, c.roll);
      const names = await displayNames([c.roll]);
      await logActivity(client, project.id, roll, next === 'withdrawn' ? 'collaborator.withdrawn' : 'collaborator.removed', { name: names.get(c.roll) ?? 'A DnA member', removedWorks });
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
    await deleteObjects(staleKeys);
    res.json({ collaborators: await collaboratorList(project, roll, 'owner') });
  } catch (err) { fail(res, err, 'remove'); }
});

// ── Invitee: accept / decline (+block) / leave ───────────────────────────

router.post('/invitations/:id/accept', requireVerifiedStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = z.object({ display_name: z.string().trim().min(1).max(60).optional() }).strict().safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Enter the name you want to be credited as' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const c = (await client.query(
        `SELECT c.*, p.title, p.status AS project_status FROM showcase_collaborators c JOIN showcase_projects p ON p.id = c.project_id
          WHERE c.id = $1 AND c.roll = $2 FOR UPDATE OF c`, [param(req.params.id), roll])).rows[0] as (CollabRow & { project_status: string }) | undefined;
      if (!c || isDeadProject(c.project_status)) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Invitation not found' }); }
      if (c.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This invitation is no longer open' }); }
      await client.query(`UPDATE showcase_collaborators SET status = 'accepted', responded_at = NOW(), updated_at = NOW() WHERE id = $1`, [c.id]);
      // Access and public credit are separate consents: the name is only given (and the credit only accepted) if they typed one here.
      let credited = false;
      if (parsed.data.display_name) {
        const r = await client.query(`UPDATE showcase_credits SET status='accepted', display_name=$3, responded_at=NOW() WHERE project_id=$1 AND roll=$2 AND status='pending' AND NOT is_owner`, [c.project_id, roll, parsed.data.display_name]);
        credited = (r.rowCount ?? 0) > 0;
      }
      const names = await displayNames([roll]);
      await logActivity(client, c.project_id, roll, 'collaborator.accepted', { name: names.get(roll) ?? 'A DnA member', role: c.access_role, credited });
      await client.query('COMMIT');
      res.json({ success: true, projectId: c.project_id, credited });
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  } catch (err) { fail(res, err, 'accept'); }
});

router.post('/invitations/:id/decline', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const parsed = z.object({ block: z.boolean().optional() }).strict().safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const c = (await client.query(`SELECT * FROM showcase_collaborators WHERE id = $1 AND roll = $2 FOR UPDATE`, [param(req.params.id), roll])).rows[0] as CollabRow | undefined;
      if (!c) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Invitation not found' }); }
      if (c.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'This invitation is no longer open' }); }
      await client.query(`UPDATE showcase_collaborators SET status = 'declined', responded_at = NOW(), updated_at = NOW() WHERE id = $1`, [c.id]);
      await dropProposedCredit(client, c.project_id, roll);
      if (parsed.data.block) {
        await client.query(`INSERT INTO showcase_collab_blocks (id, blocker_roll, blocked_roll) VALUES ($1,$2,$3) ON CONFLICT (blocker_roll, blocked_roll) DO NOTHING`, [uuidv4(), roll, c.invited_by]);
      }
      const names = await displayNames([roll]);
      await logActivity(client, c.project_id, roll, 'collaborator.declined', { name: names.get(roll) ?? 'A DnA member' });
      await client.query('COMMIT');
      res.json({ success: true, blocked: parsed.data.block === true });
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  } catch (err) { fail(res, err, 'decline'); }
});

/** A collaborator can always leave — it is their access and their images. */
router.post('/projects/:id/leave', requireStudent, writeLimiter, async (req, res) => {
  try {
    const roll = req.studentRoll!;
    const project = await loadProject(param(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.owner_roll === roll) return res.status(400).json({ error: 'The owner can’t leave their own project — archive or delete it instead' });
    const client = await pool.connect();
    let staleKeys: string[] = [];
    try {
      await client.query('BEGIN');
      const c = (await client.query(`SELECT * FROM showcase_collaborators WHERE project_id = $1 AND roll = $2 AND status = 'accepted' FOR UPDATE`, [project.id, roll])).rows[0] as CollabRow | undefined;
      if (!c) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Project not found' }); }
      await client.query(`UPDATE showcase_collaborators SET status = 'removed', responded_at = NOW(), updated_at = NOW() WHERE id = $1`, [c.id]);
      const w = await withdrawContributions(client, project, roll);
      staleKeys = w.staleKeys;
      await dropProposedCredit(client, project.id, roll);
      const names = await displayNames([roll]);
      await logActivity(client, project.id, roll, 'collaborator.left', { name: names.get(roll) ?? 'A DnA member', removedWorks: w.removedWorks });
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
    await deleteObjects(staleKeys);
    res.json({ success: true });
  } catch (err) { fail(res, err, 'leave'); }
});

// ── Blocks (invitee side) ────────────────────────────────────────────────

router.get('/blocks', requireStudent, async (req, res) => {
  try {
    const rows = (await pool.query('SELECT id, blocked_roll FROM showcase_collab_blocks WHERE blocker_roll = $1 ORDER BY created_at DESC', [req.studentRoll!])).rows as Array<{ id: string; blocked_roll: string }>;
    const names = await displayNames(rows.map(r => r.blocked_roll));
    res.json({ blocks: rows.map(r => ({ id: r.id, name: names.get(r.blocked_roll) ?? 'A DnA member' })) });
  } catch (err) { fail(res, err, 'blocks'); }
});
router.delete('/blocks/:id', requireStudent, writeLimiter, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM showcase_collab_blocks WHERE id = $1 AND blocker_roll = $2', [param(req.params.id), req.studentRoll!]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { fail(res, err, 'unblock'); }
});

// ── Activity feed ────────────────────────────────────────────────────────

// Detail keys that may leave the server. Anything else a future writer adds is dropped, not leaked.
const ACTIVITY_DETAIL_KEYS = ['name', 'role', 'from', 'to', 'added', 'removed', 'removedWorks', 'fields', 'credited'] as const;

router.get('/projects/:id/activity', requireStudent, async (req, res) => {
  try {
    const m = await member(req, res);
    if (!m || !can(m.access, 'view')) return;
    const before = Number(req.query.before);
    const rows = (await pool.query(
      `SELECT id, actor_roll, kind, detail, created_at FROM showcase_activity
        WHERE project_id = $1 ${Number.isFinite(before) && before > 0 ? 'AND id < $3' : ''} ORDER BY id DESC LIMIT $2`,
      Number.isFinite(before) && before > 0 ? [m.project.id, COLLAB_LIMITS.pageSize + 1, before] : [m.project.id, COLLAB_LIMITS.pageSize + 1])).rows as
      Array<{ id: string; actor_roll: string | null; kind: string; detail: Record<string, unknown> | null; created_at: string }>;
    const page = rows.slice(0, COLLAB_LIMITS.pageSize);
    const names = await displayNames(page.flatMap(r => (r.actor_roll ? [r.actor_roll] : [])));
    res.json({
      items: page.map(r => ({
        id: String(r.id), kind: r.kind, at: r.created_at,
        actorName: r.actor_roll ? (names.get(r.actor_roll) ?? 'A DnA member') : 'The DnA team',
        you: r.actor_roll === req.studentRoll,
        detail: Object.fromEntries(Object.entries(r.detail ?? {}).filter(([k]) => (ACTIVITY_DETAIL_KEYS as readonly string[]).includes(k))),
      })),
      next: rows.length > COLLAB_LIMITS.pageSize ? String(page[page.length - 1].id) : null,
    });
  } catch (err) { fail(res, err, 'activity'); }
});

// ── Discussion ───────────────────────────────────────────────────────────

router.get('/projects/:id/comments', requireStudent, async (req, res) => {
  try {
    const m = await member(req, res);
    if (!m || !can(m.access, 'view')) return;
    const rows = (await pool.query(
      `SELECT id, author_roll, body, created_at FROM showcase_comments WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [m.project.id])).rows as
      Array<{ id: string; author_roll: string; body: string; created_at: string }>;
    const names = await displayNames(rows.map(r => r.author_roll));
    res.json({
      comments: rows.reverse().map(r => ({
        id: r.id, body: r.body, at: r.created_at, authorName: names.get(r.author_roll) ?? 'A DnA member',
        mine: r.author_roll === req.studentRoll, canDelete: r.author_roll === req.studentRoll || can(m.access, 'moderate_comments'),
      })),
    });
  } catch (err) { fail(res, err, 'comments'); }
});

router.post('/projects/:id/comments', requireStudent, commentLimiter, async (req, res) => {
  try {
    const parsed = z.object({ body: z.string().trim().min(1).max(COLLAB_LIMITS.commentChars) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: `Write a comment (up to ${COLLAB_LIMITS.commentChars} characters)` });
    const m = await member(req, res);
    if (!m) return;
    if (!can(m.access, 'comment')) return res.status(403).json({ error: 'You can’t comment on this project' });
    if (isDeadProject(m.project.status)) return res.status(409).json({ error: 'This project is closed' });
    const id = uuidv4();
    await pool.query('INSERT INTO showcase_comments (id, project_id, author_roll, body) VALUES ($1,$2,$3,$4)', [id, m.project.id, req.studentRoll!, parsed.data.body]);
    await logActivity(pool, m.project.id, req.studentRoll!, 'comment.added');
    res.status(201).json({ id });
  } catch (err) { fail(res, err, 'comment'); }
});

router.delete('/projects/:id/comments/:cid', requireStudent, writeLimiter, async (req, res) => {
  try {
    const m = await member(req, res);
    if (!m) return;
    const c = (await pool.query('SELECT author_roll FROM showcase_comments WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL', [param(req.params.cid), m.project.id])).rows[0] as { author_roll: string } | undefined;
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    if (c.author_roll !== req.studentRoll && !can(m.access, 'moderate_comments')) return res.status(403).json({ error: 'You can only delete your own comments' });
    await pool.query('UPDATE showcase_comments SET deleted_at = NOW() WHERE id = $1', [param(req.params.cid)]);
    res.json({ success: true });
  } catch (err) { fail(res, err, 'comment delete'); }
});

export default router;

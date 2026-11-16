import { pool } from '../db/client';
import { OWNER_EDITABLE, type ShowcaseStatus } from './showcaseState';

// ─────────────────────────────────────────────────────────────────────────
// Project access (DNA 2.0 V1 collaboration). One resolver and one permission
// matrix, used by every route, so "who may do what" is decided in exactly
// one place and the server — never the client — is the authority.
//
//   owner   showcase_projects.owner_roll
//   editor  an ACCEPTED showcase_collaborators row with access_role='editor'
//   viewer  an ACCEPTED row with access_role='viewer'
//
// Anything else — pending, declined, withdrawn, removed, or a stranger — has
// NO access, and callers answer 404 (never 403) so a project's existence is
// not revealed. There is no way to become the owner through this module.
// ─────────────────────────────────────────────────────────────────────────

export type Access = 'owner' | 'editor' | 'viewer';
export type CollabRole = 'editor' | 'viewer';
export const COLLAB_ROLES: readonly CollabRole[] = ['editor', 'viewer'];

export type Permission =
  | 'view'                // read the project, its collaborators' names, activity and comments
  | 'comment'             // post (and delete own) comments
  | 'edit_content'        // title, summary, description, category, tags, links, disciplines
  | 'edit_works'          // add (own images), caption, order, cover; remove images they added
  | 'remove_any_work'     // remove images other people added
  | 'edit_references'     // moodboard references and Gallery artworks
  | 'manage_collaborators'// invite, withdraw, remove, change role
  | 'manage_credits'      // propose / change / remove public credits for others; owner display name
  | 'lifecycle'           // submit, withdraw submission, archive, reopen
  | 'delete_project'
  | 'moderate_comments';  // delete other people's comments

const MATRIX: Record<Access, ReadonlySet<Permission>> = {
  owner: new Set<Permission>(['view', 'comment', 'edit_content', 'edit_works', 'remove_any_work', 'edit_references', 'manage_collaborators', 'manage_credits', 'lifecycle', 'delete_project', 'moderate_comments']),
  editor: new Set<Permission>(['view', 'comment', 'edit_content', 'edit_works']),
  viewer: new Set<Permission>(['view', 'comment']),
};

export function can(access: Access | null | undefined, permission: Permission): boolean {
  return !!access && MATRIX[access].has(permission);
}

/** Content may only change while the project is in an owner-editable state (draft / changes requested). Applies to EVERY role. */
export function contentIsEditable(status: ShowcaseStatus): boolean {
  return (OWNER_EDITABLE as readonly string[]).includes(status);
}

/** The caller's access to an already-loaded project, or null. One indexed lookup; never trusts a client-supplied role. */
export async function accessFor(project: { id: string; owner_roll: string }, roll: string): Promise<Access | null> {
  if (project.owner_roll === roll) return 'owner';
  const r = await pool.query<{ access_role: CollabRole }>(
    `SELECT access_role FROM showcase_collaborators WHERE project_id = $1 AND roll = $2 AND status = 'accepted'`,
    [project.id, roll],
  );
  return r.rows[0]?.access_role ?? null;
}

/** Friendly name for another collaborator: their public profile name if they have one, else their account name. Never a roll or email. */
export async function displayNames(rolls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(rolls)];
  if (unique.length === 0) return out;
  const r = await pool.query<{ roll: string; name: string | null }>(
    `SELECT s.roll_number AS roll, COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(s.name), '')) AS name
       FROM student_sessions s LEFT JOIN designer_profiles p ON p.owner_roll = s.roll_number
      WHERE s.roll_number = ANY($1::text[])`,
    [unique],
  );
  for (const row of r.rows) out.set(row.roll, row.name ?? 'DnA member');
  return out;
}

/** Records a project activity entry. `detail` must hold only ids/labels — never rolls, emails or free text. */
export async function logActivity(
  db: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  projectId: string, actorRoll: string | null, kind: string, detail?: Record<string, unknown>,
): Promise<void> {
  await db.query(
    'INSERT INTO showcase_activity (project_id, actor_roll, kind, detail) VALUES ($1,$2,$3,$4)',
    [projectId, actorRoll, kind, detail ? JSON.stringify(detail) : null],
  );
}

/** Owner sees everyone who still matters (pending + accepted); others see accepted collaborators by name only. */
export async function collaboratorList(p: { id: string; owner_roll: string }, roll: string, access: Access) {
  const rows = (await pool.query(
    `SELECT id, roll, access_role, status, invited_at FROM showcase_collaborators
      WHERE project_id = $1 AND status = ${access === 'owner' ? `ANY(ARRAY['pending','accepted'])` : `'accepted'`} ORDER BY invited_at`, [p.id])).rows as
    Array<{ id: string; roll: string; access_role: 'editor' | 'viewer'; status: 'pending' | 'accepted'; invited_at: string }>;
  const names = await displayNames([p.owner_roll, ...rows.map(r => r.roll)]);
  return [
    { id: 'owner', name: names.get(p.owner_roll) ?? 'Owner', accessRole: 'owner' as const, status: 'accepted' as const, isYou: p.owner_roll === roll, invitedAt: null as string | null, ...(access === 'owner' ? { roll: p.owner_roll } : {}) },
    ...rows.map(r => ({
      id: r.id, name: names.get(r.roll) ?? 'DnA member', accessRole: r.access_role, status: r.status, isYou: r.roll === roll, invitedAt: r.invited_at,
      ...(access === 'owner' ? { roll: r.roll } : {}),
    })),
  ];
}


import type { CollabInviteBody, ProjectAccess, ProjectActivityItem, ProjectPermission, ShowcaseProject, ShowcaseStatus } from './api';
import { STATUS_INFO } from './showcase';

// Pure helpers for project collaboration. Authorization is decided by the
// server and delivered as `project.permissions`; nothing here ever infers a
// permission from a role name, so the UI cannot drift from the matrix in
// backend/src/lib/showcaseAccess.ts.

export const ROLE_INFO: Record<ProjectAccess, { label: string; blurb: string }> = {
  owner: { label: 'Owner', blurb: 'Full control: invites people, manages roles, submits and archives the project.' },
  editor: { label: 'Editor', blurb: 'Edits the details and adds or organises their own images. Can’t invite, submit or archive.' },
  viewer: { label: 'Viewer', blurb: 'Can read the project and join the discussion. Can’t change anything.' },
};

export const can = (project: Pick<ShowcaseProject, 'permissions'>, permission: ProjectPermission) => project.permissions.includes(permission);

export type InviteKind = 'username' | 'roll';

/** Light client check before sending; the server decides eligibility and answers identically for every failure. */
export function inviteProblem(kind: InviteKind, raw: string): string | null {
  const v = raw.trim().replace(/^@/, '');
  if (!v) return kind === 'username' ? 'Enter a username' : 'Enter a roll number';
  if (kind === 'username' && !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/i.test(v)) return 'Usernames use letters, numbers and hyphens';
  if (kind === 'roll' && !/^[A-Za-z0-9]{1,30}$/.test(v)) return 'Roll numbers use letters and numbers only';
  return null;
}

export function buildInviteBody(input: { kind: InviteKind; value: string; role: 'editor' | 'viewer'; creditRole: string; contribution: string }): CollabInviteBody | null {
  if (inviteProblem(input.kind, input.value)) return null;
  const v = input.value.trim().replace(/^@/, '');
  const body: CollabInviteBody = { access_role: input.role };
  if (input.kind === 'username') body.handle = v.toLowerCase(); else body.roll = v.toUpperCase();
  const label = input.creditRole.trim();
  const what = input.contribution.trim();
  if (label) body.role_label = label;
  if (what) body.contribution = what;
  return body;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'the title', summary: 'the summary', description: 'the description', category: 'the category', tags: 'the tags', links: 'the links',
  discipline_ids: 'the disciplines', owner_display_name: 'the owner credit', owner_role_label: 'the owner credit',
};
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const roleWord = (r: unknown) => (r === 'editor' ? 'an editor' : r === 'viewer' ? 'a viewer' : 'a collaborator');

/** One plain sentence per activity entry. Never includes anything the server did not already allow-list. */
export function describeActivity(item: Pick<ProjectActivityItem, 'kind' | 'actorName' | 'you' | 'detail'>): string {
  const who = item.you ? 'You' : item.actorName;
  const d = item.detail ?? {};
  const name = typeof d.name === 'string' ? d.name : 'someone';
  const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
  switch (item.kind) {
    case 'collaborator.invited': return `${who} invited ${name} as ${roleWord(d.role)}`;
    case 'collaborator.accepted': return `${name} joined as ${roleWord(d.role)}${d.credited ? ' and accepted a credit' : ''}`;
    case 'collaborator.declined': return `${name} declined an invitation`;
    case 'collaborator.withdrawn': return `${who} withdrew the invitation to ${name}`;
    case 'collaborator.removed': return `${who} removed ${name}${num('removedWorks') ? ` and their ${plural(num('removedWorks'), 'image')}` : ''}`;
    case 'collaborator.left': return `${name} left the project${num('removedWorks') ? ` and took ${plural(num('removedWorks'), 'image')} with them` : ''}`;
    case 'collaborator.role_changed': return `${who} made ${name} ${roleWord(d.role)}`;
    case 'content.updated': {
      const fields = Array.isArray(d.fields) ? [...new Set((d.fields as unknown[]).map(f => FIELD_LABELS[String(f)]).filter(Boolean))] : [];
      return fields.length ? `${who} edited ${list(fields)}` : `${who} edited the project`;
    }
    case 'works.updated': {
      const bits = [num('added') ? `added ${plural(num('added'), 'image')}` : '', num('removed') ? `removed ${plural(num('removed'), 'image')}` : ''].filter(Boolean);
      return `${who} ${bits.length ? bits.join(' and ') : 'reorganised the images'}`;
    }
    case 'comment.added': return `${who} commented`;
    case 'status.changed': {
      const to = STATUS_INFO[d.to as ShowcaseStatus]?.label;
      return to ? `${item.actorName === 'The DnA team' ? 'The DnA team' : who} moved the project to “${to}”` : `${who} changed the project status`;
    }
    default: return `${who} made a change`;
  }
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else a short date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whether a project is read-only for this viewer right now, and the one sentence that explains why. */
export function readOnlyReason(project: Pick<ShowcaseProject, 'access' | 'permissions' | 'contentEditable' | 'status'>): string | null {
  if (!can(project, 'edit_content') && !can(project, 'edit_works')) return 'You can read this project and join the discussion, but only editors and the owner can change it.';
  if (!project.contentEditable) return project.status === 'published' ? 'This project is published, so it can’t be edited. The owner can archive it to make changes.' : 'This project is in review, so it can’t be edited until the owner withdraws the submission or changes are requested.';
  return null;
}

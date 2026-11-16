import type { ShowcaseCategory, ShowcaseProject, ShowcaseStatus } from './api';

// Pure helpers for the Showcase UI. The server is the authority on every
// rule here; these only decide what to SHOW (labels, which buttons).

export const CATEGORY_OPTIONS: ReadonlyArray<{ id: ShowcaseCategory; label: string }> = [
  { id: 'branding', label: 'Branding' }, { id: 'illustration', label: 'Illustration' }, { id: 'ui-ux', label: 'UI / UX' },
  { id: 'motion', label: 'Motion' }, { id: 'photography', label: 'Photography' }, { id: 'typography', label: 'Typography' },
  { id: '3d', label: '3D' }, { id: 'print', label: 'Print' }, { id: 'product', label: 'Product' }, { id: 'other', label: 'Other' },
];
export const categoryLabel = (c: string | null | undefined) => CATEGORY_OPTIONS.find(o => o.id === c)?.label ?? null;

export const STATUS_INFO: Record<ShowcaseStatus, { label: string; tone: 'neutral' | 'info' | 'warn' | 'good' | 'bad'; blurb: string }> = {
  draft: { label: 'Draft', tone: 'neutral', blurb: 'Only you can see this. Finish it and submit it for review.' },
  submitted: { label: 'In review', tone: 'info', blurb: 'Submitted — an admin will review it. You can withdraw it to keep editing.' },
  changes_requested: { label: 'Changes requested', tone: 'warn', blurb: 'An admin asked for changes. Update the project and submit it again.' },
  approved: { label: 'Approved', tone: 'good', blurb: 'Approved — waiting for an admin to publish it. Nothing is public yet.' },
  published: { label: 'Published', tone: 'good', blurb: 'Live on the public Showcase. Archive it to edit.' },
  rejected: { label: 'Not accepted', tone: 'bad', blurb: 'This submission wasn’t accepted. You can archive or delete it.' },
  archived: { label: 'Archived', tone: 'neutral', blurb: 'Not public. Reopen it as a draft to submit it again.' },
};

export type OwnerAction = 'submit' | 'withdraw' | 'archive' | 'reopen' | 'delete';

/** Which lifecycle buttons the owner sees for a status (the server still validates each). */
export function ownerActions(status: ShowcaseStatus): OwnerAction[] {
  switch (status) {
    case 'draft': return ['submit', 'delete'];
    case 'submitted': return ['withdraw'];
    case 'changes_requested': return ['submit', 'withdraw'];
    case 'approved': return [];
    case 'published': return ['archive'];
    case 'rejected': return ['archive', 'delete'];
    case 'archived': return ['reopen', 'delete'];
  }
}

export type AdminAction = { to: ShowcaseStatus; label: string; needsReason: boolean; tone: 'primary' | 'danger' | 'neutral' };
/** Moderation buttons for a status; mirrors backend/lib/showcaseState.ts. */
export function adminActions(status: ShowcaseStatus): AdminAction[] {
  switch (status) {
    case 'submitted': return [
      { to: 'approved', label: 'Approve', needsReason: false, tone: 'primary' },
      { to: 'changes_requested', label: 'Request changes', needsReason: true, tone: 'neutral' },
      { to: 'rejected', label: 'Reject', needsReason: true, tone: 'danger' },
    ];
    case 'approved': return [
      { to: 'published', label: 'Publish', needsReason: false, tone: 'primary' },
      { to: 'changes_requested', label: 'Request changes', needsReason: true, tone: 'neutral' },
      { to: 'rejected', label: 'Reject', needsReason: true, tone: 'danger' },
    ];
    case 'published': return [{ to: 'archived', label: 'Unpublish (archive)', needsReason: false, tone: 'danger' }];
    case 'rejected': return [{ to: 'archived', label: 'Archive', needsReason: false, tone: 'neutral' }];
    case 'archived': return [{ to: 'draft', label: 'Return to draft', needsReason: false, tone: 'neutral' }];
    default: return [];
  }
}

/** Preview of how a draft would look publicly: only accepted credits are shown, as the creator will be. */
export function previewCredits(project: Pick<ShowcaseProject, 'credits'>) {
  return project.credits
    .filter(c => c.status === 'accepted')
    .map(c => ({ displayName: c.displayName, roleLabel: c.roleLabel, isOwner: c.isOwner }));
}

export function parseTags(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!t || t.length > 30 || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

const PRIVATE_V4 = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
/** Instant form feedback mirroring the server's public-link rules (the server decides). */
export function isPublicLink(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const h = url.hostname.toLowerCase();
  if (!h.includes('.') || h.includes(':') || h.startsWith('[') || /^\d+(\.\d+){0,3}$/.test(h) || PRIVATE_V4.test(h)) return false;
  return !/\.(local|localhost|internal|intranet|lan|home|corp)$/.test(h);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Asha Rao, Bala Iyer +2" for cards. */
export function creditLine(credits: Array<{ displayName: string | null }>, max = 2): string {
  const names = credits.map(c => c.displayName).filter((n): n is string => !!n);
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

export function hasFilters(f: { q: string; category: string; discipline: string; tags: string[]; featured: boolean }): boolean {
  return !!(f.q.trim() || f.category || f.discipline || f.tags.length || f.featured);
}

/** "Illustration · UI/UX" — category plus disciplines, without repeating the same word twice. */
export function topicLine(category: string | null | undefined, disciplines: Array<{ title: string }>, maxDisciplines = 2): string {
  const parts: string[] = [];
  const cat = categoryLabel(category);
  if (cat) parts.push(cat);
  for (const d of disciplines.slice(0, maxDisciplines)) {
    if (!parts.some(p => p.toLowerCase() === d.title.toLowerCase())) parts.push(d.title);
  }
  return parts.join(' · ');
}

/** The creator a project page should offer "more work" for: the owner, and only when their profile is publicly linkable. */
export function featuredCreatorOf(credits: Array<{ displayName: string | null; isOwner: boolean; profile?: { handle: string } }>): { handle: string; name: string } | null {
  const owner = credits.find(c => c.isOwner);
  if (!owner?.profile?.handle) return null;
  return { handle: owner.profile.handle, name: owner.displayName?.trim() || 'this creator' };
}

/** Other published projects by the same creator: never the one being viewed, never a repeat (pages can overlap), capped. */
export function moreByCreator<T extends { slug: string }>(projects: T[], currentSlug: string, max = 3): T[] {
  const seen = new Set<string>([currentSlug]);
  const out: T[] = [];
  for (const p of projects) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

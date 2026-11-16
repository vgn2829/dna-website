import type { ArtworkCredit } from '../context/AppDataContext';
import type { CreatorCard, CreatorCapabilities, DesignerProfile } from './api';

// Pure helpers for Creator Discovery. The server decides who is public; these
// only decide how to present what it returned.

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

export const profilePath = (handle: string) => `/designers/${encodeURIComponent(handle)}`;

export const SORTS = [
  { id: 'featured', label: 'Featured first' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'newest', label: 'Newest members' },
] as const;
export type CreatorSortId = typeof SORTS[number]['id'];

export const CATEGORY_LABELS: Record<string, string> = {
  branding: 'Branding', illustration: 'Illustration', 'ui-ux': 'UI / UX', motion: 'Motion', photography: 'Photography',
  typography: 'Typography', '3d': '3D', print: 'Print', product: 'Product', other: 'Other',
};
export const categoryLabel = (c: string | null | undefined) => (c ? CATEGORY_LABELS[c] ?? c : null);

export function hasCreatorFilters(f: { q: string; discipline: string; skill: string; category: string; tool?: string; department?: string }): boolean {
  return !!(f.q.trim() || f.discipline || f.skill || f.category || f.tool || f.department);
}

/** "3 projects", "1 project", "" */
export function projectCountLabel(n: number): string {
  return n <= 0 ? '' : `${n} project${n === 1 ? '' : 's'}`;
}

/** Whether to show the project sections at all (only when the deployment has the Showcase). */
export function showsProjects(caps: CreatorCapabilities | null): boolean {
  return !!caps?.projects;
}

/** Page <title> for a profile. */
export const profileTitle = (p: Pick<DesignerProfile, 'displayName'>) => `${p.displayName} — DnA Club Creators`;

/** Gallery byline: accepted credits (linked when linkable), else the legacy free-text artist. */
export function bylineParts(artwork: { artist: string; credits?: ArtworkCredit[] }): Array<{ text: string; handle: string | null; role: string | null }> {
  const credits = (artwork.credits ?? []).filter(c => c.displayName?.trim());
  if (credits.length > 0) {
    return credits.map(c => ({ text: c.displayName, handle: c.handle, role: c.roleLabel || (c.role === 'creator' ? null : c.role) }));
  }
  return artwork.artist?.trim() ? [{ text: artwork.artist.trim(), handle: null, role: null }] : [];
}

/** Plain-text byline ("Amy, Bo (Illustration)") for cards that are themselves links, so no nested anchors. Empty when there is nothing to show. */
export function bylineText(artwork: { artist: string; credits?: ArtworkCredit[] }): string {
  return bylineParts(artwork).map(p => (p.role ? `${p.text} (${p.role})` : p.text)).join(', ');
}

/** Dedupe a list of cards by handle, keeping the first (pagination can overlap after a change). */
export function mergeCards(prev: CreatorCard[], next: CreatorCard[]): CreatorCard[] {
  const seen = new Set(prev.map(c => c.handle));
  return [...prev, ...next.filter(c => !seen.has(c.handle))];
}

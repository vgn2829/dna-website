import type { Asset, Board, InspirationCategory, InspirationItem } from './api';
import { assetPreviewSrc, linkSource, displayUrl } from './assetLibrary';
import { canAddToMoodboard, moodboardBlocker } from './assetPreview';

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers for the Inspiration Library UI. No I/O, no React.
// ─────────────────────────────────────────────────────────────────────────

export const CATEGORY_OPTIONS: ReadonlyArray<{ id: InspirationCategory; label: string }> = [
  { id: 'illustration', label: 'Illustration' },
  { id: 'typography', label: 'Typography' },
  { id: 'branding', label: 'Branding' },
  { id: 'ui-ux', label: 'UI / UX' },
  { id: 'photography', label: 'Photography' },
  { id: 'color', label: 'Color' },
  { id: 'motion', label: 'Motion' },
  { id: '3d', label: '3D' },
  { id: 'layout', label: 'Layout' },
  { id: 'other', label: 'Other' },
];

export function categoryLabel(id: InspirationCategory | null | undefined): string | null {
  return CATEGORY_OPTIONS.find(c => c.id === id)?.label ?? null;
}

export const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'title', label: 'Title A–Z' },
] as const;

/** "#Retro, hand lettered" → ['retro', 'hand-lettered'] (mirrors the server; the server decides). */
export function parseTagInput(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!tag || tag.length > 30 || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tag)) continue;
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= 10) break;
  }
  return out;
}

const PRIVATE_V4 = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/** Instant form feedback mirroring the server's public-host rules: http(s), no credentials, not localhost/IP/intranet. */
export function isAcceptableReferenceUrl(raw: string, httpsOnly = false): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  let url: URL;
  try { url = new URL(trimmed); } catch { return false; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !httpsOnly)) return false;
  if (url.username || url.password) return false;
  const h = url.hostname.toLowerCase();
  if (!h.includes('.') || h.includes(':') || h.startsWith('[')) return false;
  if (/^\d+(\.\d+){0,3}$/.test(h) || PRIVATE_V4.test(h)) return false;
  return !/\.(local|localhost|internal|intranet|lan|home|corp)$/.test(h);
}

/** Where a card's picture comes from: a library asset (thumbnail first), a user-supplied https image, or nothing. */
export function itemPreviewSrc(item: Pick<InspirationItem, 'asset' | 'image_url' | 'unavailable'>): string | null {
  if (item.unavailable) return null;
  if (item.asset) {
    return item.asset.kind === 'image' ? assetPreviewSrc(item.asset as Pick<Asset, 'kind' | 'url' | 'thumb_url'>) : null;
  }
  return item.image_url;
}

/** Where opening the card goes: the asset's file/link, or the saved link. */
export function itemOpenHref(item: Pick<InspirationItem, 'asset' | 'url' | 'unavailable'>): string | null {
  if (item.unavailable) return null;
  if (item.asset) return item.asset.kind === 'link' ? item.asset.link_url : item.asset.url;
  return item.url;
}

/** Short source line: "Behance", "Asset Library · PNG", … */
export function itemSourceLabel(item: Pick<InspirationItem, 'kind' | 'url' | 'asset' | 'unavailable'>): string {
  if (item.kind === 'link') return linkSource(item.url) ?? 'Link';
  if (item.unavailable || !item.asset) return 'Asset Library';
  return item.asset.kind === 'link'
    ? `Asset Library · ${linkSource(item.asset.link_url) ?? 'Link'}`
    : `Asset Library · ${item.asset.extension ? item.asset.extension.toUpperCase() : item.asset.kind === 'image' ? 'Image' : 'File'}`;
}

export function itemDisplayUrl(item: Pick<InspirationItem, 'url'>): string | null {
  return displayUrl(item.url);
}

export type MoodboardPlan =
  | { type: 'asset'; assetId: string }
  | { type: 'image-link'; imageUrl: string; sourceUrl: string | null; note: string };

/**
 * How (and whether) a reference can be placed on a moodboard, using only the
 * existing board-item endpoint: library images go by asset id (the server
 * re-checks use on the board's workspace); a link with a user-supplied image
 * goes as that https image with the page as its source. Files, links without
 * an image, and unavailable assets cannot be placed.
 */
export function moodboardPlan(item: InspirationItem): MoodboardPlan | null {
  if (item.unavailable) return null;
  if (item.asset) {
    return canAddToMoodboard(item.asset as Pick<Asset, 'kind' | 'url'>) ? { type: 'asset', assetId: item.asset.id } : null;
  }
  return item.image_url ? { type: 'image-link', imageUrl: item.image_url, sourceUrl: item.url, note: item.title.slice(0, 500) } : null;
}

/** Client-visible blocker for one destination board (Personal assets stay in their own workspace). */
export function boardBlocker(item: InspirationItem, board: Pick<Board, 'workspace_id'>): 'personal-elsewhere' | null {
  return item.asset ? moodboardBlocker(item.asset as Pick<Asset, 'visibility' | 'workspace_id'>, board) : null;
}

export function hasActiveFilters(f: { q: string; tags: string[]; category: string; kind: string }): boolean {
  return !!(f.q.trim() || f.tags.length || f.category || f.kind);
}

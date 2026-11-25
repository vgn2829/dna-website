import { pool } from '../db/client';

// ─────────────────────────────────────────────────────────────────────────
// Creator Discovery helpers: runtime capability detection plus pure
// validation/limits. Creator identity is PR #84's `designer_profiles`; the
// projects section is PR #100's showcase tables. Neither exists on main, so
// each feature switches on only when its tables are really present. Nothing
// here creates or writes to those tables.
// ─────────────────────────────────────────────────────────────────────────

export interface DirectoryCapabilities { profiles: boolean; projects: boolean; artworkCredits: boolean }

let cache: { at: number; value: DirectoryCapabilities } | null = null;
const TTL_MS = 30_000;

export async function directoryCapabilities(): Promise<DirectoryCapabilities> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const r = await pool.query(`
      SELECT to_regclass('public.designer_profiles') IS NOT NULL
         AND to_regclass('public.designer_profile_disciplines') IS NOT NULL
         AND to_regclass('public.creator_audit_log') IS NOT NULL AS profiles,
             to_regclass('public.showcase_projects') IS NOT NULL
         AND to_regclass('public.showcase_credits') IS NOT NULL
         AND to_regclass('public.showcase_assets') IS NOT NULL AS projects,
             to_regclass('public.artwork_credits') IS NOT NULL AS credits`);
    const row = r.rows[0] as { profiles: boolean; projects: boolean; credits: boolean };
    cache = { at: Date.now(), value: { profiles: row.profiles, projects: row.profiles && row.projects, artworkCredits: row.profiles && row.credits } };
  }
  return cache.value;
}
export function resetDirectoryCapabilityCache(): void { cache = null; }

export const MAX_PAGE = 36;
export const DEFAULT_PAGE = 24;
export const MAX_OFFSET = 600;
export const MAX_FEATURED = 12;
export const CARD_PROJECTS = 3;
export const BIO_PREVIEW = 160;

const HANDLE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** A syntactically valid public handle (3–30 chars). Existence is never implied. */
export function isValidHandle(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= 3 && raw.length <= 30 && HANDLE_RE.test(raw);
}

export function clampLimit(raw: unknown, fallback = DEFAULT_PAGE, max = MAX_PAGE): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
}
export function clampOffset(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_OFFSET) : 0;
}

export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

/** First ~160 chars at a word boundary, for cards. */
export function previewBio(bio: string | null | undefined, max = BIO_PREVIEW): string | null {
  const text = (bio ?? '').trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const DIRECTORY_SORTS = ['featured', 'name', 'newest'] as const;
export type DirectorySort = typeof DIRECTORY_SORTS[number];
export const SORT_SQL: Record<DirectorySort, string> = {
  featured: '(f.featured_at IS NULL) ASC, (f.display_order IS NULL) ASC, f.display_order ASC, f.featured_at DESC, lower(p.display_name) ASC, p.handle ASC',
  name: 'lower(p.display_name) ASC, p.handle ASC',
  newest: 'p.created_at DESC, p.handle ASC',
};

export const SHOWCASE_CATEGORIES = ['branding', 'illustration', 'ui-ux', 'motion', 'photography', 'typography', '3d', 'print', 'product', 'other'] as const;

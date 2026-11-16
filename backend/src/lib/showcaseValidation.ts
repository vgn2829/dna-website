// ─────────────────────────────────────────────────────────────────────────
// Showcase input rules (pure). The server never fetches any URL, so URL
// checks are about what is safe to STORE and render publicly: http(s) only,
// no credentials, no localhost / single-label / .local hosts, no IP
// literals, bounded length.
// ─────────────────────────────────────────────────────────────────────────

export const SHOWCASE_CATEGORIES = [
  'branding', 'illustration', 'ui-ux', 'motion', 'photography', 'typography', '3d', 'print', 'product', 'other',
] as const;
export type ShowcaseCategory = typeof SHOWCASE_CATEGORIES[number];
export const isShowcaseCategory = (v: unknown): v is ShowcaseCategory =>
  typeof v === 'string' && (SHOWCASE_CATEGORIES as readonly string[]).includes(v);

export const LIMITS = {
  works: 12, tags: 10, links: 5, disciplines: 4, contributors: 10, activeProjectsPerStudent: 30,
  workBytes: 25 * 1024 * 1024, totalBytes: 100 * 1024 * 1024,
} as const;

export const WORK_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

const RESERVED_SLUGS = new Set(['manage', 'new', 'mine', 'admin', 'api', 'edit', 'preview', 'featured', 'invitations']);

export function slugify(title: string): string {
  const base = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  const slug = base || 'project';
  return RESERVED_SLUGS.has(slug) ? `${slug}-project` : slug;
}

export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!tag || tag.length > 30 || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tag)) continue;
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

const PRIVATE_V4 = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/;

export function isDisallowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || !h.includes('.')) return true;
  if (h.startsWith('[') || h.includes(':')) return true;
  if (/^\d+(\.\d+){0,3}$/.test(h) || /^0x[0-9a-f]+$/i.test(h) || PRIVATE_V4.test(h)) return true;
  return /\.(local|localhost|internal|intranet|lan|home|corp|test|invalid|example)$/.test(h);
}

export function validatePublicUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  let url: URL;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || isDisallowedHost(url.hostname)) return null;
  return url.href.length <= 2048 ? url.href : null;
}

export interface ProjectLink { label: string; url: string }

/** Cleans a links array; returns null if any entry is unsafe (so the caller can reject, not silently drop). */
export function normalizeLinks(raw: unknown): ProjectLink[] | null {
  if (!Array.isArray(raw)) return raw === undefined ? [] : null;
  if (raw.length > LIMITS.links) return null;
  const out: ProjectLink[] = [];
  for (const l of raw) {
    if (!l || typeof l !== 'object') return null;
    const url = validatePublicUrl((l as { url?: unknown }).url);
    const label = typeof (l as { label?: unknown }).label === 'string' ? (l as { label: string }).label.trim().slice(0, 60) : '';
    if (!url) return null;
    out.push({ label: label || new URL(url).hostname.replace(/^www\./, ''), url });
  }
  return out;
}

export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

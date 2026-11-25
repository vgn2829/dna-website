// ─────────────────────────────────────────────────────────────────────────
// Inspiration Library — pure validation/normalisation helpers (no I/O).
//
// SECURITY MODEL FOR EXTERNAL URLS: the server NEVER fetches, resolves,
// scrapes or proxies a user-supplied URL. A reference stores the link (and
// an optional image URL the user supplies) as plain text; the user's own
// browser opens the link or loads the image. That removes SSRF by
// construction. These checks exist so the stored data is safe to render and
// to share later: http(s) only, no credentials, no localhost/private-network
// or IP-literal hosts, bounded length, and images must be https.
// ─────────────────────────────────────────────────────────────────────────

export const INSPIRATION_CATEGORIES = [
  'illustration', 'typography', 'branding', 'ui-ux', 'photography',
  'color', 'motion', '3d', 'layout', 'other',
] as const;
export type InspirationCategory = typeof INSPIRATION_CATEGORIES[number];

export function isInspirationCategory(v: unknown): v is InspirationCategory {
  return typeof v === 'string' && (INSPIRATION_CATEGORIES as readonly string[]).includes(v);
}

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_URL_LENGTH = 2048;

/** Lower-cased, trimmed, de-duplicated tags; invalid ones are dropped. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!tag || tag.length > MAX_TAG_LENGTH || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tag)) continue;
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const PRIVATE_V4 = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/;

/** True for hosts that must never be stored as a reference target. */
export function isDisallowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h || !h.includes('.')) return true; // "localhost", single-label intranet names
  if (h.startsWith('[') || h.includes(':')) return true; // any IPv6 literal
  if (/^\d+(\.\d+){0,3}$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true; // IPv4 literal, incl. decimal/short forms
  if (PRIVATE_V4.test(h)) return true;
  return /\.(local|localhost|internal|intranet|lan|home|corp|test|invalid|example)$/.test(h);
}

function parseHttpUrl(raw: unknown, httpsOnly: boolean): URL | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !httpsOnly)) return null;
  if (url.username || url.password) return null;
  if (isDisallowedHost(url.hostname)) return null;
  return url;
}

/** A reference link: absolute http(s) URL, public host, no credentials. Returns the canonical href or null. */
export function validateReferenceUrl(raw: unknown): string | null {
  const url = parseHttpUrl(raw, false);
  return url && url.href.length <= MAX_URL_LENGTH ? url.href : null;
}

/** A thumbnail/image URL the user supplies: https only (also avoids mixed content). */
export function validateImageUrl(raw: unknown): string | null {
  const url = parseHttpUrl(raw, true);
  return url && url.href.length <= MAX_URL_LENGTH ? url.href : null;
}

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|igshid|mc_cid|mc_eid|ref|ref_src)$/i;

/**
 * Key used to stop the same page being saved twice: host (lower-cased,
 * without "www."), path without a trailing slash, query minus tracking
 * parameters and sorted, no fragment. Different pages never collide.
 */
export function urlDedupeKey(href: string): string {
  const url = new URL(href);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  return `${host}${url.port ? `:${url.port}` : ''}${path}${query}`;
}

/** Display fallback when the user gives no title: the link's hostname. */
export function titleFromUrl(href: string): string {
  try { return new URL(href).hostname.replace(/^www\./, '').slice(0, 120); } catch { return 'Link'; }
}

export const INSPIRATION_SORTS = ['newest', 'oldest', 'title'] as const;
export type InspirationSort = typeof INSPIRATION_SORTS[number];

export const SORT_SQL: Record<InspirationSort, string> = {
  newest: 'i.created_at DESC, i.id DESC',
  oldest: 'i.created_at ASC, i.id ASC',
  title: 'lower(i.title) ASC, i.id ASC',
};

/** Escapes LIKE wildcards so a search term is matched literally. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

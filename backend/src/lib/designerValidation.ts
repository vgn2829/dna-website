import { z } from 'zod';

// Validation rules for designer profiles (spec §7). Pure functions/schemas so
// they are unit-testable without a database.

export const RESERVED_HANDLES = new Set([
  'admin', 'api', 'designers', 'designer', 'me', 'new', 'edit', 'settings', 'profile',
  'dna', 'dnaiitk', 'club', 'team', 'gallery', 'events', 'academy', 'resources', 'palette',
  'design-studio', 'assets', 'home', 'moodboards', 'projects', 'templates', 'support',
  'help', 'about', 'login', 'logout', 'null', 'undefined', 'works', 'reports', 'handle-available',
]);

const HANDLE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const handleSchema = z.string().trim().toLowerCase().min(3).max(30).regex(HANDLE_RE);

export type HandleProblem = 'invalid' | 'reserved';
export function checkHandle(raw: unknown): { ok: true; handle: string } | { ok: false; reason: HandleProblem } {
  const parsed = handleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  if (RESERVED_HANDLES.has(parsed.data)) return { ok: false, reason: 'reserved' };
  return { ok: true, handle: parsed.data };
}

// Control characters, zero-width and bidi-override characters never belong in
// a name, headline or bio (spoofing / invisible-text vector).
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

/** Single-line text: trims, collapses internal whitespace, rejects hidden characters. */
export const oneLine = (min: number, max: number) =>
  z.string().transform(s => s.replace(/\s+/g, ' ').trim())
    .refine(s => s.length >= min && s.length <= max && !HIDDEN_CHARS.test(s));

/** Multi-line plain text: trims, normalises newlines, rejects hidden characters. */
export const plainText = (max: number) =>
  z.string().transform(s => s.replace(/\r\n?/g, '\n').trim())
    .refine(s => s.length <= max && !HIDDEN_CHARS.test(s.replace(/\n/g, ' ')));

export const displayNameSchema = oneLine(1, 100);
export const headlineSchema = oneLine(1, 80);
export const departmentSchema = oneLine(1, 60);
export const bioSchema = plainText(500);

// ── Skills ───────────────────────────────────────────────────────────────────
const SKILL_RE = /^[a-z0-9][a-z0-9 +#.\-]{0,28}[a-z0-9+#]$/;
export const skillsSchema = z.array(z.string()).max(12).transform(list =>
  [...new Set(list.map(s => s.toLowerCase().replace(/\s+/g, ' ').trim()))]
).refine(list => list.every(s => s.length >= 2 && s.length <= 30 && SKILL_RE.test(s)));

// ── Links ────────────────────────────────────────────────────────────────────
export const LINK_KINDS = ['website', 'behance', 'dribbble', 'instagram', 'linkedin', 'github', 'youtube', 'other'] as const;
export type LinkKind = typeof LINK_KINDS[number];

const KIND_HOSTS: Partial<Record<LinkKind, string[]>> = {
  behance: ['behance.net'],
  dribbble: ['dribbble.com'],
  instagram: ['instagram.com'],
  linkedin: ['linkedin.com'],
  github: ['github.com'],
  youtube: ['youtube.com', 'youtu.be'],
};

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');

/**
 * Normalises a profile link. https only, no credentials, ≤2048 chars, host must
 * match the declared kind for named networks, and generic kinds may not point
 * at localhost or IP literals. Returns the canonical href, or null.
 * The URL is stored and displayed only — never fetched server-side.
 */
export function normalizeProfileLink(kind: LinkKind, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIpLiteral(host) || !host.includes('.')) return null;
  const allowed = KIND_HOSTS[kind];
  if (allowed && !allowed.some(d => hostMatches(host, d))) return null;
  return url.href.length > 2048 ? null : url.href;
}

export const linksSchema = z.object({
  links: z.array(z.object({ kind: z.enum(LINK_KINDS), url: z.string() }).strict()).max(6),
}).strict();

export const CREDIT_ROLES = ['creator', 'co-creator', 'contributor'] as const;
export const roleLabelSchema = oneLine(1, 40);

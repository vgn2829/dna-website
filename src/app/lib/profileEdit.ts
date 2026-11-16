// Pure helpers for the student profile editor. These mirror the server rules in
// backend/src/lib/designerValidation.ts ONLY to give instant feedback; the
// server stays the authority and every rule is re-checked there.

export const PROFILE_LIMITS = { displayName: 100, headline: 80, bio: 500, department: 60, skills: 12, tools: 12, links: 6, disciplines: 3 } as const;

export const LINK_KINDS = ['website', 'behance', 'dribbble', 'instagram', 'linkedin', 'github', 'youtube', 'other'] as const;
export type LinkKind = typeof LINK_KINDS[number];
export const LINK_LABELS: Record<LinkKind, string> = {
  website: 'Website', behance: 'Behance', dribbble: 'Dribbble', instagram: 'Instagram',
  linkedin: 'LinkedIn', github: 'GitHub', youtube: 'YouTube', other: 'Other',
};
const KIND_HOSTS: Partial<Record<LinkKind, string[]>> = {
  behance: ['behance.net'], dribbble: ['dribbble.com'], instagram: ['instagram.com'],
  linkedin: ['linkedin.com'], github: ['github.com'], youtube: ['youtube.com', 'youtu.be'],
};

export type Visibility = 'private' | 'members' | 'public';
export const VISIBILITY_OPTIONS: Array<{ id: Visibility; label: string; help: string }> = [
  { id: 'private', label: 'Only me', help: 'Nobody else can open your profile. Your name is not linked from credits.' },
  { id: 'members', label: 'Signed-in DnA members', help: 'Students who are signed in can open it. It is not listed in the public directory.' },
  { id: 'public', label: 'Everyone', help: 'Anyone can open it, and it appears in Creator Discovery and links from credits.' },
];

/** 3–30 chars, lowercase letters/digits with single hyphens between, starting with a letter. */
export const HANDLE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export function handleProblem(raw: string): string | null {
  const h = raw.trim().toLowerCase();
  if (h.length < 3) return 'Use at least 3 characters';
  if (h.length > 30) return 'Use at most 30 characters';
  if (!HANDLE_RE.test(h)) return 'Start with a letter; use letters, numbers and single hyphens';
  return null;
}

/** "Asha Rao" → "asha-rao". A starting point only: the server checks it is free and not reserved. */
export function suggestHandle(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');
  return base.slice(0, 30).replace(/-+$/g, '');
}

/** Same https-only / host-must-match-network rule the server applies. Returns a message, or null when fine. */
export function linkProblem(kind: LinkKind, raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Enter a link';
  let url: URL;
  try { url = new URL(v); } catch { return 'Enter a full address starting with https://'; }
  if (url.protocol !== 'https:') return 'Links must start with https://';
  if (url.username || url.password) return 'Remove the username/password from the link';
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return 'Use a public website address';
  const allowed = KIND_HOSTS[kind];
  if (allowed && !allowed.some(d => host === d || host.endsWith(`.${d}`))) return `That doesn’t look like a ${LINK_LABELS[kind]} address`;
  return null;
}

/** Skills are stored lowercase, de-duplicated, 2–30 chars. Returns the cleaned list, or null if any entry is unusable. */
const SKILL_RE = /^[a-z0-9][a-z0-9 +#.\-]{0,28}[a-z0-9+#]$/;
export function cleanSkills(list: string[]): string[] {
  return [...new Set(list.map(s => s.toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean))];
}
export function skillProblem(skill: string): string | null {
  const s = skill.toLowerCase().replace(/\s+/g, ' ').trim();
  if (s.length < 2) return 'Skills need at least 2 characters';
  if (s.length > 30) return 'Skills can be at most 30 characters';
  return SKILL_RE.test(s) ? null : 'Use letters, numbers and + # . -';
}

/** Decodes the (unverified) JWT payload purely to decide which hint to show; the server enforces the real check. */
export function tokenIdentityVerified(token: string | null): boolean {
  if (!token) return false;
  try {
    const part = token.split('.')[1];
    if (!part) return false;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const claims = JSON.parse(json) as { identityVerified?: unknown; bypass?: unknown };
    return claims.identityVerified === true && claims.bypass !== true;
  } catch {
    return false;
  }
}

/** Only the fields that changed, so a save never re-sends (or accidentally overwrites) untouched data. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as Array<keyof T>) if (before[k] !== after[k]) out[k] = after[k];
  return out;
}

export const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) return 'Use a JPG, PNG or WebP image';
  if (file.size > AVATAR_MAX_BYTES) return 'Profile images must be 2 MB or smaller';
  return null;
}

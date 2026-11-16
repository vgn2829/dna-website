import { pool } from '../db/client';

// ─────────────────────────────────────────────────────────────────────────
// Compatibility adapter for PR #84's canonical creator identity.
//
// Main has no public identity (a roll number must never be public). PR #84
// adds designer_profiles (1:1 with owner_roll) and artwork_credits. This
// module feature-detects those tables at runtime so the Showcase works today
// and lights up automatically once #84 is merged — WITHOUT creating any
// competing identity or credits table. Nothing here writes to #84's tables.
// ─────────────────────────────────────────────────────────────────────────

let cache: { at: number; profiles: boolean; credits: boolean } | null = null;
const TTL_MS = 30_000;

export async function identityCapabilities(): Promise<{ profiles: boolean; artworkCredits: boolean }> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const r = await pool.query(`SELECT to_regclass('public.designer_profiles') IS NOT NULL AS p, to_regclass('public.artwork_credits') IS NOT NULL AS c`);
    cache = { at: Date.now(), profiles: !!r.rows[0].p, credits: !!r.rows[0].c };
  }
  return { profiles: cache.profiles, artworkCredits: cache.profiles && cache.credits };
}
export function resetIdentityCapabilityCache(): void { cache = null; }

/** roll → public profile handle, only for public + active profiles. Empty before #84. */
export async function publicProfileHandles(rolls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rolls.length === 0 || !(await identityCapabilities()).profiles) return out;
  const r = await pool.query(
    `SELECT owner_roll, handle FROM designer_profiles
     WHERE owner_roll = ANY($1::text[]) AND visibility = 'public' AND moderation_status = 'active'`,
    [rolls],
  );
  for (const row of r.rows as Array<{ owner_roll: string; handle: string }>) out.set(row.owner_roll, row.handle);
  return out;
}

/** Whether the student holds an accepted creator credit on a published Gallery artwork. False before #84. */
export async function ownsArtwork(roll: string, artworkId: string): Promise<boolean> {
  if (!(await identityCapabilities()).artworkCredits) return false;
  const r = await pool.query(
    `SELECT 1 FROM artwork_credits c
     JOIN designer_profiles p ON p.id = c.profile_id
     JOIN artworks a ON a.id = c.artwork_id
     WHERE c.artwork_id = $1 AND p.owner_roll = $2 AND c.status = 'accepted'
       AND c.role IN ('creator','co-creator') AND a.status = 'published' LIMIT 1`,
    [artworkId, roll],
  );
  return r.rows.length > 0;
}

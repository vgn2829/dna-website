import { pool } from '../db/client';

// Attribution read-model and shared policy (spec §9). Everything a public
// response says about a person goes through here, so the rules live once.

export type ProfileVisibility = 'private' | 'members' | 'public';

/**
 * Who may read a profile page (spec §9.1). Hidden (moderated) profiles are
 * invisible to everyone but the owner. Callers answer 404 — never 403 — when
 * this is false, so existence is not revealed.
 */
export function canViewProfile(
  profile: { owner_roll: string; visibility: ProfileVisibility; moderation_status: 'active' | 'hidden' },
  viewerRoll: string | undefined,
): boolean {
  if (viewerRoll && viewerRoll === profile.owner_roll) return true;
  if (profile.moderation_status !== 'active') return false;
  if (profile.visibility === 'public') return true;
  return profile.visibility === 'members' && Boolean(viewerRoll);
}

/**
 * Whether a credit may LINK to a profile. A `members` profile is linkable only
 * for signed-in viewers; anonymous viewers get plain text. Hidden never links.
 */
export function creditIsLinkable(
  profile: { visibility: ProfileVisibility; moderation_status: 'active' | 'hidden' },
  viewerSignedIn: boolean,
): boolean {
  if (profile.moderation_status !== 'active') return false;
  return profile.visibility === 'public' || (profile.visibility === 'members' && viewerSignedIn);
}

export interface PublicCredit {
  displayName: string;
  handle: string | null;
  role: string;
  roleLabel: string | null;
  position: number;
  isPrimary: boolean;
  verified: boolean;
}

interface CreditJoinRow {
  artwork_id: string; role: string; role_label: string | null; is_primary: boolean; position: number;
  handle: string; display_name: string; visibility: ProfileVisibility;
  moderation_status: 'active' | 'hidden'; verified_at: string | null;
}

/**
 * Public credits for many artworks in ONE query. Only `accepted` credits of
 * non-hidden profiles are returned; the handle is present only when the credit
 * is linkable for this viewer. Pending/declined credits never leave the server.
 */
export async function publicCredits(artworkIds: string[], viewerSignedIn: boolean): Promise<Map<string, PublicCredit[]>> {
  const out = new Map<string, PublicCredit[]>();
  if (artworkIds.length === 0) return out;
  const { rows } = await pool.query<CreditJoinRow>(
    `SELECT c.artwork_id, c.role, c.role_label, c.is_primary, c.position,
            p.handle, p.display_name, p.visibility, p.moderation_status, p.verified_at
       FROM artwork_credits c
       JOIN designer_profiles p ON p.id = c.profile_id
      WHERE c.artwork_id = ANY($1::text[]) AND c.status = 'accepted' AND p.moderation_status = 'active'
      ORDER BY c.artwork_id, c.is_primary DESC, c.position ASC, c.created_at ASC`,
    [artworkIds],
  );
  for (const r of rows) {
    const list = out.get(r.artwork_id) ?? [];
    list.push({
      displayName: r.display_name,
      handle: creditIsLinkable(r, viewerSignedIn) ? r.handle : null,
      role: r.role,
      roleLabel: r.role_label,
      position: r.position,
      isPrimary: r.is_primary,
      verified: r.verified_at !== null,
    });
    out.set(r.artwork_id, list);
  }
  return out;
}

type Db = { query: (text: string, params?: unknown[]) => Promise<unknown> };

/** Appends to creator_audit_log. Pass the transaction client so it commits atomically with the change. */
export async function writeAudit(
  db: Db,
  entry: { entityType: 'profile' | 'artwork' | 'credit'; entityId: string; action: string; actor: 'admin' | 'student' | 'system'; actorRoll?: string; detail?: unknown },
): Promise<void> {
  await db.query(
    `INSERT INTO creator_audit_log(entity_type, entity_id, action, actor_kind, actor_roll, detail)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [entry.entityType, entry.entityId, entry.action, entry.actor, entry.actorRoll ?? null, entry.detail === undefined ? null : JSON.stringify(entry.detail)],
  );
}

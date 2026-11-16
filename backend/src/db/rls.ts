import type { Pool } from 'pg';

// Defence in depth for Supabase's public REST ("Data API"): row-level security
// ON with NO policies means the anon/authenticated roles can read nothing, while
// the backend — which connects as the table OWNER — bypasses RLS unchanged
// (the same reasoning Email Centre documents in emailCentreSchema.ts).
//
// Scope is deliberate: ONLY tables first created by DNA 2.0 V1 (they do not
// exist in production yet), so this never alters the policy state of a table
// that is already live. Existing tables (student_sessions, student_otps,
// admin_config, …) are the owner's to review under the rollout procedure in
// docs/dna-2.0/V1_RELEASE_RUNBOOK.md §3 — not something a deploy should change.
//
// A table that cannot be altered (wrong role, missing) is logged and skipped:
// failing to harden must never stop the API from starting.
export const V1_RLS_TABLES = [
  'student_roster',
  'designer_profiles', 'designer_profile_disciplines', 'designer_profile_links', 'artwork_credits', 'creator_audit_log', 'creator_features',
  'inspiration_items', 'inspiration_collections', 'inspiration_collection_items',
  'showcase_projects', 'showcase_project_disciplines', 'showcase_assets', 'showcase_credits', 'showcase_boards', 'showcase_artworks', 'showcase_events',
  'showcase_collaborators', 'showcase_collab_blocks', 'showcase_activity', 'showcase_comments',
] as const;

export async function enableRlsForNewTables(db: Pool): Promise<string[]> {
  const skipped: string[] = [];
  for (const t of V1_RLS_TABLES) {
    try {
      await db.query(`ALTER TABLE IF EXISTS ${t} ENABLE ROW LEVEL SECURITY`);
    } catch (err) {
      skipped.push(t);
      console.error(`RLS: could not enable on ${t} (continuing):`, err instanceof Error ? err.message : err);
    }
  }
  return skipped;
}

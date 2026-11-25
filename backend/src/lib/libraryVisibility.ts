// ─────────────────────────────────────────────────────────────────────────
// Shared Creative Library — visibility for templates and assets.
//
// TEMPLATES: visibility is a layer INSIDE a workspace, never across one:
// every route still requires workspace membership first
// (getWorkspaceMembership), and then
//   personal  — only the item's owner (owner_roll) can see or use it
//   community — every member of the item's workspace can see and use it
//
// ASSETS have three levels (ASSET_VISIBILITIES):
//   personal  — only the owner, from the asset's own (source) workspace.
//   workspace — every member of the source workspace, plus the members of
//               any workspace the owner explicitly shared it with
//               (asset_workspace_grants, routes/assetSharing.ts). A grant
//               exposes only that one asset, only to the target workspace's
//               members, and only while it stays 'workspace' and active.
//   community — a deliberate publication to the whole club: every signed-in
//               student (requireStudent), from whichever workspace they are
//               in, with no grant and no shared membership needed. It is
//               still never anonymous or public-internet access — every
//               route stays behind requireStudent.
// Before 'workspace' existed, an asset's 'community' meant exactly what
// 'workspace' means now; a one-time migration (db/schema.ts) renamed those
// rows, so nothing already published reached anyone new.
// Only the owner ever manages an item (edit, delete, publish/unpublish).
// No storage change — publishing flips this column and nothing else.
//
// Moderation (status): an admin can hide any item. A hidden item is out of
// every normal flow — lists, search, direct fetches, Use, owner actions —
// for everyone, its owner included, exactly as if it did not exist; only
// the admin moderation endpoints (requireAdmin) see and restore it. Hiding
// never deletes the row or its stored file.
// ─────────────────────────────────────────────────────────────────────────

export const LIBRARY_VISIBILITIES = ['personal', 'community'] as const;
export type LibraryVisibility = typeof LIBRARY_VISIBILITIES[number];

export const ASSET_VISIBILITIES = ['personal', 'workspace', 'community'] as const;
export type AssetVisibility = typeof ASSET_VISIBILITIES[number];

export function isAssetVisibility(value: unknown): value is AssetVisibility {
  return typeof value === 'string' && (ASSET_VISIBILITIES as readonly string[]).includes(value);
}

export const LIBRARY_STATUSES = ['active', 'hidden'] as const;
export type LibraryStatus = typeof LIBRARY_STATUSES[number];

export function isLibraryVisibility(value: unknown): value is LibraryVisibility {
  return typeof value === 'string' && (LIBRARY_VISIBILITIES as readonly string[]).includes(value);
}

// List scopes, applied server-side:
//   all       — everything the caller may see: their own (either visibility)
//               plus other members' community items. Never another member's
//               personal item.
//   mine      — owned by the caller.
//   community — community items in the workspace (the caller's included).
export const LIBRARY_SCOPES = ['all', 'mine', 'community'] as const;
export type LibraryScope = typeof LIBRARY_SCOPES[number];

// Parses a ?scope= query value: absent → 'all', unknown → null (the route 400s).
export function parseLibraryScope(raw: unknown): LibraryScope | null {
  if (raw === undefined || raw === '') return 'all';
  return typeof raw === 'string' && (LIBRARY_SCOPES as readonly string[]).includes(raw) ? raw as LibraryScope : null;
}

// SQL predicate for a scope. bindRoll returns the placeholder ($n) for the
// caller's roll and is only called when the predicate needs it — Postgres
// rejects a bound parameter the statement never references. Column names
// are fixed identifiers, never user input.
// Every scope also requires status = 'active' — hidden items never reach a
// normal user.
export function libraryScopeSql(scope: LibraryScope, bindRoll: () => string, prefix = ''): string {
  const active = `${prefix}status = 'active'`;
  if (scope === 'community') return `(${active} AND ${prefix}visibility = 'community')`;
  const roll = bindRoll();
  if (scope === 'mine') return `(${active} AND ${prefix}owner_roll = ${roll})`;
  return `(${active} AND (${prefix}owner_roll = ${roll} OR ${prefix}visibility = 'community'))`;
}

// A bindRoll for route-built parameter lists: pushes the roll once, on first
// use, and reuses that placeholder afterwards.
export function rollBinder(params: unknown[], roll: string): () => string {
  let placeholder: string | null = null;
  return () => {
    if (!placeholder) { params.push(roll); placeholder = `$${params.length}`; }
    return placeholder;
  };
}

// Row-level read check for single-item routes (the caller is already known
// to be a member of the row's workspace).
export function canSeeLibraryItem(row: { owner_roll: string; visibility: LibraryVisibility; status: LibraryStatus }, roll: string): boolean {
  return row.status === 'active' && (row.owner_roll === roll || row.visibility === 'community');
}

// Asset list predicate for the caller's selected workspace (membership is
// checked by the route first):
//   mine      — the caller's own assets in this workspace;
//   community — every active Community asset, from any workspace;
//   all       — mine, plus 'workspace' assets of this workspace or granted
//               into it, plus every Community asset.
// A grant only ever widens a 'workspace' asset; it never exposes a personal
// one, and a Community asset needs none.
export function assetScopeSql(scope: LibraryScope, bindRoll: () => string, bindWorkspace: () => string, prefix = ''): string {
  const active = `${prefix}status = 'active'`;
  const community = `${prefix}visibility = 'community'`;
  if (scope === 'community') return `(${active} AND ${community})`;
  const ws = bindWorkspace();
  const source = `${prefix}workspace_id = ${ws}`;
  const own = `(${source} AND ${prefix}owner_roll = ${bindRoll()})`;
  if (scope === 'mine') return `(${active} AND ${own})`;
  const workspace = `(${prefix}visibility = 'workspace' AND (${source} OR EXISTS (
    SELECT 1 FROM asset_workspace_grants g WHERE g.asset_id = ${prefix || 'assets.'}id AND g.workspace_id = ${ws}
  )))`;
  return `(${active} AND (${own} OR ${workspace} OR ${community}))`;
}

// Row-level read check for single-asset routes. isWorkspaceMember: the
// caller belongs to the asset's source workspace; hasGrant: the caller
// belongs to a workspace the asset is granted into.
export function canSeeAsset(row: { owner_roll: string; visibility: AssetVisibility; status: LibraryStatus }, roll: string, isWorkspaceMember: boolean, hasGrant = false): boolean {
  if (row.status !== 'active') return false;
  if (row.visibility === 'community') return true;
  if (isWorkspaceMember && row.owner_roll === roll) return true;
  return row.visibility === 'workspace' && (isWorkspaceMember || hasGrant);
}

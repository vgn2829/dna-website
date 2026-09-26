// ─────────────────────────────────────────────────────────────────────────
// Shared Creative Library — personal/community visibility for templates and
// assets (both workspace-scoped; see db/schema.ts).
//
// Visibility is a layer INSIDE a workspace, never across one: every route
// still requires workspace membership first (getWorkspaceMembership), and
// then
//   personal  — only the item's owner (owner_roll) can see or use it
//   community — every member of the item's workspace can see and use it
// Only the owner ever manages an item (edit, delete, publish/unpublish).
// Nothing here is public: no anonymous access, no cross-workspace listing,
// no storage change — publishing flips this column and nothing else.
//
// Moderation (status): an admin can hide any item. A hidden item is out of
// every normal flow — lists, search, direct fetches, Use, owner actions —
// for everyone, its owner included, exactly as if it did not exist; only
// the admin moderation endpoints (requireAdmin) see and restore it. Hiding
// never deletes the row or its stored file.
// ─────────────────────────────────────────────────────────────────────────

export const LIBRARY_VISIBILITIES = ['personal', 'community'] as const;
export type LibraryVisibility = typeof LIBRARY_VISIBILITIES[number];

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

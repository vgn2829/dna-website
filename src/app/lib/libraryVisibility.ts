import type { LibraryScope, LibraryVisibility } from './api';

// ─────────────────────────────────────────────────────────────────────────
// Shared Creative Library — client-side helpers for templates and assets.
// The server decides what a user may see (lib/libraryVisibility.ts in the
// backend applies every scope in SQL); these only label items, pick which
// controls to show, and keep an already-loaded list consistent after a
// local change (publish, unpublish, upload) without refetching.
// ─────────────────────────────────────────────────────────────────────────

interface LibraryItem {
  owner_roll: string;
  owner_name: string | null;
  visibility: LibraryVisibility;
}

export const VISIBILITY_LABEL: Record<LibraryVisibility, string> = {
  personal: 'Personal',
  community: 'Community',
};

export function isLibraryOwner(item: Pick<LibraryItem, 'owner_roll'>, roll: string | null | undefined): boolean {
  return !!roll && item.owner_roll === roll;
}

// Would this item appear under the given scope for this user? Mirrors the
// server's predicate so a locally-updated item can be kept or dropped.
export function matchesLibraryScope(item: Pick<LibraryItem, 'owner_roll' | 'visibility'>, scope: LibraryScope, roll: string): boolean {
  if (scope === 'mine') return item.owner_roll === roll;
  if (scope === 'community') return item.visibility === 'community';
  return item.owner_roll === roll || item.visibility === 'community';
}

// "by you" for the viewer's own items, otherwise the creator's name.
export function libraryAttribution(item: LibraryItem, roll: string | null | undefined): string {
  if (isLibraryOwner(item, roll)) return 'by you';
  return `by ${item.owner_name?.trim() || 'a workspace member'}`;
}

// Helper copy under the Personal/Community control. A personal workspace
// has no other members, so community sharing is unavailable there.
export function visibilityHint(visibility: LibraryVisibility, kind: 'template' | 'asset', workspaceName: string, isPersonalWorkspace: boolean): string {
  if (isPersonalWorkspace) {
    return `Only you can use this ${kind}. Community sharing is available in team workspaces.`;
  }
  return visibility === 'personal'
    ? `Only you can use this ${kind}.`
    : `Anyone in ${workspaceName} can discover and use this ${kind}. Only you can edit or delete it.`;
}

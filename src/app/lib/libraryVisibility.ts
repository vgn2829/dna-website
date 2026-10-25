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

// Can this kind be published to Community from here? Templates: community
// is the workspace's members, so a personal workspace has no one to share
// with. Assets: always — Community is also what lets the owner share an
// asset with another (team) workspace, which is how an asset kept in a
// personal workspace reaches anyone else.
export function communityAvailable(kind: 'template' | 'asset', isPersonalWorkspace: boolean): boolean {
  return kind === 'asset' || !isPersonalWorkspace;
}

// May this viewer remove an asset that was SHARED INTO this workspace from
// another one? Only an owner/admin of this workspace, and never their own
// asset (owners manage sharing from Share with workspace…). The server
// enforces the same rule; this only decides whether to offer the action.
export function canRemoveIncomingShare(
  asset: { workspace_id: string; owner_roll: string },
  workspaceId: string,
  roll: string,
  workspaceRole: 'owner' | 'admin' | 'member' | null | undefined,
): boolean {
  return asset.workspace_id !== workspaceId && asset.owner_roll !== roll && (workspaceRole === 'owner' || workspaceRole === 'admin');
}

// Toast after an asset is published to Community. From a personal workspace
// nobody else can see it yet — say so, so the next step (sharing) is clear.
export function assetPublishedMessage(workspaceName: string, isPersonalWorkspace: boolean): string {
  return isPersonalWorkspace
    ? 'Published to Community — share it with a workspace so others can use it'
    : `Published to Community — everyone in ${workspaceName} can use it`;
}

// Helper copy under the Personal/Community control.
export function visibilityHint(visibility: LibraryVisibility, kind: 'template' | 'asset', workspaceName: string, isPersonalWorkspace: boolean): string {
  if (kind === 'asset') {
    if (visibility === 'personal') return 'Only you can use this asset.';
    return isPersonalWorkspace
      ? 'Only workspaces you share it with can use it — choose Share with workspace… from its ⋯ menu. Only you can edit or delete it.'
      : `Anyone in ${workspaceName} can discover and use this asset, plus any workspace you share it with. Only you can edit or delete it.`;
  }
  if (isPersonalWorkspace) {
    return `Only you can use this ${kind}. Community sharing is available in team workspaces.`;
  }
  return visibility === 'personal'
    ? `Only you can use this ${kind}.`
    : `Anyone in ${workspaceName} can discover and use this ${kind}. Only you can edit or delete it.`;
}

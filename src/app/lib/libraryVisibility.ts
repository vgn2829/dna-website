import type { AssetVisibility, LibraryScope } from './api';

// ─────────────────────────────────────────────────────────────────────────
// Shared Creative Library — client-side helpers for templates and assets.
// The server decides what a user may see (lib/libraryVisibility.ts in the
// backend applies every scope in SQL); these only label items, pick which
// controls to show, and keep an already-loaded list consistent after a
// local change (publish, unpublish, upload) without refetching.
// ─────────────────────────────────────────────────────────────────────────

// A template's visibility is personal | community; an asset's also has
// 'workspace' (see api.ts), so these helpers take the wider type.
interface LibraryItem {
  owner_roll: string;
  owner_name: string | null;
  visibility: AssetVisibility;
}

export const VISIBILITY_LABEL: Record<AssetVisibility, string> = {
  personal: 'Personal',
  workspace: 'Workspace',
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
  return item.owner_roll === roll || item.visibility !== 'personal';
}

// "by you" for the viewer's own items, otherwise the creator's name.
export function libraryAttribution(item: LibraryItem, roll: string | null | undefined): string {
  if (isLibraryOwner(item, roll)) return 'by you';
  return `by ${item.owner_name?.trim() || 'a workspace member'}`;
}

// Can this kind be published to Community from here? Templates: community
// is the workspace's members, so a personal workspace has no one to share
// with. Assets: always — an asset's Community is the whole club.
export function communityAvailable(kind: 'template' | 'asset', isPersonalWorkspace: boolean): boolean {
  return kind === 'asset' || !isPersonalWorkspace;
}

// May this viewer remove an asset that was SHARED INTO this workspace from
// another one? Only an owner/admin of this workspace, never their own asset
// (owners manage sharing from Share with workspace…), and only a Workspace
// asset — a Community one from elsewhere is here through publication, not a
// share, so there is nothing to remove. The server enforces the same rule;
// this only decides whether to offer the action.
export function canRemoveIncomingShare(
  asset: { workspace_id: string; owner_roll: string; visibility: AssetVisibility },
  workspaceId: string,
  roll: string,
  workspaceRole: 'owner' | 'admin' | 'member' | null | undefined,
): boolean {
  return asset.visibility === 'workspace' && asset.workspace_id !== workspaceId && asset.owner_roll !== roll && (workspaceRole === 'owner' || workspaceRole === 'admin');
}

// Where a viewer's asset from another workspace came from, for the card.
export function foreignAssetLabel(asset: { workspace_id: string; visibility: AssetVisibility }, workspaceId: string): string | null {
  if (asset.workspace_id === workspaceId) return null;
  return asset.visibility === 'community' ? 'From another workspace' : 'Shared from another workspace';
}

// What the owner's Share with workspace… dialog offers:
//   share         — add or stop shares (an active Workspace asset);
//   publish-first — a Personal asset must be set to Workspace first;
//   community     — already in Community, so every member can use it and no
//                   share is needed (existing shares can still be stopped);
//   manage-only   — the owner left the asset's workspace: existing shares
//                   can be stopped, nothing new can be shared (or published).
export type ShareDialogMode = 'share' | 'publish-first' | 'community' | 'manage-only';
export function shareDialogMode(canShare: boolean, visibility: AssetVisibility): ShareDialogMode {
  if (!canShare) return 'manage-only';
  if (visibility === 'community') return 'community';
  return visibility === 'workspace' ? 'share' : 'publish-first';
}

// The visibility choices for each kind, in display order.
export function visibilityOptions(kind: 'template' | 'asset'): AssetVisibility[] {
  return kind === 'asset' ? ['personal', 'workspace', 'community'] : ['personal', 'community'];
}

// Admin panel toast after an override, saying who can now use the item.
export function adminVisibilityMessage(kind: 'template' | 'asset', name: string, visibility: AssetVisibility): string {
  if (visibility === 'personal') return `“${name}” set to Personal — only its owner can use it`;
  if (kind === 'template') return `“${name}” set to Community — members of its workspace can use it`;
  return visibility === 'community'
    ? `“${name}” published to Community — every signed-in member can find it, from any workspace`
    : `“${name}” set to Workspace — its workspace and the workspaces it’s shared with can use it`;
}

// Toast after an asset's visibility changes, saying who can now use it.
export function assetVisibilityMessage(visibility: AssetVisibility, workspaceName: string, isPersonalWorkspace: boolean): string {
  if (visibility === 'community') return 'Published to Community — every DnA member can find and use it, from any workspace';
  if (visibility === 'personal') return 'Made personal — only you can use it now';
  return isPersonalWorkspace
    ? 'Set to Workspace — choose Share with workspace… to pick which teams can use it'
    : `Set to Workspace — everyone in ${workspaceName} can use it`;
}

// Helper copy under the Personal/Community control.
export function visibilityHint(visibility: AssetVisibility, kind: 'template' | 'asset', workspaceName: string, isPersonalWorkspace: boolean): string {
  if (kind === 'asset') {
    if (visibility === 'personal') return 'Only you can use this asset.';
    if (visibility === 'community') return 'Every signed-in DnA member can discover and use this asset, from any workspace. Only you can edit or delete it.';
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

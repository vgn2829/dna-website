import type { Asset, Board } from './api';

// ─────────────────────────────────────────────────────────────────────────
// Decisions behind the Assets preview (components/assets/AssetPreviewModal)
// — what a card click opens, what the preview can render, where Download
// points, and which moodboards an asset may be added to. Pure, so the
// rules are unit-tested without rendering anything.
// ─────────────────────────────────────────────────────────────────────────

// Larger PDFs are not pulled into memory just to preview — Download still
// works for them.
export const PDF_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

export type AssetPreviewMode = 'image' | 'pdf' | 'fallback';

// A card opens the preview for anything with a stored object. Links have
// nothing to preview or download, so they keep opening the external URL.
export function opensPreview(asset: Pick<Asset, 'kind' | 'url'>): boolean {
  return asset.kind !== 'link' && !!asset.url;
}

// PDFs are stored as octet-stream downloads, so they are previewed from a
// fetched copy in the browser's own PDF viewer — never a third-party
// viewer, which would hand a private asset's URL to someone else. Phones
// mostly can't show a PDF inline, so they get the fallback tile.
export function assetPreviewMode(
  asset: Pick<Asset, 'kind' | 'url' | 'extension' | 'size_bytes'>,
  env: { isMobile: boolean; pdfViewerEnabled: boolean },
): AssetPreviewMode {
  if (!asset.url) return 'fallback';
  if (asset.kind === 'image') return 'image';
  if (
    asset.kind === 'file' && asset.extension === 'pdf' && !env.isMobile && env.pdfViewerEnabled
    && asset.size_bytes != null && asset.size_bytes <= PDF_PREVIEW_MAX_BYTES
  ) return 'pdf';
  return 'fallback';
}

export function assetDownloadHref(asset: Pick<Asset, 'url' | 'download_url'>): string | null {
  return asset.download_url ?? asset.url;
}

// Only images can be placed on a moodboard canvas.
export function canAddToMoodboard(asset: Pick<Asset, 'kind' | 'url'>): boolean {
  return asset.kind === 'image' && !!asset.url;
}

// What the client can already tell about a destination board. A Personal
// asset only ever reaches boards in its own workspace; Workspace and
// Community reach depends on grants and memberships only the server knows,
// so those are left for it to decide.
export function moodboardBlocker(
  asset: Pick<Asset, 'visibility' | 'workspace_id'>,
  board: Pick<Board, 'workspace_id'>,
): 'personal-elsewhere' | null {
  return asset.visibility === 'personal' && board.workspace_id !== asset.workspace_id ? 'personal-elsewhere' : null;
}

// Boards the asset can go on first, the rest after — each group keeps the
// server's order.
export function orderMoodboardTargets<B extends Pick<Board, 'workspace_id'>>(
  asset: Pick<Asset, 'visibility' | 'workspace_id'>,
  boards: B[],
): B[] {
  return [...boards.filter(b => !moodboardBlocker(asset, b)), ...boards.filter(b => moodboardBlocker(asset, b))];
}

export type AddToMoodboardFailure = 'session' | 'no-edit' | 'unavailable' | 'other';

// Maps an addAssetItem rejection (api.ts request() throws the server's
// error string) to what the person is told.
export function classifyAddToMoodboardError(err: unknown): AddToMoodboardFailure {
  const message = err instanceof Error ? err.message : '';
  if (message === 'SESSION_EXPIRED') return 'session';
  if (message === 'Access denied') return 'no-edit';
  if (message === 'Asset not available on this board' || message === 'Board not found') return 'unavailable';
  return 'other';
}

export const ADD_TO_MOODBOARD_ERROR: Record<AddToMoodboardFailure, string> = {
  session: 'Your session expired — sign in again to add to a moodboard',
  'no-edit': 'You can only add to boards you can edit',
  unavailable: 'This asset can’t be used on that board — it isn’t available in the board’s workspace',
  other: 'Couldn’t add to the moodboard — try again',
};

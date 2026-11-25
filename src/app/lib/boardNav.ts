import type { Workspace } from './api';
import { workspaceLabel } from './workspaceSearch';

// ─────────────────────────────────────────────────────────────────────────
// Board header navigation (BoardPage). Deterministic upward links —
// Workspace home → Moodboards → Board — instead of the old "← Boards"
// button's navigate(-1), which went wherever the browser history pointed
// (Home, Templates, a notification, or nowhere for a shared link).
// ─────────────────────────────────────────────────────────────────────────

export interface Crumb {
  label: string;
  // Absent for the current page (the board itself).
  href?: string;
}

export const WORKSPACE_HOME_HREF = '/home';
export const MOODBOARDS_HREF = '/moodboards';

// The board's workspace is named when the viewer is a member of it (it's
// in their own workspace list); a board reached through a direct share
// from a workspace the viewer isn't in falls back to "Workspace". Either
// way the crumb leads to the viewer's own workspace home.
export function boardCrumbs(
  boardName: string,
  workspaceId: string | null | undefined,
  workspaces: Pick<Workspace, 'id' | 'name' | 'is_personal'>[]
): Crumb[] {
  const ws = workspaceId ? workspaces.find(w => w.id === workspaceId) : undefined;
  return [
    { label: ws ? workspaceLabel(ws) : 'Workspace', href: WORKSPACE_HOME_HREF },
    { label: 'Moodboards', href: MOODBOARDS_HREF },
    { label: boardName },
  ];
}

// Secondary board actions (Assets, History, Save as Template, Delete) move
// into the "⋯" overflow menu when the full row can't fit — below the lg
// breakpoint, 1024px (the desktop row needs ~630px of buttons beside the
// breadcrumb) — and in fullscreen, where the header is deliberately
// minimal.
export function isCompactBoardHeader(lgUp: boolean, isFullscreen: boolean): boolean {
  return isFullscreen || !lgUp;
}

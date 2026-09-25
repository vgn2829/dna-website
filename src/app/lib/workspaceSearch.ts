import type { Workspace } from './api';

// Display label used everywhere a workspace is named in the UI — the
// personal workspace is always shown as "Personal", never its stored name.
export function workspaceLabel(ws: Pick<Workspace, 'is_personal' | 'name'>): string {
  return ws.is_personal ? 'Personal' : ws.name;
}

// The "All Workspaces" (activeWorkspaceId === null) choice in the switcher
// only means something when there's more than one workspace to span. It is
// a selection, not a workspace, so it is never subject to the name search.
export function showAllWorkspacesOption(workspaces: readonly unknown[]): boolean {
  return workspaces.length > 1;
}

// Case-insensitive substring match on the display label. An empty/blank
// query returns the list unchanged (same array order).
export function filterWorkspaces<T extends Pick<Workspace, 'is_personal' | 'name'>>(workspaces: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return workspaces;
  return workspaces.filter(ws => workspaceLabel(ws).toLowerCase().includes(q));
}

export const ALL_WORKSPACES_LABEL = 'All Workspaces';

// The one source for "which workspace is this page showing?" — used by the
// sidebar switcher and every workspace page's context caption, so they can
// never disagree. Pages that can span every workspace (Moodboards, Home's
// boards) show "All Workspaces" when none is selected. Per-workspace pages
// (Assets, Projects, Templates) can't: with "All Workspaces" selected they
// show the Personal workspace, and say so (`fallbackToPersonal`) instead of
// silently labelling it "Personal" next to a switcher that says "All".
export function workspaceContext(
  activeWorkspace: Pick<Workspace, 'is_personal' | 'name'> | null,
  opts: { spansAllWorkspaces: boolean },
): { label: string; fallbackToPersonal: boolean } {
  if (activeWorkspace) return { label: workspaceLabel(activeWorkspace), fallbackToPersonal: false };
  if (opts.spansAllWorkspaces) return { label: ALL_WORKSPACES_LABEL, fallbackToPersonal: false };
  return { label: 'Personal', fallbackToPersonal: true };
}

// Shown under a per-workspace page's title while "All Workspaces" is selected.
export function personalFallbackNote(what: string): string {
  return `${ALL_WORKSPACES_LABEL} doesn't apply to ${what} — showing your Personal workspace.`;
}

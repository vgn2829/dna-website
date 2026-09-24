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

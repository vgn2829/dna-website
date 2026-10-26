// ─────────────────────────────────────────────────────────────────────────
// Workspace list loading — the pure decisions behind WorkspaceContext and
// the workspace-scoped pages (Assets, Templates, Projects).
//
// After a hard refresh, a typed URL or a new tab, the first render happens
// before the workspace fetch has even started. That moment must read as
// "loading", never as "loaded, and this user has no workspaces" — which
// those pages render as "No workspace available yet." / "Select a
// workspace to view…". And a failed fetch must read as an error the user
// can recover from, not as an empty list.
// ─────────────────────────────────────────────────────────────────────────

export type WorkspaceLoadError = 'failed' | 'session-expired';

// Still loading while a fetch is in flight, or until a fetch for THIS
// signed-in roll has settled (loaded or failed). Signed out: not loading.
export function workspaceListLoading(roll: string | null, fetching: boolean, settledRoll: string | null): boolean {
  return roll !== null && (fetching || settledRoll !== roll);
}

export type WorkspacePageGate = 'loading' | 'error' | 'no-workspace' | 'ready';

// What a workspace-scoped page shows before its own content. A list that
// is already on screen stays usable while it reloads or after a failed
// refresh; only an empty list defers to loading / error.
export function workspacePageGate(state: {
  loading: boolean;
  loadError: WorkspaceLoadError | null;
  workspaceCount: number;
  hasTargetWorkspace: boolean;
}): WorkspacePageGate {
  if (state.workspaceCount === 0) {
    if (state.loading) return 'loading';
    if (state.loadError) return 'error';
  }
  return state.hasTargetWorkspace ? 'ready' : 'no-workspace';
}

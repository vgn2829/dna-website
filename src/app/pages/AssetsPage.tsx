import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { workspaceContext, personalFallbackNote } from '../lib/workspaceSearch';
import { AssetBrowser } from '../components/assets/AssetBrowser';

// ─────────────────────────────────────────────────────────────────────────
// AssetsPage — the Workspace Asset Library as a real page: existing
// assets are browsable immediately, with search, type tabs, collections,
// pagination and "+ Add Asset" (components/assets/AssetBrowser.tsx — the
// same browser the board's asset picker modal uses, against the same
// workspace-scoped /api/assets surface; no second asset API or storage
// system). Previously this route mounted the AssetLibrary MODAL over the
// shell, so "Assets" behaved like an upload dialog and closing it
// navigated away.
//
// Workspace scoping: reads WorkspaceContext.activeWorkspaceId exactly
// like MoodboardsPage now does (Phase 4) — "All Workspaces" (null) has no
// single concrete workspace for a library to scope to (assets are always
// workspace-scoped, there is no cross-workspace asset list — same
// constraint AssetLibrary's pre-existing MoodboardsPage call site already
// had), so this page falls back to the caller's personal workspace,
// mirroring MoodboardsPage's own pre-existing assetsWorkspaceId fallback.
// ─────────────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const { studentSession, openRollModal } = useStudent();
  const { activeWorkspaceId, workspaces, personalWorkspace, loading } = useWorkspace();

  if (!studentSession) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center' }}>
        <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 16 }}>
          Sign in to view and manage your assets.
        </p>
        <button onClick={openRollModal} className="btn-primary">
          Sign in
        </button>
      </div>
    );
  }

  if (loading && workspaces.length === 0) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
        Loading…
      </div>
    );
  }

  const activeWorkspace = activeWorkspaceId ? workspaces.find(w => w.id === activeWorkspaceId) ?? null : null;
  const targetWorkspace = activeWorkspace ?? personalWorkspace;
  const context = workspaceContext(activeWorkspaceId ? targetWorkspace : null, { spansAllWorkspaces: false });

  if (!targetWorkspace) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
        No workspace available yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <p className="type-caption" style={{ marginBottom: 8 }}>
          {context.label}
        </p>
        <h1 className="type-display-md" style={{ margin: 0 }}>
          Assets
        </h1>
        <p className="type-body" style={{ margin: '10px 0 0', color: 'var(--color-ink-muted)' }}>
          Workspace asset library
        </p>
        {context.fallbackToPersonal && (
          <p className="type-micro" style={{ margin: 'var(--space-xs) 0 0' }}>{personalFallbackNote('assets')}</p>
        )}
      </div>

      <AssetBrowser
        key={targetWorkspace.id}
        workspaceId={targetWorkspace.id}
        workspaceName={targetWorkspace.is_personal ? 'Personal' : targetWorkspace.name}
        roll={studentSession.rollNumber}
        isPersonalWorkspace={targetWorkspace.is_personal}
      />
    </div>
  );
}

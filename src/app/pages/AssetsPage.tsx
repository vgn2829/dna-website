import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
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
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--color-ink-muted)', marginBottom: 16 }}>
          Sign in to view and manage your assets.
        </p>
        <button
          onClick={openRollModal}
          style={{
            padding: '10px 20px', background: 'var(--color-brand)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14,
            fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
          }}
        >
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

  if (!targetWorkspace) {
    return (
      <div style={{ padding: '80px 0', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)' }}>
        No workspace available yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-muted)', letterSpacing: '-0.13px', fontFamily: 'var(--font-body)', marginBottom: 8 }}>
          {targetWorkspace.is_personal ? 'Personal' : targetWorkspace.name}
        </p>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(32px,4.5vw,52px)', fontWeight: 500, lineHeight: 0.95, letterSpacing: '-2px', color: 'var(--color-ink)' }}>
          Assets
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          Workspace asset library
        </p>
      </div>

      <AssetBrowser
        key={targetWorkspace.id}
        workspaceId={targetWorkspace.id}
        workspaceName={targetWorkspace.is_personal ? 'Personal' : targetWorkspace.name}
        roll={studentSession.rollNumber}
      />
    </div>
  );
}

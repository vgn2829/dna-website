import { useNavigate } from 'react-router';
import { useStudent } from '../context/StudentContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { AssetLibrary } from '../components/AssetLibrary';

// ─────────────────────────────────────────────────────────────────────────
// AssetsPage (V2.0 Phase 5) — the first-class /assets route. Deliberately
// thin: per the V2.0 brief, this phase only needs "Assets has a route,
// workspace scoping works, existing AssetLibrary functionality remains
// available" — NOT the full V2.1 Asset Workspace redesign (grid layout,
// filters, drag-to-board, etc.). AssetLibrary.tsx already IS the entire
// Asset Manager UI (upload/browse/delete against the existing
// workspace-scoped /api/assets surface) — this page just gives it a
// permanent home instead of a modal triggered from MoodboardsPage/
// BoardPage, with zero changes to AssetLibrary itself, so there is no
// duplicate asset API and no duplicate storage system (both explicitly
// disallowed by the brief).
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
  const navigate = useNavigate();

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
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-muted)', letterSpacing: '-0.13px', fontFamily: 'var(--font-body)', marginBottom: 8 }}>
          {targetWorkspace.is_personal ? 'Personal' : targetWorkspace.name}
        </p>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(32px,4.5vw,52px)', fontWeight: 500, lineHeight: 0.95, letterSpacing: '-2px', color: 'var(--color-ink)' }}>
          Assets
        </h1>
      </div>

      <AssetLibrary
        workspaceId={targetWorkspace.id}
        workspaceName={targetWorkspace.is_personal ? 'Personal' : targetWorkspace.name}
        roll={studentSession.rollNumber}
        onClose={() => navigate('/home')}
      />
    </div>
  );
}

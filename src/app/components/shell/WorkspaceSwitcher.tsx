import { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { WorkspacesPanel } from '../WorkspacesPanel';
import { WorkspaceSettingsModal } from '../WorkspaceSettingsModal';
import { useStudent } from '../../context/StudentContext';

// ─────────────────────────────────────────────────────────────────────────
// WorkspaceSwitcher (V2.0 Phase 2) — the shell-header workspace picker.
// Behaviorally the same "All Workspaces" + per-workspace pill switcher
// MoodboardsPage.tsx used to render inline, now driven by WorkspaceContext
// instead of page-local state, and available on every page under the
// shell (not just Moodboards). Reuses WorkspacesPanel/WorkspaceSettingsModal
// unchanged — this component only supplies them with context data instead
// of page-local props.
// ─────────────────────────────────────────────────────────────────────────

export function WorkspaceSwitcher() {
  const { studentSession } = useStudent();
  const {
    activeWorkspaceId, workspaces, switchWorkspace,
    addWorkspaceLocal, renameWorkspaceLocal, removeWorkspaceLocal,
  } = useWorkspace();
  const [showPanel, setShowPanel] = useState(false);
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null);

  if (!studentSession) return null;

  const activeWorkspace = activeWorkspaceId ? workspaces.find(w => w.id === activeWorkspaceId) ?? null : null;
  const activeLabel = activeWorkspace ? (activeWorkspace.is_personal ? 'Personal' : activeWorkspace.name) : 'All Workspaces';

  return (
    <>
      <button
        onClick={() => setShowPanel(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 10px', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)', background: 'var(--color-surface-1)',
          color: 'var(--color-ink)', fontSize: 13, fontWeight: 600,
          fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 'var(--radius-sm)', flexShrink: 0,
            background: 'var(--color-brand)', color: '#fff', fontSize: 11, fontWeight: 700,
          }}
        >
          {activeLabel.charAt(0).toUpperCase()}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeLabel}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.6 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <WorkspacesPanel
        open={showPanel}
        onClose={() => setShowPanel(false)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        roll={studentSession.rollNumber}
        onSwitch={workspaceId => { switchWorkspace(workspaceId); setShowPanel(false); }}
        onOpenSettings={workspaceId => setSettingsWorkspaceId(workspaceId)}
        onWorkspaceCreated={addWorkspaceLocal}
      />

      {settingsWorkspaceId && (
        <WorkspaceSettingsModal
          workspaceId={settingsWorkspaceId}
          roll={studentSession.rollNumber}
          onClose={() => setSettingsWorkspaceId(null)}
          onRenamed={(workspaceId, name) => renameWorkspaceLocal(workspaceId, name)}
          onDeleted={workspaceId => {
            removeWorkspaceLocal(workspaceId);
            setSettingsWorkspaceId(null);
          }}
          onLeft={workspaceId => {
            removeWorkspaceLocal(workspaceId);
            setSettingsWorkspaceId(null);
          }}
        />
      )}
    </>
  );
}

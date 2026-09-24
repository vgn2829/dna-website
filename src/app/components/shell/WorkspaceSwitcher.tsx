import { useState } from 'react';
import { createPortal } from 'react-dom';
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
//
// Both modals are PORTALLED to document.body. This component lives inside
// the sidebar <aside>, which is position:sticky on desktop (sticky always
// creates a stacking context) and a transformed, z-indexed motion.aside in
// the mobile drawer (a transform makes it the containing block for fixed
// descendants). Rendered in place, the modals' z-index only competed inside
// that aside, so the shell header and positioned page content (board-card
// thumbnails, the Moodboards search box) painted OVER the open modal, and
// in the drawer the "full-screen" overlay was sized to the drawer. The
// portal puts them back in the root stacking context — no z-index change.
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
        className="ws-switcher"
        aria-label={`Workspace: ${activeLabel}. Switch or manage workspaces`}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44,
          padding: '8px 12px 8px 8px', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-hairline)', background: 'var(--color-surface-1)',
          color: 'var(--color-ink)', fontSize: 13, fontWeight: 600,
          fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 'var(--radius-sm)', flexShrink: 0,
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

      {createPortal(
        <>
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
        </>,
        document.body
      )}
    </>
  );
}

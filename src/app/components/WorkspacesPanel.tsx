import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { api, type Workspace } from '../lib/api';
import { rollToColor } from '../lib/utils';
import { useModalA11y } from './hooks/useModalA11y';
import { filterWorkspaces, showAllWorkspacesOption, workspaceLabel } from '../lib/workspaceSearch';

// ─────────────────────────────────────────────────────────────────────────
// Entry point for workspace management (Sharing & Invite Flow phase).
// The existing pill-row switcher in MoodboardsPage.tsx stays as-is for
// fast day-to-day switching — this panel is a separate, richer view opened
// via a "Manage Workspaces" affordance next to it, showing each workspace
// as a card (member/board counts, created date, role badge, current-
// workspace indicator) with Switch/Settings actions, plus workspace
// creation. Opening a workspace's Settings hands off to
// WorkspaceSettingsModal (rename/delete/leave/members/invite/roles) — this
// component owns listing + creation + switching only, not member
// management itself.
// ─────────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ROLE_LABEL: Record<Workspace['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export function WorkspacesPanel({
  open,
  onClose,
  workspaces,
  activeWorkspaceId,
  onSwitch,
  onOpenSettings,
  onWorkspaceCreated,
  roll,
}: {
  open: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSwitch: (workspaceId: string | null) => void;
  onOpenSettings: (workspaceId: string) => void;
  onWorkspaceCreated: (workspace: Workspace) => void;
  roll: string;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const visibleWorkspaces = filterWorkspaces(workspaces, query);

  const dialogRef = useModalA11y(open, onClose);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const workspace = await api.workspaces.create(roll, { name: trimmed });
      onWorkspaceCreated(workspace);
      toast.success(`"${workspace.name}" workspace created`);
      setShowCreate(false);
      setName('');
    } catch {
      toast.error('Failed to create workspace');
    } finally {
      setCreating(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={onClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspaces"
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 640,
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-xl)', padding: '24px 20px 20px',
              display: 'flex', flexDirection: 'column', gap: 16,
              // Strict containment: the card never grows past the viewport
              // and never lets children paint outside it; only the list
              // below scrolls (header, create and search stay put).
              maxHeight: 'min(85vh, 760px)', overflow: 'hidden',
              outline: 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h3 className="type-headline" style={{ margin: 0 }}>
                Workspaces
              </h3>
              <button
                onClick={onClose}
                aria-label="Close workspaces panel"
                className="btn-translucent btn-icon btn-sm touch-target"
                style={{ fontSize: 18 }}
              >
                ×
              </button>
            </div>

            {showCreate ? (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
                padding: 16, borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-hairline)', background: 'var(--color-surface-2)',
              }}>
                <label htmlFor="new-workspace-new-workspace-name" className="type-caption">
                  New Workspace Name
                </label>
                <input
                  id="new-workspace-new-workspace-name"
                  className="input-base"
                  type="text"
                  placeholder="e.g. Design Team"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
                  maxLength={100}
                  autoFocus
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleCreate}
                    disabled={creating || !name.trim()}
                    className="btn-primary"
                    style={{ flex: 1 }}
                  >
                    {creating ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setShowCreate(false); setName(''); }}
                    className="btn-translucent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="btn-translucent"
                style={{ flexShrink: 0, alignSelf: 'flex-start' }}
              >
                + New Workspace
              </button>
            )}

            <input
              className="input-base"
              type="search"
              placeholder="Search workspaces…"
              aria-label="Search workspaces"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ width: '100%', flexShrink: 0 }}
            />

            <div
              role="list"
              aria-label="Your workspaces"
              style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
                margin: '0 -4px', padding: '0 4px 2px',
              }}
            >
              {/* "All Workspaces" = activeWorkspaceId null (see
                  WorkspaceContext). Rendered from the FULL list, outside
                  the name search, so it can always be re-selected. */}
              {showAllWorkspacesOption(workspaces) && (
                <div
                  role="listitem"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    flexWrap: 'wrap',
                    padding: 14, borderRadius: 'var(--radius-lg)', flexShrink: 0, overflow: 'hidden',
                    border: `1px solid ${activeWorkspaceId === null ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
                    background: activeWorkspaceId === null ? 'color-mix(in srgb, var(--color-brand) 6%, transparent)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 240px' }}>
                    <div aria-hidden="true" style={{
                      width: 40, height: 40, borderRadius: 'var(--radius-md)', flexShrink: 0,
                      background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink)' }}>
                          All Workspaces
                        </p>
                        {activeWorkspaceId === null && (
                          <span className="type-micro" style={{
                          padding: '2px 7px', borderRadius: 'var(--radius-pill)',
                            background: 'var(--color-brand)', color: '#fff',
                            whiteSpace: 'nowrap',
                          }}>
                            Current
                          </span>
                        )}
                      </div>
                      <p className="type-caption" style={{ margin: '4px 0 0' }}>
                        Boards from every workspace you belong to
                      </p>
                    </div>
                  </div>
                  {activeWorkspaceId !== null && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
                      <button
                        onClick={() => onSwitch(null)}
                        aria-label="Switch to All Workspaces"
                          className="btn-translucent btn-sm touch-target"
                      >
                        Switch
                      </button>
                    </div>
                  )}
                </div>
              )}
              {visibleWorkspaces.length === 0 && (
                <p className="type-body" style={{ margin: 0, padding: '24px 0', textAlign: 'center', color: 'var(--color-ink-muted)' }}>
                  No workspaces match “{query.trim()}”.
                </p>
              )}
              {visibleWorkspaces.map(ws => {
                const isActive = activeWorkspaceId === ws.id;
                return (
                  <div
                    key={ws.id}
                    role="listitem"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      // Actions wrap under the name on narrow screens instead
                      // of squeezing the name down to a couple of letters.
                      flexWrap: 'wrap',
                      padding: 14, borderRadius: 'var(--radius-lg)', flexShrink: 0, overflow: 'hidden',
                      border: `1px solid ${isActive ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
                      background: isActive ? 'color-mix(in srgb, var(--color-brand) 6%, transparent)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 240px' }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 'var(--radius-md)', flexShrink: 0,
                        background: rollToColor(ws.id),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-body)',
                      }}>
                        {workspaceLabel(ws)[0].toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <p className="type-body-sm" style={{
                            margin: 0, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {workspaceLabel(ws)}
                          </p>
                          <span className="type-micro" style={{
                          padding: '2px 7px', borderRadius: 'var(--radius-pill)',
                            background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)',
                            whiteSpace: 'nowrap',
                          }}>
                            {ROLE_LABEL[ws.role]}
                          </span>
                          {isActive && (
                            <span className="type-micro" style={{
                          padding: '2px 7px', borderRadius: 'var(--radius-pill)',
                              background: 'var(--color-brand)', color: '#fff',
                              whiteSpace: 'nowrap',
                            }}>
                              Current
                            </span>
                          )}
                        </div>
                        <p className="type-caption" style={{ margin: '4px 0 0' }}>
                          {ws.member_count} {ws.member_count === 1 ? 'member' : 'members'} · {ws.board_count} {ws.board_count === 1 ? 'board' : 'boards'} · Created {formatDate(ws.created_at)}
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
                      {!isActive && (
                        <button
                          onClick={() => onSwitch(ws.id)}
                          aria-label={`Switch to ${ws.is_personal ? 'Personal' : ws.name}`}
                          className="btn-translucent btn-sm touch-target"
                        >
                          Switch
                        </button>
                      )}
                      {!ws.is_personal && (
                        <button
                          onClick={() => onOpenSettings(ws.id)}
                          aria-label={`Settings for ${ws.name}`}
                          className="btn-translucent btn-sm touch-target"
                        >
                          Settings
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

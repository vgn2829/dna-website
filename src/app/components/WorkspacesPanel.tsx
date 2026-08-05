import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { api, type Workspace } from '../lib/api';
import { rollToColor } from '../lib/utils';

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
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 640,
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-xl)', padding: '28px 24px',
              display: 'flex', flexDirection: 'column', gap: 20,
              maxHeight: '85vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{
                margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)',
                fontFamily: 'var(--font-display)', letterSpacing: '-0.3px',
              }}>
                Workspaces
              </h3>
              <button
                onClick={onClose}
                style={{
                  width: 32, height: 32, borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--color-hairline)', background: 'none',
                  color: 'var(--color-ink-muted)', fontSize: 18, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ×
              </button>
            </div>

            {showCreate ? (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 10,
                padding: 16, borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-hairline)', background: 'var(--color-surface-2)',
              }}>
                <label style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)',
                  letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                }}>
                  New Workspace Name
                </label>
                <input
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
                    style={{
                      flex: 1, padding: '10px 16px', background: 'var(--color-brand)', color: '#fff',
                      border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600,
                      fontFamily: 'var(--font-body)',
                      cursor: creating || !name.trim() ? 'not-allowed' : 'pointer',
                      opacity: creating || !name.trim() ? 0.6 : 1,
                    }}
                  >
                    {creating ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setShowCreate(false); setName(''); }}
                    style={{
                      padding: '10px 16px', background: 'none', color: 'var(--color-ink-muted)',
                      border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)',
                      fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                style={{
                  padding: '10px 16px', background: 'none', color: 'var(--color-brand)',
                  border: '1px dashed var(--color-brand)', borderRadius: 'var(--radius-lg)',
                  fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                + New Workspace
              </button>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {workspaces.map(ws => {
                const isActive = activeWorkspaceId === ws.id;
                return (
                  <div
                    key={ws.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: 16, borderRadius: 'var(--radius-lg)',
                      border: `1px solid ${isActive ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
                      background: isActive ? 'color-mix(in srgb, var(--color-brand) 6%, transparent)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 'var(--radius-md)', flexShrink: 0,
                        background: rollToColor(ws.id),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-body)',
                      }}>
                        {(ws.is_personal ? 'P' : ws.name)[0].toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <p style={{
                            margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-ink)',
                            fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {ws.is_personal ? 'Personal' : ws.name}
                          </p>
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                            padding: '2px 7px', borderRadius: 'var(--radius-pill)',
                            background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)',
                            fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
                          }}>
                            {ROLE_LABEL[ws.role]}
                          </span>
                          {isActive && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                              padding: '2px 7px', borderRadius: 'var(--radius-pill)',
                              background: 'var(--color-brand)', color: '#fff',
                              fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
                            }}>
                              Current
                            </span>
                          )}
                        </div>
                        <p style={{
                          margin: '4px 0 0', fontSize: 12, color: 'var(--color-ink-muted)',
                          fontFamily: 'var(--font-body)',
                        }}>
                          {ws.member_count} {ws.member_count === 1 ? 'member' : 'members'} · {ws.board_count} {ws.board_count === 1 ? 'board' : 'boards'} · Created {formatDate(ws.created_at)}
                        </p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {!isActive && (
                        <button
                          onClick={() => onSwitch(ws.id)}
                          style={{
                            padding: '7px 12px', background: 'none', color: 'var(--color-ink)',
                            border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)',
                            fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
                          }}
                        >
                          Switch
                        </button>
                      )}
                      {!ws.is_personal && (
                        <button
                          onClick={() => onOpenSettings(ws.id)}
                          style={{
                            padding: '7px 12px', background: 'none', color: 'var(--color-ink-muted)',
                            border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)',
                            fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
                          }}
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

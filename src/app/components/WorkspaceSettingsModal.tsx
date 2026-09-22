import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { api, type WorkspaceDetail } from '../lib/api';
import { rollToColor } from '../lib/utils';
import { useModalA11y } from './hooks/useModalA11y';

// ─────────────────────────────────────────────────────────────────────────
// Workspace Settings — rename, delete, leave, and full member management
// (list/invite/remove/role-change), gated by the caller's role exactly as
// the backend enforces it (routes/workspaces.ts): owner can do everything
// including promote/demote and delete; admin can add/remove members and
// rename, but cannot delete the workspace or touch the owner; member is
// read-only. This mirrors BoardPage.tsx's existing Collaborators modal
// (avatar/name/roll list, invite-by-roll input, inline error text) for
// visual consistency, extended with the role/joined-date columns and
// role-change controls a board's collaborator list doesn't need (boards
// only have owner/editor, not three tiers).
//
// Reuses api.workspaces.* exactly as built in the workspace-layer phase —
// no new backend endpoints, no schema changes.
// ─────────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ROLL_RE = /^[0-9]{2}[a-zA-Z0-9]{4,10}$/i;

type ConfirmAction = 'delete' | 'leave' | { removeRoll: string };

export function WorkspaceSettingsModal({
  workspaceId,
  roll,
  onClose,
  onRenamed,
  onDeleted,
  onLeft,
}: {
  workspaceId: string;
  roll: string;
  onClose: () => void;
  onRenamed: (workspaceId: string, name: string) => void;
  onDeleted: (workspaceId: string) => void;
  onLeft: (workspaceId: string) => void;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);

  const [inviteRoll, setInviteRoll] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviting, setInviting] = useState(false);

  const [busyRoll, setBusyRoll] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const dialogRef = useModalA11y(true, onClose);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api.workspaces.get(workspaceId, roll)
      .then(data => { if (!cancelled) setWorkspace(data); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspaceId, roll]);

  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';
  const isOwner = workspace?.role === 'owner';

  const handleRename = async () => {
    const trimmed = nameDraft.trim();
    if (!workspace || !trimmed || trimmed === workspace.name) { setEditingName(false); return; }
    setRenaming(true);
    try {
      await api.workspaces.update(workspaceId, roll, { name: trimmed });
      setWorkspace(prev => prev ? { ...prev, name: trimmed } : prev);
      onRenamed(workspaceId, trimmed);
      toast.success('Workspace renamed');
      setEditingName(false);
    } catch {
      toast.error('Failed to rename workspace');
    } finally {
      setRenaming(false);
    }
  };

  const handleInvite = async () => {
    const trimmed = inviteRoll.trim();
    if (!trimmed || !workspace) return;
    if (!ROLL_RE.test(trimmed)) {
      setInviteError('Invalid roll number format');
      return;
    }
    if (workspace.members.some(m => m.roll_number.toLowerCase() === trimmed.toLowerCase())) {
      setInviteError('Already a member of this workspace');
      return;
    }
    setInviting(true);
    setInviteError('');
    try {
      const res = await api.workspaces.addMember(workspaceId, roll, trimmed);
      setWorkspace(prev => prev ? {
        ...prev,
        member_count: prev.member_count + 1,
        members: [...prev.members, { roll_number: trimmed, name: res.name, role: 'member', added_at: new Date().toISOString() }],
      } : prev);
      toast.success(`Added ${res.name ?? trimmed} to the workspace`);
      setInviteRoll('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setInviteError(message.includes('not found') ? 'Student not found — they must register first' : 'Failed to add member');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (targetRoll: string) => {
    if (!workspace) return;
    setBusyRoll(targetRoll);
    try {
      await api.workspaces.removeMember(workspaceId, roll, targetRoll);
      setWorkspace(prev => prev ? {
        ...prev,
        member_count: prev.member_count - 1,
        members: prev.members.filter(m => m.roll_number !== targetRoll),
      } : prev);
      toast.success('Member removed');
    } catch {
      toast.error('Failed to remove member');
    } finally {
      setBusyRoll(null);
      setConfirmAction(null);
    }
  };

  const handleRoleChange = async (targetRoll: string, role: 'admin' | 'member') => {
    if (!workspace) return;
    setBusyRoll(targetRoll);
    try {
      await api.workspaces.setMemberRole(workspaceId, roll, targetRoll, role);
      setWorkspace(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.roll_number === targetRoll ? { ...m, role } : m),
      } : prev);
      toast.success(role === 'admin' ? 'Promoted to Admin' : 'Demoted to Member');
    } catch {
      toast.error('Failed to update role');
    } finally {
      setBusyRoll(null);
    }
  };

  const handleDelete = async () => {
    setConfirmBusy(true);
    try {
      await api.workspaces.delete(workspaceId, roll);
      toast.success('Workspace deleted');
      onDeleted(workspaceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      toast.error(message.includes('boards') ? 'Move or delete every board in this workspace first' : 'Failed to delete workspace');
      setConfirmBusy(false);
      setConfirmAction(null);
    }
  };

  const handleLeave = async () => {
    setConfirmBusy(true);
    try {
      await api.workspaces.leave(workspaceId, roll);
      toast.success('You left the workspace');
      onLeft(workspaceId);
    } catch {
      toast.error('Failed to leave workspace');
      setConfirmBusy(false);
      setConfirmAction(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}
        onClick={onClose}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Workspace settings"
          tabIndex={-1}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 460,
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 'var(--radius-xl)', padding: '28px 24px',
            display: 'flex', flexDirection: 'column', gap: 20,
            maxHeight: '85vh', overflowY: 'auto',
            outline: 'none',
          }}
        >
          {loading ? (
            // Matches MoodboardsPage.tsx's SkeletonCard convention
            // (.skeleton-pulse over var(--color-surface-2) blocks shaped
            // to mimic real content) rather than a plain "Loading..."
            // string, so the settings modal doesn't visually regress
            // relative to the rest of the app's loading states.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="skeleton-pulse" style={{ width: '60%', height: 22, borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)' }} />
              {[0, 1, 2].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                  <div className="skeleton-pulse" style={{ width: 32, height: 32, borderRadius: 'var(--radius-full)', background: 'var(--color-surface-2)' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="skeleton-pulse" style={{ width: '40%', height: 12, borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)' }} />
                    <div className="skeleton-pulse" style={{ width: '65%', height: 10, borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError || !workspace ? (
            <>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-error)', fontFamily: 'var(--font-body)', textAlign: 'center', padding: '20px 0' }}>
                Failed to load workspace settings.
              </p>
              <button
                onClick={onClose}
                style={{
                  padding: '10px 16px', background: 'none', color: 'var(--color-ink-muted)',
                  border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)',
                  fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
              >
                Close
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {editingName ? (
                  <input
                    className="input-base"
                    autoFocus
                    aria-label="Workspace name"
                    value={nameDraft}
                    onChange={e => setNameDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditingName(false); }}
                    onBlur={handleRename}
                    maxLength={100}
                    disabled={renaming}
                    style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)', flex: 1, marginRight: 12 }}
                  />
                ) : canManage ? (
                  <button
                    onClick={() => { setNameDraft(workspace.name); setEditingName(true); }}
                    aria-label={`${workspace.name}, click to rename`}
                    title="Click to rename"
                    style={{
                      margin: 0, padding: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)',
                      fontFamily: 'var(--font-display)', letterSpacing: '-0.3px',
                      background: 'none', border: 'none', cursor: 'text', textAlign: 'left',
                    }}
                  >
                    {workspace.name}
                  </button>
                ) : (
                  <h3 style={{
                    margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)',
                    fontFamily: 'var(--font-display)', letterSpacing: '-0.3px',
                  }}>
                    {workspace.name}
                  </h3>
                )}
                <button
                  onClick={onClose}
                  aria-label="Close workspace settings"
                  style={{
                    width: 32, height: 32, borderRadius: 'var(--radius-full)', flexShrink: 0,
                    border: '1px solid var(--color-hairline)', background: 'none',
                    color: 'var(--color-ink-muted)', fontSize: 18, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {workspace.members.map(m => {
                  const isTargetOwner = m.role === 'owner';
                  const busy = busyRoll === m.roll_number;
                  return (
                    <div key={m.roll_number} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '12px 0', borderBottom: '1px solid var(--color-hairline)', gap: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 'var(--radius-full)', flexShrink: 0,
                          background: rollToColor(m.roll_number),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-body)',
                        }}>
                          {(m.name ?? m.roll_number)[0].toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.name ?? m.roll_number}
                          </p>
                          <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                            {m.roll_number} · {isTargetOwner ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'} · Joined {formatDate(m.added_at)}
                          </p>
                        </div>
                      </div>

                      {!isTargetOwner && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          {isOwner && (
                            <button
                              onClick={() => handleRoleChange(m.roll_number, m.role === 'admin' ? 'member' : 'admin')}
                              disabled={busy}
                              aria-label={m.role === 'admin' ? `Demote ${m.name ?? m.roll_number} to Member` : `Promote ${m.name ?? m.roll_number} to Admin`}
                              style={{
                                fontSize: 11, color: 'var(--color-ink-muted)', background: 'none',
                                border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-sm)',
                                fontFamily: 'var(--font-body)', cursor: busy ? 'not-allowed' : 'pointer', padding: '4px 8px',
                                opacity: busy ? 0.5 : 1,
                              }}
                            >
                              {m.role === 'admin' ? 'Demote' : 'Promote'}
                            </button>
                          )}
                          {canManage && (
                            <button
                              onClick={() => setConfirmAction({ removeRoll: m.roll_number })}
                              disabled={busy}
                              aria-label={`Remove ${m.name ?? m.roll_number} from workspace`}
                              style={{
                                fontSize: 12, color: 'var(--color-error)', background: 'none', border: 'none',
                                fontFamily: 'var(--font-body)', cursor: busy ? 'not-allowed' : 'pointer', padding: '4px 8px',
                                opacity: busy ? 0.5 : 1,
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {canManage && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label htmlFor="workspace-invite-roll" style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)',
                    letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                  }}>
                    Invite by Roll Number
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="workspace-invite-roll"
                      className="input-base"
                      type="text"
                      placeholder="e.g. 250004"
                      value={inviteRoll}
                      onChange={e => { setInviteRoll(e.target.value); setInviteError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') handleInvite(); }}
                      maxLength={12}
                      style={{ flex: 1 }}
                    />
                    <button
                      onClick={handleInvite}
                      disabled={inviting || !inviteRoll.trim()}
                      style={{
                        padding: '0 16px', background: 'var(--color-brand)', color: '#fff',
                        border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600,
                        fontFamily: 'var(--font-body)',
                        cursor: inviting ? 'not-allowed' : 'pointer',
                        opacity: inviting ? 0.6 : 1,
                      }}
                    >
                      {inviting ? '...' : 'Invite'}
                    </button>
                  </div>
                  {inviteError && (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>
                      {inviteError}
                    </p>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, paddingTop: 4, borderTop: '1px solid var(--color-hairline)', marginTop: 4 }}>
                {isOwner ? (
                  <button
                    onClick={() => setConfirmAction('delete')}
                    style={{
                      flex: 1, padding: '10px 16px', background: 'none', color: 'var(--color-error)',
                      border: '1px solid var(--color-error)', borderRadius: 'var(--radius-sm)',
                      fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
                      marginTop: 12,
                    }}
                  >
                    Delete Workspace
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmAction('leave')}
                    style={{
                      flex: 1, padding: '10px 16px', background: 'none', color: 'var(--color-error)',
                      border: '1px solid var(--color-error)', borderRadius: 'var(--radius-sm)',
                      fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer',
                      marginTop: 12,
                    }}
                  >
                    Leave Workspace
                  </button>
                )}
              </div>
            </>
          )}
        </motion.div>
      </motion.div>

      {/* Confirmation — matches BoardPage.tsx's existing confirmDelete
          modal pattern exactly (no shared ConfirmDialog component exists
          in this codebase; this is the established per-instance modal
          shape). Handles all three destructive actions (delete workspace,
          leave workspace, remove member) via one small discriminated
          state, since they share the same visual shape. */}
      {confirmAction && workspace && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10001,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => { if (!confirmBusy) setConfirmAction(null); }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={confirmAction === 'delete' ? `Delete workspace "${workspace.name}"?` : confirmAction === 'leave' ? `Leave workspace "${workspace.name}"?` : 'Remove member confirmation'}
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 360,
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-xl)', padding: '28px 24px',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
              {confirmAction === 'delete' ? `Delete "${workspace.name}"?`
                : confirmAction === 'leave' ? `Leave "${workspace.name}"?`
                : `Remove this member?`}
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
              {confirmAction === 'delete'
                ? 'This will permanently delete the workspace. Every board must already be moved or deleted first. Cannot be undone.'
                : confirmAction === 'leave'
                ? 'You will lose access to every shared board in this workspace unless you\'re individually added back as a collaborator.'
                : 'They will lose the workspace-wide access this membership grants. Boards they were explicitly added to are unaffected.'}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => {
                  if (confirmAction === 'delete') handleDelete();
                  else if (confirmAction === 'leave') handleLeave();
                  else handleRemoveMember(confirmAction.removeRoll);
                }}
                disabled={confirmBusy}
                style={{
                  flex: 1, padding: '12px 20px', background: 'var(--color-error)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600,
                  fontFamily: 'var(--font-body)', cursor: confirmBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {confirmBusy ? 'Working...' : confirmAction === 'delete' ? 'Delete' : confirmAction === 'leave' ? 'Leave' : 'Remove'}
              </button>
              <button
                onClick={() => setConfirmAction(null)}
                disabled={confirmBusy}
                style={{
                  flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)',
                  border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-pill)',
                  fontSize: 13, fontFamily: 'var(--font-body)', cursor: confirmBusy ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

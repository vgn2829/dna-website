import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { api, type BoardDetail } from '../lib/api';
import { rollToColor } from '../lib/utils';
import { useModalA11y } from './hooks/useModalA11y';

// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for board sharing (Dashboard Polish phase). Was
// previously two separate, drifting implementations: BoardPage.tsx's own
// inline Share modal (visibility/edit_mode + collaborators + copy link +
// permission summary, unified from two modals into one in the Sharing &
// Invite Flow phase) and MoodboardsPage.tsx's card-level "Share & Invite"
// modal (an older, separately-maintained copy missing the workspace-access
// explanation and permission summary added to the former). This component
// replaces both call sites — BoardPage.tsx (which already has a live
// BoardDetail in memory) and MoodboardsPage.tsx's dashboard cards (which
// only have the list-shaped Board, no .members) — by being fully self-
// contained: it fetches its own BoardDetail via api.boards.getBoard on
// open, exactly like WorkspaceSettingsModal.tsx already does for
// workspaces, rather than requiring the caller to already hold detail data
// it may not have.
//
// onUpdated fires whenever a field a caller's own list/detail state might
// be showing changes (visibility, edit_mode, member_count) — callers patch
// their own state from it instead of this component reaching into two
// different parents' state shapes.
// ─────────────────────────────────────────────────────────────────────────

const ROLL_RE = /^[0-9]{2}[a-zA-Z0-9]{4,10}$/i;

export interface ShareBoardUpdate {
  visibility?: 'private' | 'shared';
  edit_mode?: 'members_only' | 'anyone';
  member_count?: number;
}

export function ShareBoardDialog({
  boardId,
  roll,
  onClose,
  onUpdated,
}: {
  boardId: string;
  roll: string;
  onClose: () => void;
  onUpdated?: (boardId: string, patch: ShareBoardUpdate) => void;
}) {
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [updatingVisibility, setUpdatingVisibility] = useState(false);
  const [updatingEditMode, setUpdatingEditMode] = useState(false);
  const [memberRoll, setMemberRoll] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [copied, setCopied] = useState(false);

  const dialogRef = useModalA11y(true, onClose);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api.boards.getBoard(boardId, roll)
      .then(data => { if (!cancelled) setBoard(data); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boardId, roll]);

  const isOwner = board?.owner_roll === roll;
  const shareUrl = `${window.location.origin}/moodboards/${boardId}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleVisibilityToggle = async (visibility: 'private' | 'shared') => {
    if (!board || board.visibility === visibility) return;
    setUpdatingVisibility(true);
    try {
      const updated = await api.boards.update(boardId, roll, { visibility });
      setBoard(prev => prev ? { ...prev, visibility: updated.visibility } : prev);
      onUpdated?.(boardId, { visibility: updated.visibility });
      toast.success(visibility === 'shared' ? 'Board is now shared' : 'Board is now private');
    } catch {
      toast.error('Failed to update visibility');
    } finally {
      setUpdatingVisibility(false);
    }
  };

  const handleEditModeToggle = async (edit_mode: 'members_only' | 'anyone') => {
    if (!board || board.edit_mode === edit_mode) return;
    setUpdatingEditMode(true);
    try {
      const updated = await api.boards.update(boardId, roll, { edit_mode });
      setBoard(prev => prev ? { ...prev, edit_mode: updated.edit_mode } : prev);
      onUpdated?.(boardId, { edit_mode: updated.edit_mode });
      toast.success('Edit access updated');
    } catch {
      toast.error('Failed to update edit access');
    } finally {
      setUpdatingEditMode(false);
    }
  };

  const handleAddMember = async () => {
    const trimmed = memberRoll.trim();
    if (!trimmed || !board) return;
    if (!ROLL_RE.test(trimmed)) {
      setMemberError('Invalid roll number format');
      return;
    }
    if (board.members.some(m => m.roll_number.toLowerCase() === trimmed.toLowerCase()) || trimmed.toLowerCase() === board.owner_roll.toLowerCase()) {
      setMemberError('Already a collaborator on this board');
      return;
    }
    setAddingMember(true);
    setMemberError('');
    try {
      const res = await api.boards.addMember(boardId, roll, trimmed);
      setBoard(prev => prev ? {
        ...prev,
        member_count: prev.member_count + 1,
        members: [...prev.members, { roll_number: trimmed, name: res.name, added_at: new Date().toISOString() }],
      } : prev);
      onUpdated?.(boardId, { member_count: (board.member_count ?? 0) + 1 });
      toast.success(`Added ${res.name ?? trimmed} as a collaborator`);
      setMemberRoll('');
    } catch {
      setMemberError('Student not found — must register first');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (targetRoll: string) => {
    if (!board) return;
    try {
      await api.boards.removeMember(boardId, roll, targetRoll);
      setBoard(prev => prev ? {
        ...prev,
        member_count: Math.max(0, prev.member_count - 1),
        members: prev.members.filter(m => m.roll_number !== targetRoll),
      } : prev);
      onUpdated?.(boardId, { member_count: Math.max(0, board.member_count - 1) });
      toast.success('Collaborator removed');
    } catch {
      toast.error('Failed to remove collaborator');
    }
  };

  return (
    <AnimatePresence>
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
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Share board"
          tabIndex={-1}
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 420,
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 'var(--radius-xl)',
            padding: '28px 24px',
            display: 'flex', flexDirection: 'column', gap: 20,
            maxHeight: '90vh', overflowY: 'auto',
            outline: 'none',
          }}
        >
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="skeleton-pulse" style={{ width: '50%', height: 20, borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)' }} />
              <div className="skeleton-pulse" style={{ width: '100%', height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)' }} />
              <div className="skeleton-pulse" style={{ width: '100%', height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)' }} />
            </div>
          ) : loadError || !board ? (
            <>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-error)', fontFamily: 'var(--font-body)', textAlign: 'center', padding: '20px 0' }}>
                Failed to load board details.
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
                <div>
                  <h3 style={{
                    margin: 0, fontSize: 18, fontWeight: 700,
                    color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px',
                  }}>
                    Share Board
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                    {board.name}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close share dialog"
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

              {/* Permission summary — always-visible answer to "who can do
                  what right now", combining visibility + edit_mode +
                  workspace-ceiling access into one sentence. */}
              <p style={{
                margin: 0, padding: '10px 12px', fontSize: 12, lineHeight: 1.5,
                color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)',
                background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-sm)',
              }}>
                {board.visibility === 'private'
                  ? 'Private — only the owner and explicitly added collaborators can open this board.'
                  : board.edit_mode === 'anyone'
                  ? 'Shared — anyone signed in can view and edit this board.'
                  : 'Shared — anyone signed in can view; workspace members and explicit collaborators can edit.'}
              </p>

              {isOwner && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{
                    margin: 0, fontSize: 11, fontWeight: 600,
                    color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                    textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                  }}>
                    Visibility
                  </p>
                  <div role="group" aria-label="Board visibility" style={{
                    display: 'flex', border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius-md)', overflow: 'hidden',
                  }}>
                    {(['private', 'shared'] as const).map(opt => (
                      <button
                        key={opt}
                        onClick={() => handleVisibilityToggle(opt)}
                        disabled={updatingVisibility}
                        aria-pressed={board.visibility === opt}
                        style={{
                          flex: 1, padding: '10px 0',
                          background: board.visibility === opt ? 'var(--color-brand)' : 'none',
                          border: 'none',
                          color: board.visibility === opt ? '#fff' : 'var(--color-ink-muted)',
                          fontSize: 13, fontWeight: board.visibility === opt ? 600 : 400,
                          fontFamily: 'var(--font-body)',
                          cursor: updatingVisibility ? 'not-allowed' : 'pointer',
                          textTransform: 'capitalize', transition: 'all 0.15s ease',
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                    {board.visibility === 'private'
                      ? 'Only invited collaborators can access.'
                      : 'Anyone with the link can view. Workspace members automatically get the access below — this is what makes a board "shared" different from just handing out a link.'
                    }
                  </p>
                </div>
              )}

              {isOwner && board.visibility === 'shared' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{
                    margin: 0, fontSize: 11, fontWeight: 600,
                    color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                    textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                  }}>
                    Who can edit?
                  </p>
                  <div role="group" aria-label="Who can edit this board" style={{
                    display: 'flex', border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius-md)', overflow: 'hidden',
                  }}>
                    {([
                      { value: 'members_only', label: 'Workspace + invited' },
                      { value: 'anyone', label: 'Anyone with link' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => handleEditModeToggle(opt.value)}
                        disabled={updatingEditMode}
                        aria-pressed={board.edit_mode === opt.value}
                        style={{
                          flex: 1, padding: '10px 0',
                          background: board.edit_mode === opt.value ? 'var(--color-brand)' : 'none',
                          border: 'none',
                          color: board.edit_mode === opt.value ? '#fff' : 'var(--color-ink-muted)',
                          fontSize: 12, fontWeight: board.edit_mode === opt.value ? 600 : 400,
                          fontFamily: 'var(--font-body)',
                          cursor: updatingEditMode ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                    "Workspace + invited" means anyone in this board's workspace can edit, on top of anyone explicitly added below — a private board opts out of that workspace-wide access entirely.
                  </p>
                </div>
              )}

              <div style={{ height: 1, background: 'var(--color-hairline)' }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{
                  margin: 0, fontSize: 11, fontWeight: 600,
                  color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                  textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                }}>
                  Collaborators
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0', borderBottom: '1px solid var(--color-hairline)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 'var(--radius-full)',
                        background: rollToColor(board.owner_roll),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-body)',
                      }}>
                        {(board.owner_name ?? board.owner_roll)[0].toUpperCase()}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                          {board.owner_name ?? board.owner_roll}
                        </p>
                        <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                          {board.owner_roll} · Owner
                        </p>
                      </div>
                    </div>
                  </div>

                  {board.members.map(m => (
                    <div key={m.roll_number} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 0', borderBottom: '1px solid var(--color-hairline)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 'var(--radius-full)',
                          background: rollToColor(m.roll_number),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-body)',
                        }}>
                          {(m.name ?? m.roll_number)[0].toUpperCase()}
                        </div>
                        <div>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                            {m.name ?? m.roll_number}
                          </p>
                          <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                            {m.roll_number}
                          </p>
                        </div>
                      </div>
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveMember(m.roll_number)}
                          aria-label={`Remove ${m.name ?? m.roll_number} from this board`}
                          style={{
                            fontSize: 12, color: 'var(--color-error)',
                            background: 'none', border: 'none',
                            fontFamily: 'var(--font-body)', cursor: 'pointer', padding: '4px 8px',
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {isOwner && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    <label htmlFor="share-dialog-invite-roll" style={{
                      fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)',
                      letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                    }}>
                      Add Collaborator by Roll Number
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        id="share-dialog-invite-roll"
                        className="input-base"
                        type="text"
                        placeholder="e.g. 250004"
                        value={memberRoll}
                        onChange={e => { setMemberRoll(e.target.value); setMemberError(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddMember(); }}
                        maxLength={12}
                        aria-invalid={!!memberError}
                        aria-describedby={memberError ? 'share-dialog-invite-error' : undefined}
                        style={{ flex: 1 }}
                      />
                      <button
                        onClick={handleAddMember}
                        disabled={addingMember || !memberRoll.trim()}
                        style={{
                          padding: '0 16px', background: 'var(--color-brand)', color: '#fff',
                          border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600,
                          fontFamily: 'var(--font-body)',
                          cursor: addingMember ? 'not-allowed' : 'pointer',
                          opacity: addingMember ? 0.6 : 1,
                        }}
                      >
                        {addingMember ? '...' : 'Add'}
                      </button>
                    </div>
                    {memberError && (
                      <p id="share-dialog-invite-error" role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>
                        {memberError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div style={{ height: 1, background: 'var(--color-hairline)' }} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{
                  margin: 0, fontSize: 11, fontWeight: 600,
                  color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                  textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                }}>
                  Board Link
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    flex: 1, padding: '10px 12px',
                    background: 'var(--color-canvas)',
                    border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius-sm)', fontSize: 12,
                    color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {shareUrl}
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCopy}
                    aria-label="Copy board link"
                    style={{
                      padding: '10px 16px',
                      background: copied ? 'var(--color-success)' : 'var(--color-brand)',
                      color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
                      fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                      transition: 'background 0.2s ease',
                    }}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </motion.button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

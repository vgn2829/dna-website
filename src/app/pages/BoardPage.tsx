import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useStudent } from '../context/StudentContext';
import { api, type BoardDetail } from '../lib/api';
import { clearBoardsCache } from './MoodboardsPage';

const TldrawCanvas = lazy(() =>
  import('./TldrawCanvas').then(m => ({ default: m.TldrawCanvas }))
);

function getSiteTheme(): 'dark' | 'light' {
  try {
    const stored = localStorage.getItem('dna-theme');
    if (stored === 'light') return 'light';
    if (stored === 'dark') return 'dark';
  } catch (_) {}
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light') return 'light';
  if (attr === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { studentSession } = useStudent();
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(getSiteTheme);
  const [canvasData, setCanvasData] = useState<unknown>(null);
  const [canvasLoading, setCanvasLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);
  const [updatingEditMode, setUpdatingEditMode] = useState(false);

  const [showMembers, setShowMembers] = useState(false);
  const [memberRoll, setMemberRoll] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState('');

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = board?.owner_roll === studentSession?.rollNumber;
  const isMember = board
    ? (isOwner || board.members.some(m => m.roll_number === studentSession?.rollNumber))
    : false;

  const shareUrl = `${window.location.origin}/moodboards/${board?.id}`;

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getSiteTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const loadBoard = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.boards.getBoard(id, studentSession?.rollNumber);
      setBoard(data);

      try {
        const canvasResult = await api.boards.loadCanvas(id, studentSession?.rollNumber);
        if (canvasResult.canvas_data) {
          setCanvasData(JSON.parse(canvasResult.canvas_data));
        }
      } catch {
        // No saved canvas — start fresh
      } finally {
        setCanvasLoading(false);
      }
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e?.status === 403) {
        setError('This board is private.');
      } else if (e?.status === 404) {
        setError('Board not found.');
      } else {
        setError('Failed to load board.');
      }
      setCanvasLoading(false);
    } finally {
      setLoading(false);
    }
  }, [id, studentSession?.rollNumber]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const handleSave = useCallback(async (snapshot: unknown) => {
    if (!id || !studentSession?.rollNumber) return;
    try {
      setSaveStatus('saving');
      await api.boards.saveCanvas(id, studentSession.rollNumber, JSON.stringify(snapshot));
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [id, studentSession?.rollNumber]);

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

  const handleVisibilityToggle = async () => {
    if (!board || !studentSession?.rollNumber) return;
    setUpdatingVisibility(true);
    const newVisibility = board.visibility === 'private' ? 'shared' : 'private';
    try {
      const updated = await api.boards.update(board.id, studentSession.rollNumber, { visibility: newVisibility });
      setBoard(prev => prev ? { ...prev, visibility: updated.visibility } : prev);
    } catch {
      console.error('Failed to update visibility');
    } finally {
      setUpdatingVisibility(false);
    }
  };

  const handleEditModeToggle = async () => {
    if (!board || !studentSession?.rollNumber) return;
    setUpdatingEditMode(true);
    const newMode = board.edit_mode === 'members_only' ? 'anyone' : 'members_only';
    try {
      const updated = await api.boards.update(board.id, studentSession.rollNumber, { edit_mode: newMode });
      setBoard(prev => prev ? { ...prev, edit_mode: updated.edit_mode } : prev);
    } catch {
      console.error('Failed to update edit mode');
    } finally {
      setUpdatingEditMode(false);
    }
  };

  const handleAddMember = async () => {
    if (!id || !studentSession?.rollNumber || !memberRoll.trim()) return;
    setAddingMember(true);
    setMemberError('');
    try {
      const res = await api.boards.addMember(id, studentSession.rollNumber, memberRoll.trim());
      setBoard(prev => prev ? {
        ...prev,
        members: [...prev.members, {
          roll_number: memberRoll.trim(),
          name: res.name,
          added_at: new Date().toISOString(),
        }],
      } : prev);
      setMemberRoll('');
    } catch {
      setMemberError('Student not found — must register first');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (roll: string) => {
    if (!id || !studentSession?.rollNumber) return;
    try {
      await api.boards.removeMember(id, studentSession.rollNumber, roll);
      setBoard(prev => prev ? {
        ...prev,
        members: prev.members.filter(m => m.roll_number !== roll),
      } : prev);
    } catch {
      console.error('Failed to remove member');
    }
  };

  const handleDeleteBoard = async () => {
    if (!id || !studentSession?.rollNumber) return;
    setDeleting(true);
    try {
      await api.boards.delete(id, studentSession.rollNumber);
      clearBoardsCache();
      navigate('/moodboards');
    } catch {
      setError('Failed to delete board');
      setDeleting(false);
    }
  };

  if (loading) return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-canvas)',
      fontFamily: 'var(--font-body)', fontSize: 14,
      color: 'var(--color-ink-muted)',
    }}>
      Loading board...
    </div>
  );

  if (error || !board) return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, background: 'var(--color-canvas)',
    }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--color-ink-muted)', margin: 0 }}>
        {error || 'Board not found.'}
      </p>
      <button
        onClick={() => navigate('/moodboards')}
        style={{
          padding: '10px 20px', background: 'var(--color-brand)', color: '#fff',
          border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13,
          fontFamily: 'var(--font-body)', cursor: 'pointer',
        }}
      >
        Back to Moodboards
      </button>
    </div>
  );

  const textColor  = theme === 'dark' ? '#ffffff' : '#000000';
  const textMuted  = theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  const surfaceBg  = theme === 'dark' ? '#1a1a1a' : '#ffffff';
  const borderColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  return (
    <>
      {/* Full-screen canvas */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column' }}>

        {/* Top bar */}
        <div style={{
          height: 48, background: surfaceBg,
          borderBottom: `1px solid ${borderColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', gap: 16, zIndex: 10, flexShrink: 0,
        }}>
          {/* Left — back */}
          <button
            onClick={() => {
              if (window.history.state?.idx > 0) navigate(-1);
              else navigate('/moodboards');
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', color: textMuted,
              fontSize: 13, fontFamily: 'var(--font-body)',
              cursor: 'pointer', padding: '4px 8px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
            }}
          >
            ← Boards
          </button>

          {/* Center — name + visibility badge + save status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <p style={{
              margin: 0, fontSize: 14, fontWeight: 600, color: textColor,
              fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {board.name}
            </p>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: 'var(--radius-pill)', flexShrink: 0, fontFamily: 'var(--font-body)',
              background: board.visibility === 'shared'
                ? 'rgba(233,30,140,0.15)'
                : theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              color: board.visibility === 'shared' ? 'var(--color-brand)' : textMuted,
            }}>
              {board.visibility}
            </span>
            {saveStatus !== 'idle' && (
              <span style={{
                fontSize: 11, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
                color: saveStatus === 'error'
                  ? 'var(--color-error)'
                  : saveStatus === 'saving' ? textMuted : 'var(--color-success)',
              }}>
                {saveStatus === 'saving' && 'Saving...'}
                {saveStatus === 'saved' && 'Saved'}
                {saveStatus === 'error' && 'Save failed'}
              </span>
            )}
          </div>

          {/* Right — avatars + actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Member avatars */}
            {(board.members.length > 0 || isOwner) && (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {[
                  { name: board.owner_name ?? board.owner_roll, roll: board.owner_roll },
                  ...board.members.slice(0, 3).map(m => ({ name: m.name ?? m.roll_number, roll: m.roll_number })),
                ].map((m, i) => (
                  <div
                    key={m.roll}
                    title={m.name}
                    style={{
                      width: 28, height: 28, borderRadius: 'var(--radius-full)',
                      background: `hsl(${parseInt(m.roll.slice(-3)) % 360}, 60%, 45%)`,
                      border: `2px solid ${surfaceBg}`,
                      marginLeft: i === 0 ? 0 : -8,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#fff',
                      fontFamily: 'var(--font-body)',
                      zIndex: 10 - i, position: 'relative',
                    }}
                  >
                    {(m.name ?? m.roll)[0].toUpperCase()}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowShare(true)}
              style={{
                padding: '5px 12px', background: 'var(--color-brand)',
                border: 'none', borderRadius: 'var(--radius-pill)',
                color: '#fff', fontSize: 12, fontWeight: 600,
                fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Share
            </button>

            {isOwner && (
              <button
                onClick={() => setShowMembers(true)}
                style={{
                  padding: '5px 12px', background: 'none',
                  border: `1px solid ${borderColor}`, borderRadius: 'var(--radius-pill)',
                  color: textMuted, fontSize: 12,
                  fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                + Invite
              </button>
            )}

            {isOwner && (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  padding: '5px 10px', background: 'none',
                  border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-pill)',
                  color: 'var(--color-error)', fontSize: 11,
                  fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Canvas area */}
        <div style={{ flex: 1, position: 'relative' }}>
          {canvasLoading ? (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: theme === 'dark' ? '#1a1a1a' : '#f8f8f8',
              color: textMuted, fontFamily: 'var(--font-body)', fontSize: 14,
              flexDirection: 'column', gap: 12,
            }}>
              <div style={{
                width: 20, height: 20,
                border: `2px solid ${textMuted}`,
                borderTopColor: 'transparent',
                borderRadius: 'var(--radius-full)',
                animation: 'spin 0.8s linear infinite',
              }} />
              Restoring canvas...
            </div>
          ) : (
            <Suspense fallback={
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: theme === 'dark' ? '#1a1a1a' : '#f8f8f8',
                color: textMuted, fontFamily: 'var(--font-body)', fontSize: 14,
              }}>
                Loading canvas...
              </div>
            }>
              <TldrawCanvas
                theme={theme}
                initialData={canvasData}
                onSave={handleSave}
                readOnly={!isMember && board.edit_mode === 'members_only'}
              />
            </Suspense>
          )}
        </div>
      </div>

      {/* Share modal */}
      <AnimatePresence>
        {showShare && board && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            }}
            onClick={() => setShowShare(false)}
          >
            <motion.div
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
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{
                  margin: 0, fontSize: 18, fontWeight: 700,
                  color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px',
                }}>
                  Share Board
                </h3>
                <button
                  onClick={() => setShowShare(false)}
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

              {isOwner && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{
                    margin: 0, fontSize: 11, fontWeight: 600,
                    color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                    textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                  }}>
                    Visibility
                  </p>
                  <div style={{
                    display: 'flex', border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius-md)', overflow: 'hidden',
                  }}>
                    {(['private', 'shared'] as const).map(opt => (
                      <button
                        key={opt}
                        onClick={() => { if (board.visibility !== opt) handleVisibilityToggle(); }}
                        disabled={updatingVisibility}
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
                      : 'Anyone with the link can view.'
                    }
                  </p>
                </div>
              )}

              {isOwner && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{
                    margin: 0, fontSize: 11, fontWeight: 600,
                    color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                    textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                  }}>
                    Who can edit?
                  </p>
                  <div style={{
                    display: 'flex', border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius-md)', overflow: 'hidden',
                  }}>
                    {([
                      { value: 'members_only', label: 'Invited only' },
                      { value: 'anyone', label: 'Anyone with link' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { if (board.edit_mode !== opt.value) handleEditModeToggle(); }}
                        disabled={updatingEditMode}
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
                </div>
              )}

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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collaborators modal */}
      <AnimatePresence>
        {showMembers && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            }}
            onClick={() => setShowMembers(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 400,
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-xl)', padding: '28px 24px',
                display: 'flex', flexDirection: 'column', gap: 20,
                maxHeight: '80vh', overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{
                  margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)',
                  fontFamily: 'var(--font-display)', letterSpacing: '-0.3px',
                }}>
                  Collaborators
                </h3>
                <button
                  onClick={() => setShowMembers(false)}
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Owner */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 0', borderBottom: '1px solid var(--color-hairline)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 'var(--radius-full)',
                      background: `hsl(${parseInt(board.owner_roll.slice(-3)) % 360}, 60%, 45%)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-body)',
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
                    padding: '12px 0', borderBottom: '1px solid var(--color-hairline)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 'var(--radius-full)',
                        background: `hsl(${parseInt(m.roll_number.slice(-3)) % 360}, 60%, 45%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-body)',
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)',
                    letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                  }}>
                    Invite by Roll Number
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input-base"
                      type="text"
                      placeholder="e.g. 250004"
                      value={memberRoll}
                      onChange={e => { setMemberRoll(e.target.value); setMemberError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddMember(); }}
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
                      {addingMember ? '...' : 'Invite'}
                    </button>
                  </div>
                  {memberError && (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>
                      {memberError}
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            }}
            onClick={() => setConfirmDelete(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 360,
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-xl)', padding: '28px 24px',
                display: 'flex', flexDirection: 'column', gap: 16,
              }}
            >
              <h3 style={{
                margin: 0, fontSize: 18, fontWeight: 700,
                color: 'var(--color-ink)', fontFamily: 'var(--font-display)',
              }}>
                Delete "{board.name}"?
              </h3>
              <p style={{
                margin: 0, fontSize: 13, color: 'var(--color-ink-muted)',
                fontFamily: 'var(--font-body)', lineHeight: 1.5,
              }}>
                This will permanently delete the board and all its contents. Cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleDeleteBoard}
                  disabled={deleting}
                  style={{
                    flex: 1, padding: '12px 20px',
                    background: 'var(--color-error)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-pill)',
                    fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)',
                    cursor: deleting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    flex: 1, padding: '12px 20px',
                    background: 'none', color: 'var(--color-ink-muted)',
                    border: '1px solid var(--color-hairline)',
                    borderRadius: 'var(--radius-pill)', fontSize: 13,
                    fontFamily: 'var(--font-body)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

import '@excalidraw/excalidraw/index.css';
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then(m => ({ default: m.Excalidraw }))
);
import { api, type BoardDetail } from '../lib/api';
import { clearBoardsCache } from './MoodboardsPage';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useStudent } from '../context/StudentContext';

// Theme key matches ThemeContext.tsx: localStorage key 'dna-theme',
// applied as data-theme attribute on <html>.
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

  const [showMembers, setShowMembers] = useState(false);
  const [memberRoll, setMemberRoll] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState('');

  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);
  const [updatingEditMode, setUpdatingEditMode] = useState(false);

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const [canvasLoading, setCanvasLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [initialData, setInitialData] = useState<any>(null);

  const isOwner = board?.owner_roll === studentSession?.rollNumber;
  const isMember = board
    ? (isOwner || board.members.some(m => m.roll_number === studentSession?.rollNumber))
    : false;

  // Watch for theme changes via data-theme attribute mutations
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

      // Load saved canvas state
      try {
        const canvasResult = await api.boards.loadCanvas(
          id, studentSession?.rollNumber
        );

        if (canvasResult.canvas_data) {
          const parsed = JSON.parse(canvasResult.canvas_data);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const restoredFiles: Record<string, any> = {};
          for (const [fileId, fileData] of Object.entries(parsed.files ?? {})) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const f = fileData as any;
            if (f.url) {
              try {
                const imgRes = await fetch(f.url as string);
                const blob = await imgRes.blob();
                const dataURL = await new Promise<string>(resolve => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.readAsDataURL(blob);
                });
                restoredFiles[fileId] = {
                  id: fileId,
                  dataURL,
                  mimeType: f.mimeType,
                  created: f.created ?? Date.now(),
                };
              } catch {
                console.warn(`Failed to restore file ${fileId}`);
              }
            }
          }

          setInitialData({
            elements: parsed.elements ?? [],
            appState: {
              ...(parsed.appState ?? {}),
              collaborators: new Map(),
            },
            files: restoredFiles,
          });
        }
      } catch {
        // Canvas load failed — start with empty canvas
        console.log('No saved canvas or failed to load');
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadCanvasFile = useCallback(async (fileId: string, file: any): Promise<string | null> => {
    if (!id || !studentSession?.rollNumber) return null;
    try {
      const response = await fetch(file.dataURL as string);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('file', blob, `${fileId}.png`);
      formData.append('fileId', fileId);

      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/boards/${id}/canvas-files`,
        {
          method: 'POST',
          headers: { 'X-Roll-Number': studentSession.rollNumber },
          body: formData,
        }
      );

      if (!res.ok) return null;
      const data = await res.json() as { url: string };
      return data.url;
    } catch {
      return null;
    }
  }, [id, studentSession?.rollNumber]);

  const saveCanvas = useCallback(async () => {
    if (!id || !studentSession?.rollNumber) return;
    if (!excalidrawApiRef.current) return;

    try {
      setSaveStatus('saving');

      const elements = excalidrawApiRef.current.getSceneElements();
      const appState = excalidrawApiRef.current.getAppState();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const files = excalidrawApiRef.current.getFiles() as Record<string, any>;

      const processedFiles: Record<string, { id: string; mimeType: string; url: string; created: number }> = {};

      for (const [fileId, file] of Object.entries(files)) {
        if (typeof file.dataURL === 'string' && file.dataURL.startsWith('http')) {
          processedFiles[fileId] = {
            id: fileId,
            mimeType: file.mimeType as string,
            url: file.dataURL,
            created: file.created as number,
          };
        } else if (file.dataURL) {
          const url = await uploadCanvasFile(fileId, file);
          if (url) {
            processedFiles[fileId] = {
              id: fileId,
              mimeType: file.mimeType as string,
              url,
              created: file.created as number,
            };
          }
        }
      }

      const canvasData = JSON.stringify({
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          zoom: appState.zoom,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          gridSize: appState.gridSize,
          theme: appState.theme,
        },
        files: processedFiles,
      });

      if (canvasData === lastSavedRef.current) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        return;
      }
      lastSavedRef.current = canvasData;

      await api.boards.saveCanvas(id, studentSession.rollNumber, canvasData);

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to save canvas:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [id, studentSession?.rollNumber, uploadCanvasFile]);

  const handleExcalidrawChange = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveCanvas();
    }, 3000);
  }, [saveCanvas]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
        }
        saveCanvas();
      }
    };

    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveCanvas();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [saveCanvas]);

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
      setMemberError('Student not found — they must register first');
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
      // silent fail
    }
  };

  const shareUrl = `${window.location.origin}/moodboards/${board?.id}`;

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

  if (loading) return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-canvas)',
      fontFamily: 'var(--font-body)', fontSize: 14,
      color: 'var(--color-ink-muted)',
    }}>
      Loading canvas...
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
        onClick={() => {
          if (window.history.state?.idx > 0) {
            navigate(-1);
          } else {
            navigate('/moodboards');
          }
        }}
        style={{ padding: '10px 20px', background: 'var(--color-brand)', color: '#fff', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
      >
        Back to Moodboards
      </button>
    </div>
  );

  const roomId = board.room_id ?? board.id;
  void roomId; // stored for future collab wiring

  const topBarBg    = theme === 'dark' ? '#1a1a1a' : '#ffffff';
  const topBarBdr   = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const textPrimary = theme === 'dark' ? '#ffffff' : '#000000';
  const textMuted   = theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  const avatarBdr   = theme === 'dark' ? '#1a1a1a' : '#ffffff';
  const inviteBdr   = theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
  const inviteColor = theme === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';

  return (
    <>
      {/* Full-screen canvas */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column' }}>

        {/* Slim 48px top bar */}
        <div style={{
          height: 48, background: topBarBg,
          borderBottom: `1px solid ${topBarBdr}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', gap: 16, zIndex: 10, flexShrink: 0,
        }}>
          {/* Left — back */}
          <button
            onClick={() => {
              if (window.history.state?.idx > 0) {
                navigate(-1);
              } else {
                navigate('/moodboards');
              }
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

          {/* Center — board name + badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <p style={{
              margin: 0, fontSize: 14, fontWeight: 600, color: textPrimary,
              fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {board.name}
            </p>
            {saveStatus !== 'idle' && (
              <span style={{
                fontSize: 11,
                fontFamily: 'var(--font-body)',
                color: saveStatus === 'error'
                  ? 'var(--color-error)'
                  : saveStatus === 'saving'
                    ? (theme === 'dark'
                      ? 'rgba(255,255,255,0.4)'
                      : 'rgba(0,0,0,0.4)')
                    : 'var(--color-success)',
                whiteSpace: 'nowrap',
              }}>
                {saveStatus === 'saving' && 'Saving...'}
                {saveStatus === 'saved' && 'Saved'}
                {saveStatus === 'error' && 'Save failed — try again'}
              </span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: 'var(--radius-pill)', flexShrink: 0, fontFamily: 'var(--font-body)',
              background: board.visibility === 'shared'
                ? 'rgba(233,30,140,0.15)'
                : theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              color: board.visibility === 'shared' ? 'var(--color-brand)'
                : theme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
            }}>
              {board.visibility}
            </span>
          </div>

          {/* Right — avatars + invite */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {board.members.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {[
                  { name: board.owner_name ?? board.owner_roll, roll: board.owner_roll },
                  ...board.members.slice(0, 3).map(m => ({ name: m.name ?? m.roll_number, roll: m.roll_number })),
                ].map((m, i) => (
                  <div
                    key={m.roll}
                    title={m.name}
                    style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: `hsl(${parseInt(m.roll.slice(-3)) % 360}, 60%, 45%)`,
                      border: `2px solid ${avatarBdr}`,
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
                {board.members.length > 3 && (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: theme === 'dark' ? '#333' : '#eee',
                    border: `2px solid ${avatarBdr}`, marginLeft: -8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: textPrimary, fontFamily: 'var(--font-body)',
                    position: 'relative', zIndex: 6,
                  }}>
                    +{board.members.length - 3}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => setShowShare(true)}
              style={{
                padding: '5px 12px',
                background: 'var(--color-brand)',
                border: 'none',
                borderRadius: 'var(--radius-pill)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Share
            </button>

            {isOwner && (
              <button
                onClick={() => setShowMembers(true)}
                style={{
                  padding: '5px 12px', background: 'none',
                  border: `1px solid ${inviteBdr}`, borderRadius: 'var(--radius-pill)',
                  color: inviteColor, fontSize: 12,
                  fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                + Invite
              </button>
            )}
          </div>
        </div>

        {/* Excalidraw canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          {canvasLoading ? (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: theme === 'dark' ? '#1a1a1a' : '#f8f8f8',
              color: theme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              gap: 10,
              flexDirection: 'column',
            }}>
              <div style={{
                width: 20, height: 20,
                border: '2px solid currentColor',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              Restoring canvas...
            </div>
          ) : (
            <Suspense fallback={
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: theme === 'dark' ? '#1a1a1a' : '#f8f8f8',
                color: theme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
              }}>
                Loading canvas...
              </div>
            }>
              <Excalidraw
                theme={theme}
                excalidrawAPI={(excalidrawApi) => {
                  excalidrawApiRef.current = excalidrawApi;
                }}
                initialData={initialData}
                onChange={handleExcalidrawChange}
                isCollaborating={isMember}
                detectScroll={false}
                handleKeyboardGlobally={true}
                autoFocus
                UIOptions={{
                  canvasActions: {
                    changeViewBackgroundColor: true,
                    clearCanvas: isOwner,
                    export: { saveFileToDisk: true },
                    loadScene: false,
                    saveToActiveFile: false,
                    toggleTheme: true,
                  },
                }}
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
              position: 'fixed', inset: 0,
              zIndex: 9999,
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
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
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                padding: '28px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{
                  margin: 0, fontSize: 18, fontWeight: 700,
                  color: 'var(--color-ink)',
                  fontFamily: 'var(--font-display)',
                  letterSpacing: '-0.3px',
                }}>
                  Share Board
                </h3>
                <button
                  onClick={() => setShowShare(false)}
                  style={{
                    width: 32, height: 32,
                    borderRadius: '50%',
                    border: '1px solid var(--color-border)',
                    background: 'none',
                    color: 'var(--color-ink-muted)',
                    fontSize: 18, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>

              {/* Visibility toggle */}
              {isOwner && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{
                    margin: 0, fontSize: 11, fontWeight: 600,
                    color: 'var(--color-ink-muted)',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    fontFamily: 'var(--font-body)',
                  }}>
                    Visibility
                  </p>
                  <div style={{
                    display: 'flex', gap: 0,
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', overflow: 'hidden',
                  }}>
                    {([
                      { value: 'private', label: 'Private' },
                      { value: 'shared', label: 'Shared' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { if (board.visibility !== opt.value) handleVisibilityToggle(); }}
                        disabled={updatingVisibility}
                        style={{
                          flex: 1, padding: '10px 0',
                          background: board.visibility === opt.value ? 'var(--color-brand)' : 'none',
                          border: 'none',
                          color: board.visibility === opt.value ? '#fff' : 'var(--color-ink-muted)',
                          fontSize: 13,
                          fontWeight: board.visibility === opt.value ? 600 : 400,
                          fontFamily: 'var(--font-body)',
                          cursor: updatingVisibility ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p style={{
                    margin: 0, fontSize: 11,
                    color: 'var(--color-ink-muted)',
                    fontFamily: 'var(--font-body)',
                    lineHeight: 1.5,
                  }}>
                    {board.visibility === 'private'
                      ? 'Only you and invited collaborators can access this board.'
                      : 'Anyone with the link can view this board.'
                    }
                  </p>
                </div>
              )}

              <div style={{ height: 1, background: 'var(--color-border)' }} />

              {/* Edit mode toggle */}
              {isOwner && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{
                    margin: 0, fontSize: 11, fontWeight: 600,
                    color: 'var(--color-ink-muted)',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    fontFamily: 'var(--font-body)',
                  }}>
                    Who can edit?
                  </p>
                  <div style={{
                    display: 'flex', gap: 0,
                    border: '1px solid var(--color-border)',
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
                          fontSize: 12,
                          fontWeight: board.edit_mode === opt.value ? 600 : 400,
                          fontFamily: 'var(--font-body)',
                          cursor: updatingEditMode ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p style={{
                    margin: 0, fontSize: 11,
                    color: 'var(--color-ink-muted)',
                    fontFamily: 'var(--font-body)',
                    lineHeight: 1.5,
                  }}>
                    {board.edit_mode === 'members_only'
                      ? 'Only invited collaborators can edit the canvas.'
                      : 'Anyone with the link can edit the canvas.'
                    }
                  </p>
                </div>
              )}

              <div style={{ height: 1, background: 'var(--color-border)' }} />

              {/* Copy link */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{
                  margin: 0, fontSize: 11, fontWeight: 600,
                  color: 'var(--color-ink-muted)',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  fontFamily: 'var(--font-body)',
                }}>
                  Board Link
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    flex: 1, padding: '10px 12px',
                    background: 'var(--color-canvas)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12,
                    color: 'var(--color-ink-muted)',
                    fontFamily: 'var(--font-mono, monospace)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {shareUrl}
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCopy}
                    style={{
                      padding: '10px 16px',
                      background: copied ? 'var(--color-success)' : 'var(--color-brand)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'var(--font-body)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'background 0.2s ease',
                      flexShrink: 0,
                    }}
                  >
                    {copied ? 'Copied!' : 'Copy Link'}
                  </motion.button>
                </div>
                {board.visibility === 'private' && (
                  <p style={{
                    margin: 0, fontSize: 11,
                    color: 'var(--color-brand)',
                    fontFamily: 'var(--font-body)',
                  }}>
                    Board is private — only invited members can open this link.
                    Set to Shared to let anyone view it.
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collaborators panel */}
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
                background: 'var(--color-surface-1)', border: '1px solid var(--color-border)',
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
                    width: 32, height: 32, borderRadius: '50%',
                    border: '1px solid var(--color-border)', background: 'none',
                    color: 'var(--color-ink-muted)', fontSize: 18, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>

              {/* Member list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Owner row */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 0', borderBottom: '1px solid var(--color-border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: `hsl(${parseInt(board.owner_roll.slice(-3)) % 360}, 60%, 45%)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, color: '#fff',
                      fontFamily: 'var(--font-body)', flexShrink: 0,
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
                    padding: '12px 0', borderBottom: '1px solid var(--color-border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: `hsl(${parseInt(m.roll_number.slice(-3)) % 360}, 60%, 45%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: '#fff',
                        fontFamily: 'var(--font-body)', flexShrink: 0,
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
                        style={{ fontSize: 12, color: 'var(--color-error)', background: 'none', border: 'none', fontFamily: 'var(--font-body)', cursor: 'pointer', padding: '4px 8px' }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add member (owner only) */}
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
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                    Student must have registered on the website first. They will see this board in their Moodboards list.
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

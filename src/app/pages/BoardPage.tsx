import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useStudent } from '../context/StudentContext';
import { api, type BoardDetail } from '../lib/api';
import { clearBoardsCache } from './MoodboardsPage';
import { rollToColor } from '../lib/utils';
import { PresenceProvider } from '../context/PresenceProvider';
import { useBoardComments } from '../components/hooks/useBoardComments';
import { ShareBoardDialog } from '../components/ShareBoardDialog';
import { AssetLibrary } from '../components/AssetLibrary';
import type { Editor } from 'tldraw';
import type { Asset } from '../lib/api';

const TldrawCanvas = lazy(() =>
  import('./TldrawCanvas').then(m => ({ default: m.TldrawCanvas }))
);
// Realtime rollout (Commit 3): parallel component, not a replacement — see
// TldrawCanvasSync.tsx's own architectural-decisions header comment.
// Lazy-loaded the same way TldrawCanvas already is, so a board that never
// uses realtime never pays for @tldraw/sync's bundle weight.
const TldrawCanvasSync = lazy(() =>
  import('./TldrawCanvasSync').then(m => ({ default: m.TldrawCanvasSync }))
);
// Version history (Commit 5) — lazy-loaded so its bundle weight (and the
// GET /versions request it triggers on mount) is paid only when a user
// actually opens the panel, per the "lazy-load version history, never
// download all snapshots on board open" requirement. Applies to every
// board (realtime-enabled or not) — see VersionHistoryPanel.tsx's own
// header comment on why this is orthogonal to which canvas component renders.
const VersionHistoryPanel = lazy(() =>
  import('../components/VersionHistoryPanel').then(m => ({ default: m.VersionHistoryPanel }))
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
  const [canvasReady, setCanvasReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [retryingSave, setRetryingSave] = useState(false);
  // Holds the most recent snapshot that failed to save, so Retry resends the
  // actual lost edit rather than just re-triggering the debounce (which by
  // then may be showing a different, newer in-memory state if the user kept
  // editing after the failure).
  const lastFailedSnapshotRef = useRef<unknown>(null);
  // A stale 'saved' -> 'idle' timer from an earlier successful save must not
  // silently hide a LATER save's failure banner (e.g. save A succeeds and
  // schedules its idle-reset, save B for a newer edit fails before that timer
  // fires, then A's timer resets status back to idle and drops B's Retry
  // action). Tracking + cancelling it on every new save start/failure closes
  // that race.
  const savedStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rollRef = useRef(studentSession?.rollNumber);
  useEffect(() => { rollRef.current = studentSession?.rollNumber; }, [studentSession?.rollNumber]);
  const canvasLoadedRef = useRef(false);

  // The global REALTIME_ENABLED kill switch's value — see api.ts's
  // realtime.getStatus() doc comment on why this needs its own fetch
  // (deliberately not exposed via /settings/public, so it can't be
  // toggled at runtime by a DB write, only by a backend redeploy). Starts
  // false (fail closed: an unknown/unfetched flag must never cause a
  // realtime-enabled board to attempt a connection it can't complete) and
  // is combined with board.realtime_enabled below to decide which canvas
  // component to render.
  const [realtimeGloballyEnabled, setRealtimeGloballyEnabled] = useState(false);
  useEffect(() => {
    api.realtime.getStatus()
      .then(res => setRealtimeGloballyEnabled(res.enabled))
      .catch(() => setRealtimeGloballyEnabled(false));
  }, []);

  const [showShare, setShowShare] = useState(false);
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  // Asset Manager (Phase B) board integration — see TldrawCanvas.tsx's
  // onEditorReady prop comment for why this ref has to leave the canvas
  // component at all: inserting a library asset onto the canvas needs the
  // real tldraw Editor instance, which only the mounted canvas component
  // holds. A ref (not state) because it never needs to trigger a re-render
  // — only handleInsertAsset below ever reads it, on click.
  const editorRef = useRef<Editor | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showVersionHistory, setShowVersionHistory] = useState(false);
  // Shown briefly after a restore on a board with connected collaborators —
  // see restoreVersion's hadLiveRoom in api.ts and rooms.ts's own comment on
  // why a restore causes one clean, deliberate reconnect cycle for everyone
  // currently connected (not a "storm" — this hint exists so that expected
  // reconnect doesn't read as an error to whoever's watching it happen).
  const [showReconnectHint, setShowReconnectHint] = useState(false);

  const isOwner = board?.owner_roll === studentSession?.rollNumber;
  const isMember = board
    ? (isOwner || board.members.some(m => m.roll_number === studentSession?.rollNumber))
    : false;

  // The one decision point for realtime vs. manual persistence — everything
  // else about which component to render flows from this single boolean.
  // All three must hold: the per-board opt-in (board.realtime_enabled,
  // defaults false, flipped per-board for the pilot rollout), the global
  // kill switch (realtimeGloballyEnabled, fetched above), and a non-null
  // room_id (should always be set — backfilled since the column was added —
  // but a defensive fallback to the manual path beats a crash if it's ever
  // missing). Any of these being false/missing/not-yet-loaded falls back to
  // the existing manual TldrawCanvas — this is the rollback path, not an
  // error state, so there is no loading gate on realtimeGloballyEnabled
  // itself: a board briefly renders via TldrawCanvas while that fetch is in
  // flight, which is always safe/correct behavior, never just a fallback
  // for a slow network.
  const useRealtimeSync = Boolean(board?.realtime_enabled) && realtimeGloballyEnabled && Boolean(board?.room_id);

  // Comments (Commit 6) — see components/hooks/useBoardComments.ts's own
  // header comment for why this is owned here (BoardPage) rather than
  // inside either canvas component: comment state must not depend on
  // which of TldrawCanvas/TldrawCanvasSync is currently mounted, and both
  // need the SAME instance passed down via the `comments` prop (see
  // pages/commentsProps.ts). `live` mirrors useRealtimeSync exactly —
  // comments still fully work via REST on a manual-save board, just
  // without the WS live-push layer (see the hook's own comment on this
  // tradeoff, same one the manual canvas path already accepts for
  // document content itself).
  const [commentMode, setCommentMode] = useState(false);
  // "Unread" is a purely local, this-session concept — no read-receipt
  // state is persisted server-side (out of scope: no notifications system
  // per the spec). Reset to "now" whenever comment mode opens, so a pin
  // is marked unread only if its thread got new activity since the LAST
  // time this student actually looked, not since some absolute epoch.
  const [lastSeenAt, setLastSeenAt] = useState(() => Date.now());
  const commentsApi = useBoardComments({
    boardId: board?.id ?? '',
    roll: studentSession?.rollNumber,
    live: useRealtimeSync,
    roomId: board?.room_id ?? null,
  });

  const canModerateComments = isMember;

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getSiteTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const keepAlive = setInterval(async () => {
      try {
        await fetch(
          `${import.meta.env.VITE_API_URL ?? ''}/api/health`,
          { method: 'GET' }
        );
      } catch {
        // silent fail — keepalive only
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(keepAlive);
  }, []);

  const loadBoard = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.boards.getBoard(id, rollRef.current);
      setBoard(data);

      if (!canvasLoadedRef.current) {
        try {
          const canvasResult = await api.boards.loadCanvas(id, rollRef.current);
          if (canvasResult.canvas_data) {
            setCanvasData(JSON.parse(canvasResult.canvas_data));
          }
        } catch {
          // No saved canvas — start fresh
        } finally {
          canvasLoadedRef.current = true;
          setCanvasReady(true);
          setCanvasLoading(false);
        }
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
  }, [id]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const handleSave = useCallback(async (snapshot: unknown) => {
    if (!id || !studentSession?.rollNumber) return;
    try {
      if (savedStatusTimerRef.current) clearTimeout(savedStatusTimerRef.current);
      setSaveStatus('saving');
      await api.boards.saveCanvas(id, studentSession.rollNumber, JSON.stringify(snapshot));
      lastFailedSnapshotRef.current = null;
      setSaveStatus('saved');
      savedStatusTimerRef.current = setTimeout(() => {
        // Only clear back to idle if nothing newer (e.g. a later failure)
        // has already changed the status — belt-and-braces on top of the
        // clearTimeout above.
        setSaveStatus(status => status === 'saved' ? 'idle' : status);
      }, 2000);
    } catch {
      // Deliberately does NOT auto-dismiss: a save failure means the user's
      // last edit isn't persisted, and a badge that disappears after a few
      // seconds is easy to miss entirely (this is the exact silent-data-loss
      // gap this fix closes). Stays visible with a Retry action until the
      // user retries successfully or explicitly dismisses it.
      if (savedStatusTimerRef.current) clearTimeout(savedStatusTimerRef.current);
      lastFailedSnapshotRef.current = snapshot;
      setSaveStatus('error');
    }
  }, [id, studentSession?.rollNumber]);

  const handleRetrySave = useCallback(async () => {
    if (!lastFailedSnapshotRef.current) return;
    setRetryingSave(true);
    try {
      await handleSave(lastFailedSnapshotRef.current);
    } finally {
      setRetryingSave(false);
    }
  }, [handleSave]);

  const handleDismissSaveError = useCallback(() => {
    lastFailedSnapshotRef.current = null;
    setSaveStatus('idle');
  }, []);

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

  // Asset Manager (Phase B) — places the chosen library asset onto the
  // canvas at the viewport center via the SAME tldraw asset APIs the
  // existing gallery-injection path already uses (see
  // tldrawCanvasShared.ts's insertImageAsset for why this is a one-off
  // single-item placement, not a reuse of the batch grid-placement
  // function that exists for a different, pre-existing feature). Silently
  // no-ops if the editor isn't mounted yet — the Assets button is only
  // reachable once the canvas has rendered, so this should never actually
  // happen, but a mid-navigation race is cheap to guard against.
  const handleInsertAsset = async (asset: Asset) => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      // Dynamically imported — tldrawCanvasShared.ts pulls in the (heavy)
      // tldraw package at module scope, and BoardPage.tsx itself is NOT
      // lazy-loaded (unlike TldrawCanvas/TldrawCanvasSync, both already
      // lazy() below), so a static import here would leak tldraw's bundle
      // weight into every page load, not just boards that actually insert
      // an asset.
      const { insertImageAsset } = await import('./tldrawCanvasShared');
      await insertImageAsset(editor, asset.url, asset.filename, asset.width, asset.height);
      setShowAssetLibrary(false);
      toast.success('Asset added to board');
    } catch {
      toast.error('Failed to add asset to board');
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
      <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>

        {/* Top bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: 48, background: surfaceBg,
          borderBottom: `1px solid ${borderColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', gap: 16, zIndex: 10,
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
            {saveStatus === 'saving' && (
              <span style={{ fontSize: 11, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', color: textMuted }}>
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span style={{ fontSize: 11, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', color: 'var(--color-success)' }}>
                Saved
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
                      background: rollToColor(m.roll),
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
              onClick={() => {
                setCommentMode(on => {
                  const next = !on;
                  // Opening comment mode is treated as "caught up" —
                  // clears the unread badge/dot state for pins, since the
                  // student is about to actually look at the board's
                  // comments. See lastSeenAt's own declaration comment.
                  if (next) setLastSeenAt(Date.now());
                  return next;
                });
              }}
              title={commentMode ? 'Exit comment mode' : 'Comment mode — click the canvas to leave a comment'}
              aria-pressed={commentMode}
              style={{
                position: 'relative',
                padding: '5px 12px',
                background: commentMode ? 'var(--color-brand)' : 'none',
                border: commentMode ? 'none' : `1px solid ${borderColor}`,
                borderRadius: 'var(--radius-pill)',
                color: commentMode ? '#fff' : textMuted, fontSize: 12,
                fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Comment
              {!commentMode && commentsApi.comments.some(
                c => !c.parentCommentId && !c.resolvedAt && c.authorRoll !== studentSession?.rollNumber
                  && new Date(c.updatedAt).getTime() > lastSeenAt
              ) && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', top: -2, right: -2,
                    width: 8, height: 8, borderRadius: '50%',
                    background: 'var(--color-brand)', border: `2px solid ${surfaceBg}`,
                  }}
                />
              )}
            </button>

            <button
              onClick={() => setShowAssetLibrary(true)}
              title="Asset Library"
              style={{
                padding: '5px 12px', background: 'none',
                border: `1px solid ${borderColor}`, borderRadius: 'var(--radius-pill)',
                color: textMuted, fontSize: 12,
                fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Assets
            </button>

            <button
              onClick={() => setShowVersionHistory(true)}
              title="Version History"
              style={{
                padding: '5px 12px', background: 'none',
                border: `1px solid ${borderColor}`, borderRadius: 'var(--radius-pill)',
                color: textMuted, fontSize: 12,
                fontFamily: 'var(--font-body)', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              History
            </button>

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

        {/* Save-failure banner — deliberately NOT part of the transient
            save-status pill above: it persists until the user retries
            successfully or dismisses it, since a failed save means real
            edits aren't persisted and a badge that vanishes in a few
            seconds is exactly how that goes unnoticed. Anchored just below
            the top bar (which is 48px tall), same as the canvas area. */}
        {saveStatus === 'error' && (
          <div style={{
            position: 'absolute', top: 48, left: 0, right: 0,
            padding: '8px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            background: 'var(--color-error)', color: '#fff',
            fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 500,
            zIndex: 20,
          }}>
            <span>Save failed — your last change to this board hasn&apos;t been saved.</span>
            <button
              onClick={handleRetrySave}
              disabled={retryingSave}
              style={{
                padding: '3px 10px', background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.4)', borderRadius: 'var(--radius-pill)',
                color: '#fff', fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 600,
                cursor: retryingSave ? 'default' : 'pointer', opacity: retryingSave ? 0.7 : 1,
              }}
            >
              {retryingSave ? 'Retrying...' : 'Retry'}
            </button>
            <button
              onClick={handleDismissSaveError}
              style={{
                padding: '3px 8px', background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.85)', fontSize: 11, fontFamily: 'var(--font-body)',
                cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Canvas area */}
        <div style={{ position: 'absolute', top: 48, left: 0, right: 0, bottom: 0 }}>
          {useRealtimeSync ? (
            !studentSession?.rollNumber ? (
              // The realtime WS layer always requires a valid student JWT
              // (checkRoomAccess returns session_expired for an anonymous
              // request — see roomAccess.ts) — an anonymous visitor could
              // never actually connect, so this is shown instead of letting
              // TldrawCanvasSync attempt a pre-check doomed to fail with a
              // confusing "session expired" message for someone who was
              // never signed in to begin with.
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: theme === 'dark' ? '#1a1a1a' : '#f8f8f8',
                color: textMuted, fontFamily: 'var(--font-body)', fontSize: 14,
              }}>
                Sign in to view this board's live session.
              </div>
            ) : (
              // Realtime path: no canvasReady gate — TldrawCanvasSync has no
              // dependency on the manual loadCanvas() REST fetch above (it
              // loads its document state over the WebSocket connection
              // itself, seeded server-side from the same canvas_data column —
              // see backend/src/realtime/roomPersistence.ts) and shows its
              // own internal Loading/Connecting UI, so gating it behind an
              // irrelevant REST call would only add latency for no benefit.
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
                {/* PresenceProvider scoped here (not global in Root.tsx) —
                    presence identity is only meaningful on a realtime board;
                    every other page has no use for it. See
                    PresenceProvider.tsx for what it derives and why. */}
                <PresenceProvider>
                  <TldrawCanvasSync
                    boardId={id!}
                    roomId={board.room_id!}
                    roll={studentSession.rollNumber}
                    theme={theme}
                    pendingItems={board.items}
                    onEditorReady={editor => { editorRef.current = editor; }}
                    comments={{
                      commentsApi,
                      commentMode,
                      onExitCommentMode: () => setCommentMode(false),
                      currentRoll: studentSession.rollNumber,
                      canModerate: canModerateComments,
                      lastSeenAt,
                    }}
                  />
                </PresenceProvider>
              </Suspense>
            )
          ) : !canvasReady ? (
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
                boardId={id!}
                theme={theme}
                initialData={canvasData}
                pendingItems={board.items}
                onSave={handleSave}
                readOnly={!isMember && board.edit_mode === 'members_only'}
                onEditorReady={editor => { editorRef.current = editor; }}
                comments={studentSession?.rollNumber ? {
                  commentsApi,
                  commentMode,
                  onExitCommentMode: () => setCommentMode(false),
                  currentRoll: studentSession.rollNumber,
                  canModerate: canModerateComments,
                  lastSeenAt,
                } : undefined}
              />
            </Suspense>
          )}
        </div>
      </div>

      {showShare && board && studentSession?.rollNumber && (
        <ShareBoardDialog
          boardId={board.id}
          roll={studentSession.rollNumber}
          onClose={() => setShowShare(false)}
          onUpdated={(_boardId, patch) => {
            setBoard(prev => prev ? { ...prev, ...patch } : prev);
            // member_count changing means the members array itself changed
            // (add/remove) — reload so isMember/the collaborator avatar
            // strip stay in sync with what the dialog just did, since it
            // maintains its own separate BoardDetail rather than sharing
            // this page's.
            if (patch.member_count !== undefined) loadBoard();
          }}
        />
      )}

      {showAssetLibrary && board && studentSession?.rollNumber && (
        <AssetLibrary
          workspaceId={board.workspace_id}
          workspaceName="Board's Workspace"
          roll={studentSession.rollNumber}
          onClose={() => setShowAssetLibrary(false)}
          onSelect={handleInsertAsset}
        />
      )}

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

      {/* Version History panel — lazy-loaded, and its own data fetch only
          starts once mounted (i.e. once opened), per VersionHistoryPanel.tsx's
          own comment on the performance requirement this satisfies. */}
      <AnimatePresence>
        {showVersionHistory && studentSession?.rollNumber && (
          <Suspense fallback={null}>
            <VersionHistoryPanel
              boardId={board.id}
              actorRoll={studentSession.rollNumber}
              isOwnerOrMember={isMember}
              onClose={() => setShowVersionHistory(false)}
              onRestored={(hadLiveRoom) => {
                if (hadLiveRoom) {
                  setShowReconnectHint(true);
                  setTimeout(() => setShowReconnectHint(false), 5000);
                }
              }}
            />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Reconnect hint — see showReconnectHint's own declaration comment
          for why this exists: a restore on a board with connected
          collaborators causes one clean, deliberate reconnect cycle for
          everyone (verified against @tldraw/sync-core's actual behavior in
          rooms.ts), which without this would look identical to an
          unexplained disconnect. Purely informational — TldrawCanvasSync's
          own connection banner (already built in Commit 3) is what actually
          reports the live reconnect status; this is just context for why
          it's about to happen. */}
      <AnimatePresence>
        {showReconnectHint && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            style={{
              position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
              zIndex: 9998, padding: '8px 16px', borderRadius: 'var(--radius-pill)',
              background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)',
              color: 'var(--color-ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            }}
          >
            Board restored — collaborators will briefly reconnect.
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

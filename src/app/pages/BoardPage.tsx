import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, Home, MessageCircle, MoreHorizontal, Image as ImageIcon, History, LayoutTemplate, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useStudent } from '../context/StudentContext';
import { api, type BoardDetail, type Workspace, type LibraryVisibility } from '../lib/api';
import { useModalA11y } from '../components/hooks/useModalA11y';
import { VisibilityPicker } from '../components/library/LibraryVisibility';
import { clearBoardsCache } from './MoodboardsPage';
import { rollToColor } from '../lib/utils';
import { PresenceProvider } from '../context/PresenceProvider';
import { useBoardComments } from '../components/hooks/useBoardComments';
import { ShareBoardDialog } from '../components/ShareBoardDialog';
import { AssetLibrary } from '../components/AssetLibrary';
import { PortalContainerProvider } from '../components/PortalContainer';
import { useScreenSize } from '../components/hooks/use-screen-size';
import { boardCrumbs, isCompactBoardHeader, MOODBOARDS_HREF } from '../lib/boardNav';
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

// Board header link styles (see the compact header in BoardPage's render).
const headerIconLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  width: 32, height: 32, borderRadius: 'var(--radius-pill)', textDecoration: 'none',
};
const crumbLink: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1,
  padding: '4px 8px', borderRadius: 'var(--radius-sm)', textDecoration: 'none',
  fontSize: 13, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
};

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

  // Fullscreen (V2.4 Phase 8/9 — Professional Canvas UX polish). The
  // standard browser Fullscreen API, not a tldraw concept at all — tldraw
  // has no "fullscreen" notion of its own (confirmed: no such action in
  // its actions registry), so this is genuinely new, non-duplicate value,
  // unlike zoom controls (tldraw's own ZoomMenu already has zoom-in/out/
  // 100%/fit-to-content/fit-to-selection — verified by reading its source
  // before building anything here, so nothing new was added for that).
  // Targets the SAME full-screen canvas container this page already
  // renders (see the outer <div style={{ position: 'fixed', inset: 0 }}>
  // below) — requesting fullscreen on that element, not document.body,
  // keeps this page's own top bar inside the fullscreen view rather than
  // hiding it. Reflects the browser's actual fullscreen state (not just
  // "did the user click the button") via the fullscreenchange event, so
  // pressing the browser/OS Escape-to-exit-fullscreen gesture keeps the
  // button's label/icon correct without this component doing anything
  // special for that gesture itself.
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  // Same element as canvasContainerRef, as state: portalled overlays (the
  // header's overflow menu, the asset library's dialogs/menus) mount into
  // it via PortalContainerProvider so they stay visible in fullscreen,
  // where only this element's subtree is rendered.
  const [portalContainerEl, setPortalContainerEl] = useState<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === canvasContainerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      canvasContainerRef.current?.requestFullscreen?.().catch(() => {
        // Fullscreen can be denied (no user gesture, iframe without the
        // allow="fullscreen" attribute, browser policy) — fails silently,
        // same as every other best-effort browser-API call in this file
        // (e.g. handleSave's own network-failure handling). The button
        // simply stays in its non-fullscreen state.
      });
    }
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
  // Save as Template (V2.3 Phase 8) — uses the board's CURRENT PERSISTED
  // canvas_data (read server-side from the DB row by POST /api/templates,
  // never anything sent from this client) as the template's snapshot, the
  // same guarantee POST /:id/duplicate's own canvas_data copy already
  // relies on. No second canvas-save path is introduced here — this
  // button only calls the templates API; it never reads editor.store
  // directly or serializes anything client-side.
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  // visibility (Shared Creative Library): Personal by default — publishing
  // to the workspace's Community is always an explicit choice.
  const [templateForm, setTemplateForm] = useState<{ name: string; description: string; visibility: LibraryVisibility }>({ name: '', description: '', visibility: 'personal' });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const saveTemplateDialogRef = useModalA11y(showSaveAsTemplate, () => setShowSaveAsTemplate(false), {
    initialFocus: () => document.getElementById('save-template-template-name'),
  });
  // Shown briefly after a restore on a board with connected collaborators —
  // see restoreVersion's hadLiveRoom in api.ts and rooms.ts's own comment on
  // why a restore causes one clean, deliberate reconnect cycle for everyone
  // currently connected (not a "storm" — this hint exists so that expected
  // reconnect doesn't read as an error to whoever's watching it happen).
  const [showReconnectHint, setShowReconnectHint] = useState(false);

  const isOwner = board?.owner_roll === studentSession?.rollNumber;

  // Board header (compact below lg and in fullscreen — see lib/boardNav.ts).
  const screenSize = useScreenSize();
  const compactHeader = isCompactBoardHeader(screenSize.greaterThanOrEqual('lg'), isFullscreen);
  // "← Moodboards" shows its text label from md up; below md it's an
  // arrow-only pill (same destination, labelled for assistive tech) so the
  // board name keeps room at phone widths.
  const showBackLabel = screenSize.greaterThanOrEqual('md');
  // The viewer's own workspaces — only used to NAME the board's workspace
  // in the breadcrumb. Best-effort: on failure the crumb reads
  // "Workspace" and still links to /home.
  const [viewerWorkspaces, setViewerWorkspaces] = useState<Workspace[]>([]);
  useEffect(() => {
    const roll = studentSession?.rollNumber;
    if (!roll) return;
    let cancelled = false;
    api.workspaces.list(roll)
      .then(list => { if (!cancelled) setViewerWorkspaces(list); })
      .catch(() => { /* breadcrumb falls back to "Workspace" */ });
    return () => { cancelled = true; };
  }, [studentSession?.rollNumber]);
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
  // PERSISTENT UNREAD WATERMARK (V2.6 Phase E).
  //
  // This used to be useState(() => Date.now()) — purely in-memory, so it
  // reset on every mount: refreshing the page silently marked every thread
  // read, and the state was per-tab rather than per-user. It is now backed
  // by board_comment_reads (one row per board+user, not per comment) and
  // read back on mount.
  //
  // 0 while loading means "nothing is read yet", so pins briefly show as
  // unread rather than briefly showing as read — failing toward showing
  // activity is the safer default for an unread indicator.
  const [lastSeenAt, setLastSeenAt] = useState(0);

  // Load this user's watermark for this board. A 403 (revoked) or any
  // error leaves it at 0; the comment list itself is separately authorized,
  // so a revoked user sees no comments to mark unread in the first place.
  useEffect(() => {
    const boardId = board?.id;
    const roll = studentSession?.rollNumber;
    if (!boardId || !roll) return;
    let cancelled = false;
    api.boards.getCommentReadState(boardId, roll)
      .then(res => {
        if (cancelled) return;
        setLastSeenAt(res.lastSeenAt ? new Date(res.lastSeenAt).getTime() : 0);
      })
      .catch(() => { /* leave at 0 — see above */ });
    return () => { cancelled = true; };
  }, [board?.id, studentSession?.rollNumber]);

  // Opening comment mode is "I am looking at these now": persist the
  // watermark server-side and move the local one immediately, so the UI
  // updates without waiting for the round-trip. The server stamps the
  // authoritative time and only ever moves a watermark FORWARD.
  // Mention candidates: the board's OWN owner + members. Using the list
  // the page already loaded means the picker can never surface users from
  // another workspace, and no user-search endpoint (an enumeration
  // surface) has to exist. The server re-validates every mention anyway.
  const mentionables = useMemo(() => {
    if (!board) return [];
    const out = [{ roll: board.owner_roll, name: board.owner_name ?? board.owner_roll }];
    for (const m of board.members) {
      if (m.roll_number === board.owner_roll) continue;
      out.push({ roll: m.roll_number, name: m.name ?? m.roll_number });
    }
    return out;
  }, [board]);

  const markCommentsSeen = useCallback(() => {
    const boardId = board?.id;
    const roll = studentSession?.rollNumber;
    setLastSeenAt(Date.now());
    if (!boardId || !roll) return;
    api.boards.markCommentsSeen(boardId, roll)
      .then(res => setLastSeenAt(new Date(res.lastSeenAt).getTime()))
      .catch(() => { /* local watermark already moved; retried on next open */ });
  }, [board?.id, studentSession?.rollNumber]);
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

  const openSaveAsTemplate = () => {
    if (!board) return;
    setTemplateForm({ name: board.name, description: '', visibility: 'personal' });
    setTemplateError('');
    setShowSaveAsTemplate(true);
  };

  // POST /api/templates only ever needs source_board_id — it reads
  // canvas_data itself, server-side, from the board's own DB row (see
  // routes/templates.ts's own comment on why this is what guarantees the
  // persisted server snapshot is used, never a stale client-only one,
  // for a realtime-enabled board). This handler never touches the
  // editor/canvas at all.
  const handleSaveAsTemplate = async () => {
    if (!id || !studentSession?.rollNumber || !templateForm.name.trim()) return;
    setSavingTemplate(true);
    setTemplateError('');
    try {
      await api.templates.create(studentSession.rollNumber, {
        name: templateForm.name.trim(),
        description: templateForm.description.trim() || undefined,
        visibility: templateForm.visibility,
        source_board_id: id,
      });
      setShowSaveAsTemplate(false);
      toast.success(templateForm.visibility === 'community' ? 'Template saved and published to Community' : 'Template saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setTemplateError(
        message.includes('no saved canvas content')
          ? 'This board has no saved canvas content yet — make an edit first, then try again.'
          : 'Failed to save template'
      );
    } finally {
      setSavingTemplate(false);
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
    // Only library images are canvas-insertable (files are downloads,
    // links have no stored object/url); the picker only offers images.
    if (asset.kind !== 'image' || !asset.url) return;
    try {
      // Dynamically imported — tldrawCanvasShared.ts pulls in the (heavy)
      // tldraw package at module scope, and BoardPage.tsx itself is NOT
      // lazy-loaded (unlike TldrawCanvas/TldrawCanvasSync, both already
      // lazy() below), so a static import here would leak tldraw's bundle
      // weight into every page load, not just boards that actually insert
      // an asset.
      const { insertImageAsset } = await import('./tldrawCanvasShared');
      // V2.4 Phase 6 — asset.id is the source-of-truth Asset Manager
      // record; passed through so the created tldraw asset's meta field
      // can carry sourceAssetId (see insertImageAsset's own comment).
      await insertImageAsset(editor, asset.url, asset.filename, asset.width, asset.height, asset.id);
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
      <p className="type-body" style={{ color: 'var(--color-ink-muted)', margin: 0 }}>
        {error || 'Board not found.'}
      </p>
      <button
        onClick={() => navigate('/moodboards')}
        className="btn-primary"
      >
        Back to Moodboards
      </button>
    </div>
  );

  const textColor  = theme === 'dark' ? '#ffffff' : '#000000';
  const textMuted  = theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  const surfaceBg  = theme === 'dark' ? '#1a1a1a' : '#ffffff';
  const borderColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const crumbs = boardCrumbs(board.name, board.workspace_id, viewerWorkspaces);
  const boardWorkspace = viewerWorkspaces.find(w => w.id === board.workspace_id) ?? null;

  return (
    <>
      {/* Full-screen canvas */}
      {/* Every overlay below — board dialogs included — renders INSIDE
          this container (it closes at the very end of the component), and
          portalled overlays target it too: while it's in browser
          fullscreen, nothing outside its subtree is displayed. */}
      <PortalContainerProvider value={portalContainerEl}>
      <div
        ref={el => { canvasContainerRef.current = el; setPortalContainerEl(el); }}
        style={{ position: 'fixed', inset: 0, zIndex: 300, background: theme === 'dark' ? '#1a1a1a' : '#ffffff' }}
      >

        {/* Top bar — compact board header. Deterministic upward navigation
            (workspace home → Moodboards → this board) via real links, never
            browser history; see lib/boardNav.ts. Below 1024px and in
            fullscreen (compactHeader) the breadcrumb collapses to back/home
            icons and the secondary actions move into the "⋯" menu, so
            nothing is ever pushed off-screen. Height stays 48px — the
            canvas area below is laid out against it. */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: 48, background: surfaceBg,
          borderBottom: `1px solid ${borderColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: compactHeader ? '0 8px 0 4px' : '0 12px 0 8px', gap: compactHeader ? 8 : 16, zIndex: 10,
        }}>
          {/* Left — breadcrumb + board identity */}
          <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: '1 1 auto' }}>
            {/* Primary exit: always /moodboards (a fixed destination, never
                browser history), whether the board was opened from Home, a
                project, a template, a shared link or a refresh. The only
                back control in the header, in every mode incl. fullscreen. */}
            <Link
              to={MOODBOARDS_HREF}
              className="board-back-link"
              aria-label="Back to Moodboards"
              title="Back to Moodboards"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0,
                height: 30, minWidth: 30, padding: showBackLabel ? '0 12px 0 9px' : 0, marginRight: 6,
                border: `1px solid ${borderColor}`, borderRadius: 'var(--radius-pill)',
                color: textColor, textDecoration: 'none', whiteSpace: 'nowrap',
                fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-body)',
              }}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              {showBackLabel && 'Moodboards'}
            </Link>
            {compactHeader ? (
              <Link to={crumbs[0].href!} aria-label={`Workspace home — ${crumbs[0].label}`} title={`Workspace home — ${crumbs[0].label}`} style={{ ...headerIconLink, color: textMuted }}>
                <Home size={15} />
              </Link>
            ) : (
              <>
                <Link to={crumbs[0].href!} title="Workspace home" style={{ ...crumbLink, color: textMuted }}>
                  <Home size={14} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{crumbs[0].label}</span>
                </Link>
                <span aria-hidden="true" style={{ color: textMuted, opacity: 0.6, fontSize: 13, padding: '0 2px' }}>/</span>
              </>
            )}
            <p
              aria-current="page"
              title={board.name}
              style={{
                margin: '0 0 0 4px', minWidth: 0, fontSize: 14, fontWeight: 600, color: textColor,
                fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {board.name}
            </p>
            {!compactHeader && (
              <span style={{
                marginLeft: 6,
                fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '2px 8px', borderRadius: 'var(--radius-pill)', flexShrink: 0, fontFamily: 'var(--font-body)',
                background: board.visibility === 'shared'
                  ? 'rgba(233,30,140,0.15)'
                  : theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                color: board.visibility === 'shared' ? 'var(--color-brand-text)' : textMuted,
              }}>
                {board.visibility}
              </span>
            )}
            {saveStatus === 'saving' && (
              <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', color: textMuted, flexShrink: 0 }}>
                {compactHeader ? '…' : 'Saving...'}
              </span>
            )}
            {saveStatus === 'saved' && (
              <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', color: 'var(--color-success)', flexShrink: 0 }}>
                {compactHeader ? '✓' : 'Saved'}
              </span>
            )}
          </nav>

          {/* Right — people + actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: compactHeader ? 6 : 8, flexShrink: 0 }}>
            {/* Board MEMBERS (who has access) — deliberately distinct from
                the live collaborator list rendered on the canvas itself,
                which shows who is connected RIGHT NOW (see
                CollaboratorList.tsx). These are static, come from REST, and
                do not change as people join or leave, so the group is
                labelled explicitly rather than leaving two visually
                identical avatar rows for the user to tell apart. */}
            {(board.members.length > 0 || isOwner) && (
              <div
                role="group"
                aria-label="People with access to this board"
                style={{ display: 'flex', alignItems: 'center' }}
              >
                {[
                  { name: board.owner_name ?? board.owner_roll, roll: board.owner_roll },
                  ...board.members.slice(0, compactHeader ? 1 : 3).map(m => ({ name: m.name ?? m.roll_number, roll: m.roll_number })),
                ].map((m, i) => (
                  <div
                    key={m.roll}
                    title={`${m.name} — has access`}
                    aria-label={`${m.name} — has access`}
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

            {typeof document.exitFullscreen === 'function' && (
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                aria-pressed={isFullscreen}
                className={`${isFullscreen ? 'btn-translucent' : 'btn-translucent btn-icon'} btn-sm touch-target`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                  {isFullscreen ? (
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                  ) : (
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  )}
                </svg>
                {/* Fullscreen hides everything but this header — keep the way
                    out labelled, not just an icon. */}
                {isFullscreen && 'Exit'}
              </button>
            )}

            <button
              onClick={() => {
                setCommentMode(on => {
                  const next = !on;
                  // Opening comment mode is treated as "caught up" —
                  // clears the unread badge/dot state for pins, since the
                  // student is about to actually look at the board's
                  // comments, and persists that server-side so it survives
                  // a refresh. See lastSeenAt's own declaration comment.
                  if (next) markCommentsSeen();
                  return next;
                });
              }}
              title={commentMode ? 'Exit comment mode' : 'Comment mode — click the canvas to leave a comment'}
              aria-label={compactHeader ? (commentMode ? 'Exit comment mode' : 'Comment') : undefined}
              aria-pressed={commentMode}
              className={`btn-translucent ${compactHeader ? 'btn-icon ' : ''}btn-sm touch-target`}
            >
              {compactHeader ? <MessageCircle size={14} /> : 'Comment'}
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

            {!compactHeader && (
              <>
                <button
                  onClick={() => setShowAssetLibrary(true)}
                  title="Asset Library"
                  className="btn-translucent btn-sm touch-target"
                >
                  Assets
                </button>

                <button
                  onClick={() => setShowVersionHistory(true)}
                  title="Version History"
                  className="btn-translucent btn-sm touch-target"
                >
                  History
                </button>

                {isOwner && (
                  <button
                    onClick={openSaveAsTemplate}
                    title="Save as Template"
                    className="btn-translucent btn-sm touch-target"
                  >
                    Save as Template
                  </button>
                )}
              </>
            )}

            <button
              onClick={() => setShowShare(true)}
              className="btn-primary btn-sm touch-target"
            >
              Share
            </button>

            {!compactHeader && isOwner && (
              <button
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete board"
                title="Delete board"
                className="btn-translucent btn-icon btn-sm is-danger touch-target"
                style={{ marginLeft: 8 }}
              >
                <Trash2 size={14} />
              </button>
            )}

            {compactHeader && (
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger
                  aria-label="More board actions"
                  title="More"
                  className="btn-translucent btn-icon btn-sm touch-target"
                >
                  <MoreHorizontal size={15} />
                </DropdownMenu.Trigger>
                {/* Portalled into the canvas container (not body) so it's
                    still visible while that container is fullscreen. */}
                <DropdownMenu.Portal container={portalContainerEl ?? undefined}>
                  <DropdownMenu.Content className="dna-menu" align="end" sideOffset={8} collisionPadding={8}>
                    <DropdownMenu.Item className="dna-menu-item" onSelect={() => setShowAssetLibrary(true)}>
                      <ImageIcon size={15} /> Assets
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="dna-menu-item" onSelect={() => setShowVersionHistory(true)}>
                      <History size={15} /> Version history
                    </DropdownMenu.Item>
                    {isOwner && (
                      <DropdownMenu.Item className="dna-menu-item" onSelect={openSaveAsTemplate}>
                        <LayoutTemplate size={15} /> Save as Template
                      </DropdownMenu.Item>
                    )}
                    {isOwner && (
                      <>
                        <DropdownMenu.Separator className="dna-menu-sep" />
                        <DropdownMenu.Item className="dna-menu-item" data-danger="true" onSelect={() => setConfirmDelete(true)}>
                          <Trash2 size={15} /> Delete board
                        </DropdownMenu.Item>
                      </>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
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
            background: 'var(--color-error-fill)', color: '#fff',
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
                      mentionables,
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
                  mentionables,
                } : undefined}
              />
            </Suspense>
          )}
        </div>
      {/* (canvas container continues — board overlays below render inside it; closed at the end) */}

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
          workspaceName={crumbs[0].label}
          isPersonalWorkspace={!!boardWorkspace?.is_personal}
          roll={studentSession.rollNumber}
          onClose={() => setShowAssetLibrary(false)}
          onSelect={handleInsertAsset}
        />
      )}

      {/* Save as Template (V2.3 Phase 8) */}
      <AnimatePresence>
        {showSaveAsTemplate && board && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            }}
            onClick={() => setShowSaveAsTemplate(false)}
          >
            <motion.div
              ref={saveTemplateDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Save as Template"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 400, maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-xl)', padding: 'var(--space-xl) var(--space-lg)', boxShadow: 'var(--shadow-level-2)',
                display: 'flex', flexDirection: 'column', gap: 16, outline: 'none',
              }}
            >
              <h3 className="type-headline" style={{ margin: 0 }}>
                Save as Template
              </h3>
              <div>
                <label htmlFor="save-template-template-name" className="type-caption" style={{ display: 'block', marginBottom: 6 }}>
                  Template Name
                </label>
                <input
                  id="save-template-template-name"
                  className="input-base"
                  type="text"
                  value={templateForm.name}
                  onChange={e => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label htmlFor="save-template-description" className="type-caption" style={{ display: 'block', marginBottom: 6 }}>
                  Description (optional)
                </label>
                <input
                  id="save-template-description"
                  className="input-base"
                  type="text"
                  placeholder="What is this template for?"
                  value={templateForm.description}
                  onChange={e => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <VisibilityPicker
                value={templateForm.visibility}
                onChange={visibility => setTemplateForm(prev => ({ ...prev, visibility }))}
                kind="template"
                workspaceName={boardWorkspace ? (boardWorkspace.is_personal ? 'your personal workspace' : boardWorkspace.name) : 'this workspace'}
                isPersonalWorkspace={!!boardWorkspace?.is_personal}
                disabled={savingTemplate}
              />
              <p className="type-micro" style={{ margin: 0 }}>
                Saves this board's current canvas as a reusable template in this workspace. Editing this board later won't change the template.
              </p>
              {templateError && <p className="type-micro" style={{ margin: 0, color: 'var(--color-error)' }}>{templateError}</p>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleSaveAsTemplate}
                  disabled={savingTemplate || !templateForm.name.trim()}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  {savingTemplate ? 'Saving...' : 'Save Template'}
                </button>
                <button
                  onClick={() => setShowSaveAsTemplate(false)}
                  className="btn-translucent"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
              </div>
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
                borderRadius: 'var(--radius-xl)', padding: 'var(--space-xl) var(--space-lg)', boxShadow: 'var(--shadow-level-2)',
                display: 'flex', flexDirection: 'column', gap: 16,
              }}
            >
              <h3 className="type-headline" style={{ margin: 0 }}>
                Delete "{board.name}"?
              </h3>
              <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
                This will permanently delete the board and all its contents. Cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleDeleteBoard}
                  disabled={deleting}
                  className="btn-primary btn-danger"
                  style={{ flex: 1 }}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="btn-translucent"
                  style={{ flex: 1 }}
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
      </div>
      </PortalContainerProvider>
    </>
  );
}

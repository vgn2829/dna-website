import { useEffect, useMemo, useRef, useState } from 'react';
import { useSync } from '@tldraw/sync';
import {
  Tldraw,
  type Editor,
  type TLAsset,
  type TLAssetStore,
} from 'tldraw';
import 'tldraw/tldraw.css';
import { api, type BoardItem } from '../lib/api';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  ClipboardOverride,
  injectPendingBoardItems,
  migrateLegacyBase64Assets,
  randomFileId,
} from './tldrawCanvasShared';
import { usePresenceUserInfo } from '../context/PresenceProvider';
import { CollaboratorList } from '../components/CollaboratorList';

// ─────────────────────────────────────────────────────────────────────────
// ARCHITECTURAL DECISIONS — read before modifying this file.
//
// 1. This component is a PARALLEL implementation, not a replacement.
//    TldrawCanvas.tsx (manual debounced save/load against
//    PUT/GET /boards/:id/canvas) is completely untouched and remains the
//    default/rollback path — see BoardPage.tsx for the selection logic
//    (realtime_enabled && REALTIME_ENABLED). Content-editing behavior that
//    has nothing to do with HOW persistence works (clipboard-as-real-image,
//    legacy base64 asset migration, Gallery "Save to Moodboard" item
//    injection, accepted MIME types) is shared via tldrawCanvasShared.ts —
//    both components import the same functions, so a fix to one applies to
//    both instead of silently drifting.
//
// 2. Persistence is entirely a backend concern (requirement: "frontend
//    must never know Postgres / snapshots / board storage / room
//    lifecycle — only the sync endpoint"). This component knows exactly
//    one thing about persistence: the WebSocket URL returned by
//    api.boards.getRealtimeUrl(roomId) (see api.ts's own doc comment on
//    that function). It never touches canvas_data, never calls
//    saveCanvas/loadCanvas, and has no debounce/save-timer logic at all —
//    useSync's returned store IS the live, synced document; there is
//    nothing left for this component to persist.
//
// 3. No custom WebSocket protocol, no custom reconnect logic.
//    useSync (from @tldraw/sync) owns the entire connection lifecycle:
//    connecting, reconnecting on network loss/visibility change, and
//    resuming the same session (via the sessionId it appends itself,
//    tab-scoped to tldraw's TAB_ID — see api.ts's getRealtimeUrl comment
//    and backend/src/realtime/connectionHandler.ts's matching note on the
//    server side of that contract). Verified directly against the
//    installed @tldraw/sync-core source: ClientWebSocketAdapter's
//    ReconnectManager already listens to window 'online'/'offline' and
//    document 'visibilitychange' and reconnects automatically — this
//    component adds NO listeners of its own for any of that, since doing
//    so would duplicate (and risk conflicting with) sync's own state
//    machine. The only thing built here is a thin status-to-UI mapping
//    over what useSync already reports.
//
// 4. Camera/selection survive reconnects because this component's <Tldraw>
//    is never remounted by a connection-status change — the connection
//    banner is an absolutely-positioned overlay alongside the canvas, not
//    a replacement for it. Camera and selection are ephemeral
//    instance-scoped records inside the SAME store object useSync hands
//    back; only creating a brand new store (which only happens if roomId/
//    uri actually changes — see useSync's own effect dependency array)
//    would reset them. Do not conditionally unmount <Tldraw> based on
//    connectionStatus; only the one-time initial 'loading'/'error' gate
//    below is allowed to do that, before the store/editor exist at all.
//
// 5. Authentication reuses the existing student JWT unchanged — no new
//    token, no new auth flow. getStudentToken() (via getRealtimeUrl) is
//    the exact same token every REST call already uses; the backend's WS
//    upgrade handler verifies it with the exact same verifyStudentToken()
//    function requireStudent/optionalStudent use (see
//    backend/src/middleware/studentAuth.ts).
// ─────────────────────────────────────────────────────────────────────────

interface TldrawCanvasSyncProps {
  boardId: string;
  roomId: string;
  theme: 'dark' | 'light';
  pendingItems?: BoardItem[];
  readOnly?: boolean;
}

type ConnectionState = 'loading' | 'connected' | 'reconnecting' | 'offline' | 'failed';

// useSync's RemoteTLStoreWithStatus only ever reports 'loading' | 'error' |
// ('synced-remote' + connectionStatus 'online'|'offline') — there is no
// separate wire-level "connecting" vs "reconnecting" signal. This maps that
// real, verified shape onto the six states the product spec asks for:
// 'loading' covers both Loading and Connecting (nothing in the API
// distinguishes an initial connect from a fast reconnect-from-scratch), and
// 'offline' is split into Offline (browser reports no network) vs
// Reconnecting (network is up but the socket isn't synced — e.g. the
// server is restarting) using navigator.onLine, which is real signal, not
// invented.
function deriveConnectionState(
  status: 'loading' | 'error' | 'synced-remote',
  connectionStatus: 'online' | 'offline' | undefined
): ConnectionState {
  if (status === 'error') return 'failed';
  if (status === 'loading') return 'loading';
  if (connectionStatus === 'online') return 'connected';
  return typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting';
}

const STATUS_COPY: Record<Exclude<ConnectionState, 'connected'>, { label: string; tone: 'neutral' | 'warning' | 'error' }> = {
  loading: { label: 'Connecting…', tone: 'neutral' },
  reconnecting: { label: 'Reconnecting…', tone: 'warning' },
  offline: { label: 'Offline — changes will sync when you\'re back online', tone: 'warning' },
  failed: { label: 'Connection failed', tone: 'error' },
};

function ConnectionBanner({ state, onRetry }: { state: Exclude<ConnectionState, 'connected'>; onRetry?: () => void }) {
  const { label, tone } = STATUS_COPY[state];
  const bg = tone === 'error' ? 'var(--color-error)' : tone === 'warning' ? '#b45309' : 'var(--color-surface-2)';
  const color = tone === 'neutral' ? 'var(--color-ink)' : '#fff';
  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 500, display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 14px', borderRadius: 'var(--radius-pill)',
      background: bg, color, fontSize: 12, fontWeight: 600,
      fontFamily: 'var(--font-body)', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      pointerEvents: state === 'failed' ? 'auto' : 'none',
    }}>
      {state === 'loading' && (
        <span style={{
          width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0,
        }} />
      )}
      <span>{label}</span>
      {state === 'failed' && onRetry && (
        <button
          onClick={onRetry}
          style={{
            pointerEvents: 'auto', padding: '2px 10px', background: 'rgba(255,255,255,0.2)',
            border: '1px solid rgba(255,255,255,0.4)', borderRadius: 'var(--radius-pill)',
            color: '#fff', fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function TldrawCanvasSync({
  boardId,
  roomId,
  theme,
  pendingItems,
  readOnly = false,
}: TldrawCanvasSyncProps) {
  const boardIdRef = useRef(boardId);
  useEffect(() => { boardIdRef.current = boardId; }, [boardId]);

  const pendingItemsRef = useRef<BoardItem[]>(pendingItems ?? []);
  useEffect(() => { pendingItemsRef.current = pendingItems ?? []; }, [pendingItems]);

  // Bumped to force useSync to tear down and recreate its connection —
  // this is the ONLY sanctioned way to retry after a hard 'error' status,
  // since useSync has no imperative reconnect() escape hatch (reconnection
  // for transient network loss is already automatic — see ReconnectManager
  // note above; this is specifically for the harder failure useSync itself
  // reports as unrecoverable, e.g. a rejected/incompatible room).
  const [retryNonce, setRetryNonce] = useState(0);

  const assetStore: TLAssetStore = useMemo(() => ({
    upload: async (_asset: TLAsset, file: File) => {
      const { url } = await api.boards.uploadCanvasFile(
        boardIdRef.current, file, randomFileId()
      );
      return url;
    },
  }), []);

  // getRealtimeUrl reads the current student JWT at call time — recomputing
  // it per roomId/retryNonce change (not memoizing across the component's
  // whole lifetime) means a token refresh between mounts is picked up
  // naturally, with no separate auth-refresh path to build.
  const uri = useMemo(
    () => api.boards.getRealtimeUrl(roomId),
    [roomId, retryNonce]
  );

  // Presence identity (id/name/color) — see PresenceProvider.tsx for how
  // this is derived from the student session. Everything downstream of
  // this (cursors, selections, idle detection, join/leave) is handled
  // automatically by useSync/<Tldraw> once userInfo is supplied; see
  // CollaboratorList.tsx for the one piece that IS custom UI (a
  // who's-here list + follow control), built on public Editor APIs
  // (getCollaboratorsOnCurrentPage, startFollowingUser) rather than a
  // parallel presence implementation.
  const userInfo = usePresenceUserInfo();

  const store = useSync({
    uri,
    assets: assetStore,
    ...(userInfo ? { userInfo } : {}),
  });

  const connectionState = deriveConnectionState(
    store.status,
    store.status === 'synced-remote' ? store.connectionStatus : undefined
  );

  // Gates the FIRST mount of <Tldraw> only. Once true, it never goes back
  // to false for the lifetime of this component instance — <Tldraw> stays
  // mounted through every later status flip (a retry going back through
  // 'loading', a network drop showing 'offline'/'reconnecting'), because
  // <Tldraw store={...}> is designed to accept a TLStoreWithStatus and
  // handle status transitions internally without needing to be unmounted
  // (verified against @tldraw/editor's TldrawEditor.tsx: it branches
  // internally on store.status via TldrawEditorWithLoadingStore, an Editor
  // instance is only ever constructed once status reaches 'synced-remote').
  // Conditionally unmounting <Tldraw> here on every status change — the
  // more obvious-looking implementation — would destroy and recreate the
  // Editor on every reconnect, silently breaking the "preserve camera,
  // preserve selection" requirement this component exists to satisfy.
  //
  // One accepted tradeoff from this rule: if useSync reports 'error' AFTER
  // a successful connection (a later sync error, not just the initial
  // connect failing), this component's custom error screen/Retry button
  // does NOT show — <Tldraw> stays mounted and falls through to its OWN
  // built-in error UI for that case, since preserving the live Editor
  // instance (and by extension camera/selection) takes priority once
  // editing has actually started. Only the pre-first-connect failure path
  // gets this component's custom UI.
  const hasEverConnectedRef = useRef(false);
  if (store.status === 'synced-remote') hasEverConnectedRef.current = true;
  const showCustomLoadingOrErrorScreen = !hasEverConnectedRef.current
    && (store.status === 'loading' || store.status === 'error');

  const editorRef = useRef<Editor | null>(null);
  const injectedRef = useRef(false);
  const handleMount = (editor: Editor) => {
    editorRef.current = editor;
    editor.user.updateUserPreferences({ colorScheme: theme });

    // Runs once per successful connection, mirroring TldrawCanvas.tsx's own
    // once-per-mount guard — useSync already loaded/merged the room's
    // persisted document before handing back a 'synced-remote' store (see
    // backend/src/realtime/rooms.ts: TLSocketRoom is constructed with
    // initialSnapshot loaded from persistence), so there is no separate
    // "load snapshot" step here the way the manual path needs — this only
    // covers the Gallery-item-injection gap that exists independent of
    // which persistence mechanism is in play.
    if (injectedRef.current) return;
    injectedRef.current = true;

    migrateLegacyBase64Assets(editor, boardIdRef.current).catch(err => {
      console.warn('Legacy asset migration failed:', err);
    });

    const pending = pendingItemsRef.current;
    const placeItems = pending.length > 0
      ? injectPendingBoardItems(editor, pending).catch(err => {
          console.warn('Failed to place pending board items:', err);
        })
      : Promise.resolve();

    placeItems.finally(() => {
      setTimeout(() => {
        try {
          editor.zoomToFit({ animation: { duration: 200 } });
        } catch {
          // empty canvas — ignore
        }
      }, 200);
    });
  };

  useEffect(() => {
    editorRef.current?.user.updateUserPreferences({ colorScheme: theme });
  }, [theme]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      {connectionState !== 'connected' && connectionState !== 'loading' && (
        <ConnectionBanner
          state={connectionState}
          onRetry={connectionState === 'failed' ? () => setRetryNonce(n => n + 1) : undefined}
        />
      )}

      {showCustomLoadingOrErrorScreen ? (
        store.status === 'loading' ? (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme === 'dark' ? '#1a1a1a' : '#f8f8f8',
            color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
            fontFamily: 'var(--font-body)', fontSize: 14,
            flexDirection: 'column', gap: 12,
          }}>
            <div style={{
              width: 20, height: 20,
              border: `2px solid currentColor`,
              borderTopColor: 'transparent',
              borderRadius: 'var(--radius-full)',
              animation: 'spin 0.8s linear infinite',
            }} />
            Connecting to board…
          </div>
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 16, background: theme === 'dark' ? '#1a1a1a' : '#f8f8f8',
            color: theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
            fontFamily: 'var(--font-body)', fontSize: 14,
          }}>
            <p style={{ margin: 0 }}>Couldn't connect to this board's live session.</p>
            <button
              onClick={() => setRetryNonce(n => n + 1)}
              style={{
                padding: '10px 20px', background: 'var(--color-brand)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13,
                fontFamily: 'var(--font-body)', cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )
      ) : (
        // Mounted once hasEverConnectedRef flips true, and never unmounted
        // again by this component afterwards (see the ref's own comment) —
        // key={roomId} only changes if the user navigates to a genuinely
        // different board, which is the one case a remount IS correct.
        <Tldraw
          key={roomId}
          store={store}
          hideUi={readOnly}
          autoFocus
          inferDarkMode={false}
          acceptedImageMimeTypes={ACCEPTED_IMAGE_MIME_TYPES}
          acceptedVideoMimeTypes={[]}
          onMount={handleMount}
        >
          <ClipboardOverride />
          {/* Renders as a child of <Tldraw> (not a sibling in this
              component's own JSX) because CollaboratorList/its hooks call
              useEditor(), which requires an EditorContext ancestor —
              exactly the same reason ClipboardOverride is mounted here
              rather than outside <Tldraw>. */}
          <CollaboratorList />
        </Tldraw>
      )}
    </div>
  );
}

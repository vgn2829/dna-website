import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  type Editor,
  type TLAsset,
  type TLAssetStore,
  type TLStoreSnapshot,
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
import { CommentsOverlay } from '../components/CommentsOverlay';
import type { CommentsProps } from './commentsProps';

interface TldrawCanvasProps {
  boardId: string;
  theme: 'dark' | 'light';
  initialData: unknown;
  pendingItems?: BoardItem[];
  onSave: (snapshot: unknown) => void;
  readOnly?: boolean;
  // Commit 6 — see commentsProps.ts's own comment on why this is one prop
  // object rather than five separate ones threaded through both canvas
  // components.
  comments?: CommentsProps;
}

export function TldrawCanvas({
  boardId,
  theme,
  initialData,
  pendingItems,
  onSave,
  readOnly = false,
  comments,
}: TldrawCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const onSaveRef = useRef(onSave);
  const initialDataRef = useRef<unknown>(initialData);
  const pendingItemsRef = useRef<BoardItem[]>(pendingItems ?? []);
  const snapshotLoadedRef = useRef(false);

  const boardIdRef = useRef(boardId);
  useEffect(() => { boardIdRef.current = boardId; }, [boardId]);

  // Uploads real image files to Supabase Storage (via the canvas-files
  // endpoint) instead of Tldraw's default of inlining them as base64 data
  // URLs in canvas_data. Real URLs are stable, small, and identical for
  // every viewer — no payload-size races, no per-user visibility gap.
  const assetStore: TLAssetStore = useMemo(() => ({
    upload: async (_asset: TLAsset, file: File) => {
      const { url } = await api.boards.uploadCanvasFile(
        boardIdRef.current, file, randomFileId()
      );
      return url;
    },
  }), []);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.user.updateUserPreferences({ colorScheme: theme });
  }, [theme]);

  const handleSave = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const snapshot = getSnapshot(editor.store);
      const serialized = JSON.stringify(snapshot);
      if (serialized === lastSavedRef.current) return;
      lastSavedRef.current = serialized;
      onSaveRef.current(snapshot);
    } catch (err) {
      console.error('Canvas save error:', err);
    }
  }, []);

  const handleChange = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(handleSave, 3000);
  }, [handleSave]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        handleSave();
      }
    };
    const onUnload = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      handleSave();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [handleSave]);

  useEffect(() => {
    const onOffline = () => {
      console.log('Network lost — saving canvas');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      handleSave();
    };
    const onOnline = () => {
      console.log('Network restored');
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [handleSave]);

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <Tldraw
        hideUi={readOnly}
        autoFocus
        inferDarkMode={false}
        assets={assetStore}
        acceptedImageMimeTypes={ACCEPTED_IMAGE_MIME_TYPES}
        acceptedVideoMimeTypes={[]}
        onMount={(editor: Editor) => {
          editorRef.current = editor;

          editor.user.updateUserPreferences({ colorScheme: theme });

          if (!snapshotLoadedRef.current) {
            snapshotLoadedRef.current = true;

            if (initialDataRef.current) {
              try {
                const snap = initialDataRef.current as TLStoreSnapshot;
                loadSnapshot(editor.store, snap);
                // One-time, opportunistic migration of any legacy base64-embedded
                // assets to real uploaded URLs — done once at load time (not on
                // every save) so it doesn't add latency to the debounced save
                // path once a board is clean. Runs in the background; if it
                // finishes, the very next debounced save persists the migrated
                // URLs instead of the base64 blobs.
                migrateLegacyBase64Assets(editor, boardIdRef.current).catch(err => {
                  console.warn('Legacy asset migration failed:', err);
                });
              } catch (err) {
                console.warn('Failed to load snapshot:', err);
              }
            }

            // Materialize any board_items saved via "Save to Moodboard"
            // (e.g. from the Gallery) that aren't on the canvas yet — see
            // injectPendingBoardItems for why this table needs draining here.
            // Independent of whether a snapshot existed: a brand-new board
            // can still have pending items with no prior canvas_data.
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
          }

          editor.store.listen(handleChange, {
            scope: 'document',
            source: 'user',
          });
        }}
      >
        <ClipboardOverride />
        {comments && (
          <CommentsOverlay
            commentsApi={comments.commentsApi}
            commentMode={comments.commentMode}
            onExitCommentMode={comments.onExitCommentMode}
            currentRoll={comments.currentRoll}
            canModerate={comments.canModerate}
            lastSeenAt={comments.lastSeenAt}
          />
        )}
      </Tldraw>
    </div>
  );
}

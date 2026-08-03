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
import { api } from '../lib/api';

// Supabase Storage only serves these image types through canvas-files
// (see backend CANVAS_MIME_EXT) — restrict Tldraw's accepted types to match,
// and disallow video entirely, so the client never attempts an upload the
// server is guaranteed to reject.
const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
];

function randomFileId(): string {
  return `canvas_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

interface TldrawCanvasProps {
  boardId: string;
  theme: 'dark' | 'light';
  initialData: unknown;
  onSave: (snapshot: unknown) => void;
  readOnly?: boolean;
}

export function TldrawCanvas({
  boardId,
  theme,
  initialData,
  onSave,
  readOnly = false,
}: TldrawCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const onSaveRef = useRef(onSave);
  const initialDataRef = useRef<unknown>(initialData);
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

          if (initialDataRef.current && !snapshotLoadedRef.current) {
            snapshotLoadedRef.current = true;
            try {
              const snap = initialDataRef.current as TLStoreSnapshot;
              loadSnapshot(editor.store, snap);
              setTimeout(() => {
                try {
                  editor.zoomToFit({ animation: { duration: 200 } });
                } catch {
                  // empty canvas — ignore
                }
              }, 200);
            } catch (err) {
              console.warn('Failed to load snapshot:', err);
            }
          }

          editor.store.listen(handleChange, {
            scope: 'document',
            source: 'user',
          });
        }}
      />
    </div>
  );
}

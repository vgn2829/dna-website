import {
  useEffect,
  useRef,
  useCallback,
} from 'react';
import {
  Tldraw,
  type Editor,
} from 'tldraw';
import 'tldraw/tldraw.css';

interface TldrawCanvasProps {
  theme: 'dark' | 'light';
  initialData: unknown;
  onSave: (snapshot: unknown) => void;
  readOnly?: boolean;
}

export function TldrawCanvas({
  theme,
  initialData,
  onSave,
  readOnly = false,
}: TldrawCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');
  const onSaveRef = useRef(onSave);
  const initialDataRef = useRef(initialData);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.user.updateUserPreferences({ colorScheme: theme });
    }
  }, [theme]);

  const handleSave = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const snapshot = editor.store.getSnapshot();
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

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <Tldraw
        // No custom assets prop — tldraw's default handling stores images as base64
        // dataURLs directly in the snapshot, which persists correctly across reloads.
        // A custom assetStore.resolve() returning null caused the crash:
        // "asset.props.src: Expected string, got undefined"
        hideUi={readOnly}
        forceMobile={false}
        inferDarkMode={false}
        onMount={(editor: Editor) => {
          editorRef.current = editor;

          editor.user.updateUserPreferences({ colorScheme: theme });

          if (initialDataRef.current) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const snap = initialDataRef.current as any;

              // Strip image assets with no src before loading — these crash tldraw
              // with "Expected string, got undefined" during schema validation.
              if (snap?.store && typeof snap.store === 'object') {
                const cleanStore: Record<string, unknown> = {};
                for (const [key, record] of Object.entries(
                  snap.store as Record<string, unknown>
                )) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const r = record as any;
                  if (r?.typeName === 'asset' && r?.type === 'image' && !r?.props?.src) {
                    console.warn('Skipping asset with no src:', key);
                    continue;
                  }
                  cleanStore[key] = record;
                }
                snap.store = cleanStore;
              }

              editor.store.loadSnapshot(
                snap as Parameters<typeof editor.store.loadSnapshot>[0]
              );

              // Fit view to content so user sees their work, not an empty corner
              setTimeout(() => {
                try {
                  editor.zoomToFit({ animation: { duration: 200 } });
                } catch {
                  // zoomToFit may throw on an empty canvas — safe to ignore
                }
              }, 150);
            } catch (err) {
              console.warn('Failed to load snapshot:', err);
              // Start fresh rather than crashing
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

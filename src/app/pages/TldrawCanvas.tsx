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
  const initialDataRef = useRef<unknown>(initialData);
  const snapshotLoadedRef = useRef(false);

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
        hideUi={readOnly}
        autoFocus
        inferDarkMode={false}
        onMount={(editor: Editor) => {
          editorRef.current = editor;

          editor.user.updateUserPreferences({ colorScheme: theme });

          if (initialDataRef.current && !snapshotLoadedRef.current) {
            snapshotLoadedRef.current = true;
            try {
              const snap = initialDataRef.current as Parameters<
                typeof editor.store.loadSnapshot
              >[0];
              editor.store.loadSnapshot(snap);
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

import {
  useEffect,
  useRef,
  useCallback,
} from 'react';
import {
  Tldraw,
  type Editor,
  type TLAssetStore,
} from 'tldraw';
import 'tldraw/tldraw.css';

interface TldrawCanvasProps {
  theme: 'dark' | 'light';
  initialData: unknown;
  onSave: (snapshot: unknown) => void;
  readOnly?: boolean;
}

// Asset store that resolves image URLs from the snapshot data.
// Converts uploaded files to base64 data URLs so images survive
// snapshot save/reload without needing a separate file server.
const createAssetStore = (): TLAssetStore => ({
  async upload(_asset, file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
  resolve(asset) {
    return asset.props.src ?? null;
  },
});

// Created once outside component to prevent re-creation on re-renders
const assetStore = createAssetStore();

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

  // Keep onSave ref current without invalidating callbacks
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Sync theme changes to an already-mounted editor
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

  // Save on tab hide or page unload
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
        assets={assetStore}
        hideUi={readOnly}
        forceMobile={false}
        inferDarkMode={false}
        onMount={(editor: Editor) => {
          editorRef.current = editor;

          editor.user.updateUserPreferences({ colorScheme: theme });

          if (initialDataRef.current) {
            try {
              editor.store.loadSnapshot(
                initialDataRef.current as Parameters<typeof editor.store.loadSnapshot>[0]
              );
              // Fit view to content after load so user sees their work, not an empty corner
              setTimeout(() => {
                editor.zoomToFit({ animation: { duration: 0 } });
              }, 100);
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

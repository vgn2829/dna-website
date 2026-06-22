import { useEffect, useRef, useCallback } from 'react';
import { Tldraw, type Editor } from 'tldraw';
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

  // Update theme when it changes externally
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.user.updateUserPreferences({ colorScheme: theme });
    }
  }, [theme]);

  const handleSave = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const snapshot = editor.store.getSnapshot();
    const serialized = JSON.stringify(snapshot);

    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;

    onSave(snapshot);
  }, [onSave]);

  const handleChange = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(handleSave, 3000);
  }, [handleSave]);

  // Save on tab hide or page unload
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        handleSave();
      }
    };
    const handleBeforeUnload = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      handleSave();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [handleSave]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Tldraw
        forceMobile={false}
        hideUi={readOnly}
        onMount={(editor: Editor) => {
          editorRef.current = editor;

          editor.user.updateUserPreferences({ colorScheme: theme });

          if (initialData) {
            try {
              editor.store.loadSnapshot(initialData as Parameters<typeof editor.store.loadSnapshot>[0]);
            } catch (err) {
              console.warn('Failed to load canvas snapshot:', err);
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

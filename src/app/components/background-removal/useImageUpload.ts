import { useCallback, useEffect, useRef, useState } from 'react';
import { isAcceptableImage, MAX_IMAGE_MB } from './compositing';

interface Options {
  onImage: (file: File) => void;
  onReject?: (reason: string) => void;
  /** Only listen for clipboard paste while true (i.e. the tool is active). */
  enabled?: boolean;
}

/**
 * Upload surface for an image: hidden file input + drag/drop handlers +
 * document-level clipboard paste. Validates type and size before accepting.
 */
export function useImageUpload({ onImage, onReject, enabled = true }: Options) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setDragging] = useState(false);

  const accept = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!isAcceptableImage(file)) {
        onReject?.(`Unsupported file. Use PNG, JPEG, WebP, GIF or BMP under ${MAX_IMAGE_MB} MB.`);
        return;
      }
      onImage(file);
    },
    [onImage, onReject],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      accept(e.target.files?.[0]);
      e.target.value = ''; // allow re-selecting the same file
    },
    [accept],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      accept(e.dataTransfer.files?.[0]);
    },
    [accept],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  // Clipboard paste — attached at the document level only while enabled.
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            accept(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [enabled, accept]);

  return { inputRef, isDragging, openPicker, onInputChange, onDrop, onDragOver, onDragLeave };
}

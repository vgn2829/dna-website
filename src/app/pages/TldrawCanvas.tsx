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
  useEditor,
  useMenuClipboardEvents,
  type Editor,
  type TLAsset,
  type TLAssetPartial,
  type TLAssetStore,
  type TLImageShape,
  type TLStoreSnapshot,
} from 'tldraw';
import 'tldraw/tldraw.css';
import { api } from '../lib/api';

// Tldraw's own copy handler never puts real image bytes on the clipboard —
// it always serializes the selection (shapes + resolved assets) into its
// own round-trip text format (lz-string-compressed JSON), written as
// text/html + text/plain, with no image/* MIME entry. Pasting into a
// non-Tldraw app (Canva, Notes, etc.) then falls back to inserting that
// blob as literal text — for an old base64-sourced image this is a
// multi-megabyte wall of garbled text; for a Supabase-URL-sourced image
// it's a short but still useless compressed string.
//
// This only overrides the single-image-shape-selection case: fetch the
// resolved asset's original source (data: URI or http(s) URL, both work
// with fetch()), draw it to a canvas, and write a real image/png
// ClipboardItem so external apps get an actual image. Any other selection
// (multiple shapes, non-image shapes, mixed, or none) is left completely
// alone — Tldraw's own document-level `copy` listener (registered inside
// <TldrawUi>, bubble phase, unconditionally) still runs unchanged.
//
// Scoped to the reported bug: copies the full original image, not the
// in-canvas crop/flip transform — acceptable since the bug is "no image
// pastes at all", not "the pasted image doesn't match the crop".
//
// navigator.clipboard.write() must be CALLED synchronously within the
// original user-gesture call stack — Safari (and potentially other
// browsers) rejects it with NotAllowedError if even one `await` happens
// first, since that breaks the "transient user activation" the Clipboard
// API requires (confirmed via a real-world Safari clipboard fix:
// https://github.com/inveniosoftware/invenio-app-rdm/pull/3379, itself
// citing https://wolfgangrittner.dev/how-to-use-clipboard-api-in-safari/).
// The original version of this function awaited resolveAssetUrl/fetch/
// createImageBitmap/canvas.toBlob BEFORE calling write() — which worked in
// permissive test environments but silently failed in stricter browsers,
// producing a blank clipboard with no fallback (see below). The fix: build
// the whole async chain as a single Promise<Blob> and pass THAT directly
// into ClipboardItem, so the write() call itself happens with no awaits
// ahead of it — the async work still happens, just resolved internally by
// the Clipboard API rather than before the call.
function buildPngBlob(editor: Editor, assetId: TLImageShape['props']['assetId']): Promise<Blob> {
  return (async () => {
    const src = await editor.resolveAssetUrl(assetId, { shouldResolveToOriginal: true });
    if (!src) throw new Error('Could not resolve asset URL');

    const sourceBlob = await fetch(src).then(r => {
      if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
      return r.blob();
    });

    const bitmap = await createImageBitmap(sourceBlob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2d canvas context');
    ctx.drawImage(bitmap, 0, 0);

    const pngBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('Canvas toBlob returned null');
    return pngBlob;
  })();
}

function tryCopySingleImageAsRealImage(editor: Editor): Promise<boolean> {
  const shapes = editor.getSelectedShapes();
  if (shapes.length !== 1) return Promise.resolve(false);

  const shape = shapes[0];
  if (!editor.isShapeOfType<TLImageShape>(shape, 'image')) return Promise.resolve(false);

  const assetId = shape.props.assetId;
  if (!assetId) return Promise.resolve(false);

  // Call write() synchronously (no await before it) — per the Clipboard API
  // spec, if the ClipboardItem's promise value rejects, write()'s own
  // returned promise rejects too, so the async failure still surfaces here.
  return navigator.clipboard.write([
    new ClipboardItem({ 'image/png': buildPngBlob(editor, assetId) }),
  ]).then(
    () => true,
    (err) => {
      // Network failure, CORS block on fetch(), clipboard permission
      // denial, etc. — fall through to Tldraw's default text-based copy so
      // this is never worse than the pre-existing behavior.
      console.warn('Real-image clipboard copy failed, falling back to default copy:', err);
      return false;
    }
  );
}

function isEditingTextElsewhere(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el.getAttribute('contenteditable')) return true;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea';
}

// Rendered as a child of <Tldraw> purely to reach editor context via
// useEditor()/useMenuClipboardEvents() — renders nothing itself.
function ClipboardOverride() {
  const editor = useEditor();
  const { copy: defaultMenuCopy } = useMenuClipboardEvents();

  useEffect(() => {
    // Capture phase runs before Tldraw's own bubble-phase `copy` listener
    // (registered by useNativeClipboardEvents inside <TldrawUi>, with no
    // capture option), regardless of React effect mount ordering — so this
    // reliably gets first look at every copy event on the page.
    const onCopyCapture = (e: ClipboardEvent) => {
      if (!editor.getInstanceState().isFocused) return;
      if (editor.getEditingShapeId() !== null) return;
      if (isEditingTextElsewhere()) return;

      const shapes = editor.getSelectedShapes();
      if (shapes.length !== 1) return;
      if (!editor.isShapeOfType<TLImageShape>(shapes[0], 'image')) return;

      // Claim the event now (synchronously, in capture phase) so Tldraw's
      // bubble-phase listener never runs for this single-image case, even
      // though the actual fetch/encode/write below is async.
      e.preventDefault();
      e.stopImmediatePropagation();

      tryCopySingleImageAsRealImage(editor).then(succeeded => {
        if (!succeeded) {
          // Fall back to Tldraw's actual default copy behavior (the same
          // handler the menu/shortcut would have run) so a failure here is
          // never worse than today's pre-existing behavior. Tldraw's own
          // copy path has the same async-before-write structure as the one
          // fixed above (it awaits editor.resolveAssetsInContent before its
          // internal navigator.clipboard.write call) and has no internal
          // try/catch, so it can also reject in strict browsers — catch it
          // here so a second failure is a logged no-op, not an unhandled
          // promise rejection.
          defaultMenuCopy('kbd').catch(err => {
            console.warn('Fallback default copy also failed:', err);
          });
        }
      });
    };

    document.addEventListener('copy', onCopyCapture, { capture: true });
    return () => {
      document.removeEventListener('copy', onCopyCapture, { capture: true });
    };
  }, [editor, defaultMenuCopy]);

  return null;
}

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

const DATA_URI_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

// Boards created before the Supabase-Storage upload fix (see PR #57) still
// have image/video assets with a base64 data: URI as their src, embedded
// directly in canvas_data. A single such asset can be several MB, which
// blows past /api/boards' JSON body limit and makes the save silently
// 413 — losing every edit in that save, not just the image. Migrating
// each legacy asset to a real uploaded URL on the very next save (rather
// than only handling this for newly-added images) is what actually closes
// the gap for boards that already exist, instead of just capping the risk
// with a bigger limit that the same board will eventually outgrow again as
// more images get added.
async function migrateLegacyBase64Assets(editor: Editor, boardId: string): Promise<void> {
  const legacyAssets = editor.getAssets().filter(
    (a): a is TLAsset & { props: { src: string } } =>
      (a.type === 'image' || a.type === 'video') &&
      typeof a.props.src === 'string' &&
      a.props.src.startsWith('data:')
  );
  if (legacyAssets.length === 0) return;

  const updates = await Promise.allSettled(
    legacyAssets.map(async asset => {
      const mimeMatch = asset.props.src.match(/^data:([^;]+);base64,/);
      const mimeType = mimeMatch?.[1];
      const ext = mimeType ? DATA_URI_MIME_EXT[mimeType] : undefined;
      if (!ext) throw new Error(`Unsupported legacy asset mime type: ${mimeType}`);

      const blob = await fetch(asset.props.src).then(r => r.blob());
      const file = new File([blob], `${asset.id}.${ext}`, { type: mimeType });
      const { url } = await api.boards.uploadCanvasFile(boardId, file, randomFileId());
      // editor.updateAssets shallow-merges { ...existing, ...partial } — a
      // partial `props` object REPLACES the whole props key rather than
      // merging into it, so every other prop (w, h, name, fileSize,
      // mimeType, isAnimated) must be carried through here, not just src.
      return { id: asset.id, type: asset.type, props: { ...asset.props, src: url } } as TLAssetPartial;
    })
  );

  const succeeded = updates
    .filter((r): r is PromiseFulfilledResult<TLAssetPartial> => r.status === 'fulfilled')
    .map(r => r.value);

  if (succeeded.length > 0) {
    // history: 'ignore' via updateAssets's own internal `run` call would be
    // ideal, but updateAssets doesn't expose that option — this still goes
    // through the normal 'user'/'document' path, which just means the
    // migration itself gets picked up by the next debounced save too
    // (harmless: assets are already URLs by then, so it's a no-op pass).
    editor.updateAssets(succeeded);
  }

  const failed = updates.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    console.warn(`Failed to migrate ${failed.length} legacy embedded image(s) to storage:`, failed);
  }
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

          editor.store.listen(handleChange, {
            scope: 'document',
            source: 'user',
          });
        }}
      >
        <ClipboardOverride />
      </Tldraw>
    </div>
  );
}

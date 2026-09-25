import {
  AssetRecordType,
  createShapeId,
  useEditor,
  useMenuClipboardEvents,
  type Editor,
  type TLAsset,
  type TLAssetPartial,
  type TLImageShape,
} from 'tldraw';
import { useEffect } from 'react';
import { api, type BoardItem } from '../lib/api';

// Logic shared between TldrawCanvas (manual save/load) and TldrawCanvasSync
// (@tldraw/sync) — everything here is about canvas CONTENT/UX and is
// completely independent of how persistence works, so it must not be
// duplicated between the two components (see Commit 3's own commit message
// for why: two copies of clipboard/migration/injection logic drifting out
// of sync with each other is a real maintenance hazard, worse than one
// shared file both import from).

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
export function ClipboardOverride() {
  const editor = useEditor();
  const { copy: defaultMenuCopy } = useMenuClipboardEvents();

  useEffect(() => {
    // Capture phase runs before Tldraw's own bubble-phase `copy` listener
    // (registered by useNativeClipboardEvents inside <TldrawUi>, with no
    // capture option), regardless of React effect mount ordering — so this
    // reliably gets first look at every copy event on the page.
    const onCopyCapture = (e: ClipboardEvent) => {
      // NOT editor.getInstanceState().isFocused — that tracks tldraw's own
      // internal focus bookkeeping, which can already read false at the
      // moment a copy event fires for perfectly legitimate ways of
      // triggering copy (right-click → Copy from the browser's native
      // context menu, or the OS/browser's Edit menu) even though the
      // user's selection and intent are completely valid — silently
      // falling through to Tldraw's default (text-only) copy for those
      // paths with no attempt at a real image at all. Checking that the
      // event's own target is inside the editor's container is a more
      // direct, focus-state-independent proxy for "this copy actually
      // targets the canvas" — it reflects where the browser dispatched
      // the event, not a separately-tracked boolean that can drift.
      const container = editor.getContainer();
      if (!container.contains(e.target as Node) && document.activeElement !== document.body) return;
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
export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
];

export function randomFileId(): string {
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
export async function migrateLegacyBase64Assets(editor: Editor, boardId: string): Promise<void> {
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

function loadImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 300, h: img.naturalHeight || 300 });
    img.onerror = () => resolve({ w: 300, h: 300 });
    img.src = src;
  });
}

const ITEM_GRID_COLS = 4;
const ITEM_GRID_CELL = 340;
const ITEM_GRID_GAP = 40;

// "Save to Moodboard" (GalleryPage) writes rows into board_items via a REST
// endpoint that predates this tldraw-based canvas — that table was the
// content model before the canvas rewrite, and nothing here ever read it
// back, so a saved item vanished with no error (see PR discussion / Phase 0
// audit). This materializes never-placed board_items as real image shapes
// on load. "Never placed" is the persisted lifecycle state, placed_at ===
// null — the backend sets placed_at the first time a saved canvas contains
// the item's shape and never clears it (lib/boardRows.ts), and the board
// endpoints already return only pending rows. Shape existence is NOT the
// lifecycle test (a shape the user deleted is gone too, and must not come
// back); editor.getShape(id) stays only as a duplicate guard for a
// placement that hasn't been saved yet. Shape/asset ids are deterministic
// (derived from the item id). Once placed, the item is a normal canvas
// shape: it moves/deletes/persists like anything else.
export async function injectPendingBoardItems(editor: Editor, items: BoardItem[]): Promise<void> {
  const toPlace = items.filter(item => item.placed_at == null && !editor.getShape(createShapeId(item.id)));
  if (toPlace.length === 0) return;

  const viewport = editor.getViewportPageBounds();
  const originX = viewport.x + 80;
  const originY = viewport.y + 80;

  const sizes = await Promise.all(toPlace.map(item => loadImageSize(item.image_url)));

  const assets: TLAsset[] = [];
  const shapePartials: Array<{
    id: ReturnType<typeof createShapeId>;
    type: 'image';
    x: number;
    y: number;
    props: { w: number; h: number; assetId: ReturnType<typeof AssetRecordType.createId>; url: string };
  }> = [];

  toPlace.forEach((item, i) => {
    const { w, h } = sizes[i];
    // Cap displayed size so a huge source photo doesn't dwarf the board;
    // aspect ratio is preserved since both dimensions scale together.
    const scale = Math.min(1, 280 / Math.max(w, h));
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);

    const assetId = AssetRecordType.createId(item.id);
    const shapeId = createShapeId(item.id);
    const col = i % ITEM_GRID_COLS;
    const row = Math.floor(i / ITEM_GRID_COLS);

    assets.push(
      AssetRecordType.create({
        id: assetId,
        type: 'image',
        props: {
          w, h,
          name: item.note ?? 'Saved from gallery',
          src: item.image_url,
          mimeType: null,
          isAnimated: false,
        },
      })
    );

    shapePartials.push({
      id: shapeId,
      type: 'image',
      x: originX + col * (ITEM_GRID_CELL + ITEM_GRID_GAP),
      y: originY + row * (ITEM_GRID_CELL + ITEM_GRID_GAP),
      props: { w: dw, h: dh, assetId, url: '' },
    });
  });

  editor.createAssets(assets);
  editor.createShapes(shapePartials);
}

// Asset Manager (Phase B) board-insertion — the single-item analog of
// injectPendingBoardItems above (that function is a batch, grid-placement,
// on-load mechanism for an unrelated pre-existing feature; this is a
// one-off, user-triggered "place this asset at the viewport center right
// now" action). Deliberately reuses the SAME tldraw asset APIs
// (AssetRecordType.create + editor.createAssets + editor.createShapes) —
// no parallel canvas object model. Uses a random id (not asset.id) for
// the shape/asset pair, so inserting the same library asset onto a board
// twice creates two independent shape instances, not a dedup no-op —
// that's the correct behavior for a reusable library (Figma/Canva both
// let you drop the same asset multiple times).
//
// ASSET PROVENANCE (V2.4 Phase 6, architecture-audit recommendation) —
// sourceAssetId, when provided, is stamped onto the CREATED TLAsset
// record's own `meta` field (meta: JsonObject, a first-class part of
// every tldraw record's schema — see @tldraw/tlschema's TLBaseAsset,
// confirmed by reading its .d.ts directly before writing this). This is
// NOT a new persistence mechanism: meta rides inside the same
// canvas_data snapshot every other shape/asset property already does,
// serialized by tldraw's own getSnapshot/useSync exactly like `props` or
// `x`/`y` — no new table, no new column, no asset-to-board join table,
// no file duplication. It survives local editing, refresh, and realtime
// sync for the same reason `props.src` does: tldraw treats `meta` as
// ordinary record data, not something this app has to shepherd through
// persistence by hand. Optional (defaults to undefined) so every
// EXISTING call site (and every asset inserted before this phase) keeps
// working with no meta at all — this is purely additive metadata on
// newly-inserted assets, never a required/breaking parameter.
export async function insertImageAsset(
  editor: Editor,
  url: string,
  name: string,
  knownWidth: number | null,
  knownHeight: number | null,
  sourceAssetId?: string
): Promise<void> {
  const { w, h } = knownWidth && knownHeight
    ? { w: knownWidth, h: knownHeight }
    : await loadImageSize(url);

  const scale = Math.min(1, 400 / Math.max(w, h));
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);

  const viewport = editor.getViewportPageBounds();
  const x = viewport.x + viewport.w / 2 - dw / 2;
  const y = viewport.y + viewport.h / 2 - dh / 2;

  const uid = randomFileId();
  const assetId = AssetRecordType.createId(uid);
  const shapeId = createShapeId(uid);

  editor.createAssets([
    AssetRecordType.create({
      id: assetId,
      type: 'image',
      props: { w, h, name, src: url, mimeType: null, isAnimated: false },
      ...(sourceAssetId ? { meta: { sourceAssetId } } : {}),
    }),
  ]);
  editor.createShapes([
    { id: shapeId, type: 'image', x, y, props: { w: dw, h: dh, assetId, url: '' } },
  ]);
}

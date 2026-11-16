import {
  AssetRecordType,
  Box,
  createShapeId,
  exportToBlob,
  getSvgAsImage,
  type Editor,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw';
import type { StarterColor, StarterLayout, StarterShape } from './boardStarters';
import { readingOrder, type BoardImageShape, type LightboxImage } from './lightbox';
import { exportFileName, fitInsertSize, planExport, planTidyGrid, previewScale, type ExportPlan } from './boardLayout';

// ─────────────────────────────────────────────────────────────────────────
// Editor-side tools for Moodboards (Milestone B): starter layouts, Asset
// Library insertion, tidy/wrap organization and image export. Every function
// uses public tldraw Editor APIs and produces ordinary tldraw records — no
// parallel object model, no new persistence path. Saving, realtime sync,
// undo/redo and version history all keep working because they only ever see
// normal shapes and assets.
//
// Imported dynamically from BoardPage (like tldrawCanvasShared) so the heavy
// tldraw bundle stays out of the non-canvas pages.
// ─────────────────────────────────────────────────────────────────────────

const DARK_SWATCHES: ReadonlySet<StarterColor> = new Set(['black', 'blue', 'violet', 'red', 'green', 'grey']);

// ── Starter layouts ───────────────────────────────────────────────────────

type ShapeInput = TLShapePartial & { id: TLShapeId };

export function starterShapeToPartial(spec: StarterShape, parentId?: TLShapeId): ShapeInput {
  const id = createShapeId();
  const parent = parentId ? { parentId } : {};
  switch (spec.kind) {
    case 'frame':
      return { id, type: 'frame', x: spec.x, y: spec.y, ...parent, props: { w: spec.w, h: spec.h, name: spec.name } };
    case 'text':
      return { id, type: 'text', x: spec.x, y: spec.y, ...parent, props: { text: spec.text, size: spec.size ?? 'm', color: spec.color ?? 'black', autoSize: true } };
    case 'note':
      return { id, type: 'note', x: spec.x, y: spec.y, ...parent, props: { text: spec.text, color: spec.color ?? 'yellow' } };
    case 'slot':
      return {
        id, type: 'geo', x: spec.x, y: spec.y, ...parent,
        props: {
          geo: 'rectangle', w: spec.w, h: spec.h, fill: 'none', dash: 'dashed', color: 'grey',
          size: 's', text: spec.label ?? 'Drop an image', labelColor: 'grey', align: 'middle', verticalAlign: 'middle',
        },
      };
    case 'swatch':
      return {
        id, type: 'geo', x: spec.x, y: spec.y, ...parent,
        props: {
          geo: 'rectangle', w: spec.w, h: spec.h, fill: 'solid', dash: 'solid', color: spec.color,
          size: 's', text: spec.label ?? '', labelColor: DARK_SWATCHES.has(spec.color) ? 'white' : 'black',
          align: 'middle', verticalAlign: 'end',
        },
      };
  }
}

/** Top-left of the layout's overall bounds (top-level shapes only). */
function layoutBounds(shapes: readonly StarterShape[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const w = 'w' in s ? s.w : 240;
    const h = 'h' in s ? s.h : 60;
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + w); maxY = Math.max(maxY, s.y + h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Builds a starter layout on the current page, centred in the viewport.
 * Refuses (returns false) when the board already has anything on it — a
 * starter must never overwrite or sit on top of existing work.
 */
export function applyStarterLayout(editor: Editor, layout: StarterLayout): boolean {
  if (editor.getInstanceState().isReadonly || editor.getCurrentPageShapeIds().size > 0) return false;

  const b = layoutBounds(layout.shapes);
  const view = editor.getViewportPageBounds();
  const dx = Math.round(view.x + view.w / 2 - (b.minX + b.maxX) / 2);
  const dy = Math.round(view.y + view.h / 2 - (b.minY + b.maxY) / 2);

  editor.run(() => {
    // Parents first, then children, so every parentId already exists.
    const top: ShapeInput[] = [];
    const children: ShapeInput[] = [];
    for (const spec of layout.shapes) {
      const partial = starterShapeToPartial(spec);
      partial.x = (partial.x ?? 0) + dx;
      partial.y = (partial.y ?? 0) + dy;
      top.push(partial);
      if (spec.kind === 'frame') {
        for (const child of spec.children) children.push(starterShapeToPartial(child, partial.id));
      }
    }
    editor.createShapes(top);
    if (children.length) editor.createShapes(children);
    editor.selectNone();
  });
  try {
    editor.zoomToFit({ animation: { duration: 200 } });
  } catch {
    // Camera animation is cosmetic.
  }
  return true;
}

// ── Asset Library insertion ───────────────────────────────────────────────

export interface LibraryImage {
  /** Asset Library record id — stamped on the tldraw asset as meta.sourceAssetId. */
  id: string;
  url: string;
  name: string;
  width: number | null;
  height: number | null;
}

const INSERT_CASCADE = 28;

function measureImage(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Places Asset Library images on the board at the viewport centre.
 *  - No file duplication: the URL stored is the library asset's own URL, and
 *    inserting the same library asset again reuses its existing tldraw asset
 *    record (matched by meta.sourceAssetId + src) instead of adding another.
 *  - Aspect ratio preserved; dimensions from the library record when known,
 *    otherwise measured, otherwise a safe default (SVG with no intrinsic size).
 *  - Repeated inserts cascade rather than stacking exactly on top of each other.
 *  - One undo step; the new shapes end up selected.
 */
export async function insertLibraryImages(editor: Editor, images: readonly LibraryImage[]): Promise<number> {
  if (images.length === 0) return 0;

  const sized = await Promise.all(images.map(async img => {
    const known = img.width && img.height ? { w: img.width, h: img.height } : await measureImage(img.url);
    return { img, size: fitInsertSize(known?.w ?? 0, known?.h ?? 0), natural: known };
  }));

  const view = editor.getViewportPageBounds();
  const occupied = [...editor.getCurrentPageShapeIds()]
    .map(id => editor.getShapePageBounds(id))
    .filter((b): b is Box => !!b);

  const existingAssets = new Map<string, string>(); // `${sourceAssetId}|${src}` → tldraw asset id
  for (const a of editor.getAssets()) {
    const src = a.type === 'image' ? a.props.src : null;
    const source = (a.meta as { sourceAssetId?: unknown } | undefined)?.sourceAssetId;
    if (src && typeof source === 'string') existingAssets.set(`${source}|${src}`, a.id);
  }

  const newAssets: ReturnType<typeof AssetRecordType.create>[] = [];
  const shapes: ShapeInput[] = [];
  const created: TLShapeId[] = [];
  const total = sized.reduce((n, s) => n + s.size.w, 0) + (sized.length - 1) * 24;

  let cursorX = view.x + view.w / 2 - total / 2;
  const centerY = view.y + view.h / 2;

  for (const { img, size, natural } of sized) {
    const key = `${img.id}|${img.url}`;
    let assetId = existingAssets.get(key) as ReturnType<typeof AssetRecordType.createId> | undefined;
    if (!assetId) {
      const uid = `lib_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      assetId = AssetRecordType.createId(uid);
      newAssets.push(AssetRecordType.create({
        id: assetId,
        type: 'image',
        props: { w: natural?.w ?? size.w, h: natural?.h ?? size.h, name: img.name, src: img.url, mimeType: null, isAnimated: false },
        meta: { sourceAssetId: img.id },
      }));
      existingAssets.set(key, assetId);
    }

    let x = cursorX;
    let y = centerY - size.h / 2;
    // Nudge diagonally while the spot is already taken by another shape's origin.
    for (let i = 0; i < 40 && occupied.some(o => Math.abs(o.x - x) < 8 && Math.abs(o.y - y) < 8); i++) {
      x += INSERT_CASCADE; y += INSERT_CASCADE;
    }
    occupied.push(new Box(x, y, size.w, size.h));
    cursorX += size.w + 24;

    const id = createShapeId();
    created.push(id);
    shapes.push({ id, type: 'image', x, y, props: { w: size.w, h: size.h, assetId, url: '' } });
  }

  editor.run(() => {
    if (newAssets.length) editor.createAssets(newAssets);
    editor.createShapes(shapes);
    editor.setSelectedShapes(created);
  });
  return created.length;
}

// ── Organization ──────────────────────────────────────────────────────────

/**
 * Top-level, unlocked shapes to arrange. `minSelected` is how many selected
 * items it takes for the selection (rather than the whole page) to be the
 * target: tidy uses 2 (one lone selected item, e.g. the image just inserted,
 * can't be "tidied", so it means the whole board); wrap-in-frame uses 1.
 */
function arrangeTargets(editor: Editor, minSelected: number): TLShapeId[] {
  const pageId = editor.getCurrentPageId();
  const selected = editor.getSelectedShapeIds();
  const pool = selected.length >= minSelected ? selected : [...editor.getCurrentPageShapeIds()];
  return pool.filter(id => {
    const s = editor.getShape(id);
    return !!s && s.parentId === pageId && !editor.isShapeOrAncestorLocked(s);
  });
}

export type ArrangeResult = { ok: true; count: number } | { ok: false; reason: string };

/** Re-flows the selection (2+ items) or else the whole page into a tidy grid, keeping every item's size and rotation. */
export function tidyIntoGrid(editor: Editor): ArrangeResult {
  const ids = arrangeTargets(editor, 2);
  if (ids.length < 2) return { ok: false, reason: 'Add two or more items to the page to tidy' };

  const boxes = ids.flatMap(id => {
    const b = editor.getShapePageBounds(id);
    return b ? [{ id: id as string, x: b.x, y: b.y, w: b.w, h: b.h }] : [];
  });
  const placements = planTidyGrid(boxes);
  const byId = new Map<string, (typeof boxes)[number]>(boxes.map(b => [b.id, b]));

  editor.mark('tidy into grid');
  editor.run(() => {
    editor.updateShapes(placements.flatMap(p => {
      const shape = editor.getShape(p.id as TLShapeId);
      const from = byId.get(p.id);
      if (!shape || !from) return [];
      // Move by delta so rotated shapes (whose x/y is the rotation pivot) land correctly.
      return [{ id: shape.id, type: shape.type, x: shape.x + (p.x - from.x), y: shape.y + (p.y - from.y) }];
    }));
  });
  return { ok: true, count: placements.length };
}

/** Wraps the selection in a labelled frame so it can be moved and exported as one block. */
export function wrapSelectionInFrame(editor: Editor, name = 'Group'): ArrangeResult {
  const selected = editor.getSelectedShapeIds();
  const ids = selected.length === 0 ? [] : arrangeTargets(editor, 1);
  if (ids.length === 0) return { ok: false, reason: 'Select the items you want to wrap in a frame' };

  const bounds = Box.Common(ids.flatMap(id => { const b = editor.getShapePageBounds(id); return b ? [b] : []; }));
  const pad = 32, titleRoom = 8;
  const frameId = createShapeId();
  editor.mark('wrap in frame');
  editor.run(() => {
    editor.createShape({
      id: frameId, type: 'frame',
      x: bounds.x - pad, y: bounds.y - pad - titleRoom,
      props: { w: bounds.w + pad * 2, h: bounds.h + pad * 2 + titleRoom, name },
    });
    // reparentShapes preserves each shape's position on the page.
    editor.reparentShapes(ids, frameId);
    editor.setSelectedShapes([frameId]);
  });
  return { ok: true, count: ids.length };
}

// ── Image viewing ─────────────────────────────────────────────────────────

/**
 * Every image on the current page, in reading order, for the lightbox. Uses the same
 * page-space bounds the canvas shows (so frames and nesting don't matter) and drops any
 * image whose asset has no usable source.
 */
export function collectBoardImages(editor: Editor): LightboxImage[] {
  const shapes: BoardImageShape[] = [];
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== 'image') continue;
    const props = shape.props as { assetId?: string | null };
    const asset = props.assetId ? editor.getAsset(props.assetId as never) : undefined;
    const src = (asset?.props as { src?: string | null } | undefined)?.src;
    const b = editor.getShapePageBounds(shape.id);
    if (!b) continue;
    const name = (asset?.props as { name?: string } | undefined)?.name;
    shapes.push({ id: shape.id, x: b.x, y: b.y, w: b.w, h: b.h, src, label: name || undefined });
  }
  return readingOrder(shapes);
}

// ── Export ────────────────────────────────────────────────────────────────

export type ExportFormat = 'png' | 'jpeg' | 'svg';
export type ExportScope = 'board' | 'selection';

export interface ExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  scale: number;
  /** false → transparent background (PNG/SVG only; JPEG is always opaque). */
  background: boolean;
  boardName: string;
}

export interface ExportTarget { ids: TLShapeId[]; width: number; height: number; scope: ExportScope }

/** What an export would cover right now (null when the board is empty). */
export function describeExportTarget(editor: Editor, scope: ExportScope): ExportTarget | null {
  const selected = editor.getSelectedShapeIds();
  const useSelection = scope === 'selection' && selected.length > 0;
  const ids = useSelection ? selected : [...editor.getCurrentPageShapeIds()];
  if (ids.length === 0) return null;
  const boxes = ids.flatMap(id => { const b = editor.getShapePageBounds(id); return b ? [b] : []; });
  if (boxes.length === 0) return null;
  const b = Box.Common(boxes);
  return { ids, width: b.w, height: b.h, scope: useSelection ? 'selection' : 'board' };
}

const EXPORT_PADDING = 32;

export function planBoardExport(target: ExportTarget, scale: number): ExportPlan {
  return planExport(target.width, target.height, scale, EXPORT_PADDING);
}

/**
 * A small PNG of what an export would contain RIGHT NOW (same scope, same
 * SVG→bitmap path, same light theme and background rules as the real export),
 * for the dialog's preview. Returns null for an empty board. Never downloads.
 */
export async function renderBoardPreview(
  editor: Editor,
  opts: Pick<ExportOptions, 'scope' | 'background' | 'format'>,
  maxEdge = 420,
): Promise<Blob | null> {
  const target = describeExportTarget(editor, opts.scope);
  if (!target) return null;
  const svg = await editor.getSvgString(target.ids, {
    scale: 1, background: opts.format === 'jpeg' ? true : opts.background, padding: EXPORT_PADDING, darkMode: false,
  });
  if (!svg) return null;
  return getSvgAsImage(editor, svg.svg, { type: 'png', quality: 0.8, scale: previewScale(target.width, target.height, EXPORT_PADDING, maxEdge), width: svg.width, height: svg.height });
}

/**
 * Renders the board (or selection) with tldraw's own exporter, at a scale
 * reduced if needed to stay inside browser canvas limits, and downloads it.
 * Always rendered in the light theme so a file looks the same regardless of
 * the viewer's UI theme. Throws on failure; the caller reports it.
 */
export async function exportBoardImage(editor: Editor, opts: ExportOptions): Promise<{ plan: ExportPlan; fileName: string }> {
  const target = describeExportTarget(editor, opts.scope);
  if (!target) throw new Error('Nothing to export');
  const plan = planBoardExport(target, opts.scale);
  if (!plan.ok) throw new Error('Nothing to export');

  const svgOpts = {
    scale: 1,
    background: opts.format === 'jpeg' ? true : opts.background,
    padding: EXPORT_PADDING,
    darkMode: false,
  };
  let blob: Blob | null;
  if (opts.format === 'svg') {
    blob = await exportToBlob({ editor, ids: target.ids, format: 'svg', opts: svgOpts });
  } else {
    // tldraw's exportToBlob hardcodes a 2× bitmap multiplier and ignores the
    // requested scale for raster output, so the planned scale would silently
    // be doubled. Render the SVG at 1× and rasterise it ourselves at exactly
    // the planned scale (getSvgAsImage also clamps to the browser's real
    // maximum canvas size as a last line of defence).
    const svg = await editor.getSvgString(target.ids, svgOpts);
    if (!svg) throw new Error('Could not construct image');
    blob = await getSvgAsImage(editor, svg.svg, {
      type: opts.format, quality: 0.92, scale: plan.scale, width: svg.width, height: svg.height,
    });
  }
  if (!blob || blob.size === 0) throw new Error('Export produced an empty file');

  const fileName = exportFileName(opts.boardName, opts.format === 'jpeg' ? 'jpg' : opts.format);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return { plan, fileName };
}

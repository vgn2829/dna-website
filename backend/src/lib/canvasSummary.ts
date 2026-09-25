// ─────────────────────────────────────────────────────────────────────────
// Board canvas summary — the item count and card preview shown on
// /moodboards, derived from a board's persisted tldraw snapshot at WRITE
// time (every path that sets boards.canvas_data calls canvasSummaryColumns)
// so list endpoints never have to ship or parse full canvas documents.
//
// Accepts every snapshot shape this repository persists (see
// realtime/roomPersistence.ts for the history):
//   - RoomSnapshot     { clock, documents: [{ state: record }], tombstones }
//                      (realtime path; deleted records live only in
//                      tombstones, never in documents)
//   - TLEditorSnapshot { document: { store: { id: record } }, session }
//                      (manual TldrawCanvas save path)
//   - TLStoreSnapshot  { store: { id: record }, schema }
// Anything else (e.g. '{}') summarizes as an empty board.
//
// "Items" are user-visible shapes: records with typeName 'shape', on any
// page, excluding 'group' (a group is a container of other shapes, not
// content of its own). Pages, the document record, assets, bindings,
// camera/instance/pointer/presence records are never counted.
//
// The preview is a small list of drawing primitives in page coordinates
// for the page with the most content — rendered by the frontend's
// BoardPreview as an SVG. It never embeds image bytes: images reference
// their existing http(s) asset URL (data: URIs from legacy boards render
// as a placeholder box instead of bloating the row).
// ─────────────────────────────────────────────────────────────────────────

type Rec = { typeName?: string; id?: string; type?: string; x?: number; y?: number; rotation?: number; parentId?: string; index?: string; props?: Record<string, unknown> };

export type PreviewItem = {
  // geo | frame | image | note | text | path | box
  k: 'geo' | 'frame' | 'image' | 'note' | 'text' | 'path' | 'box';
  x: number; y: number; r: number; w: number; h: number;
  c?: string;          // tldraw color name
  g?: string;          // geo kind (rectangle, ellipse, ...)
  f?: string;          // fill style (none | semi | solid | pattern)
  src?: string;        // image URL (http/https only)
  t?: string;          // text (truncated)
  fs?: number;         // font size for text
  p?: number[];        // path points, flattened [x0,y0,x1,y1,...], local to (x,y)
  hl?: boolean;        // highlighter stroke
  sw?: number;         // stroke width
};

export interface CanvasPreview {
  v: 1;
  x: number; y: number; w: number; h: number;  // page-space bounds of `items`
  items: PreviewItem[];
}

export interface CanvasSummary {
  count: number;
  // Shape ids that materialized a legacy board_items row ("Save to
  // Moodboard" from the Gallery): tldraw places each such item as
  // `shape:<board_items.id>` (tldrawCanvasShared.ts injectPendingBoardItems).
  // Stored so list queries can count only NOT-yet-placed board_items on
  // top of `count`, never double-counting a placed one.
  placedItemIds: string[];
  preview: CanvasPreview | null;
}

const MAX_ITEMS = 80;
const MAX_PATH_POINTS = 40;
const MAX_TEXT = 80;
const FONT_SIZE: Record<string, number> = { s: 18, m: 24, l: 36, xl: 44 };
const STROKE: Record<string, number> = { s: 2, m: 3.5, l: 5, xl: 10 };
const UUID_SHAPE_ID = /^shape:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractRecords(snapshot: unknown): Rec[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const s = snapshot as Record<string, unknown>;
  if (Array.isArray(s.documents)) {
    return (s.documents as Array<{ state?: Rec }>).map(d => d?.state).filter((r): r is Rec => !!r && typeof r === 'object');
  }
  const store = (s.document && typeof s.document === 'object' ? (s.document as Record<string, unknown>).store : undefined) ?? s.store;
  if (store && typeof store === 'object') {
    return Object.values(store as Record<string, Rec>).filter(r => !!r && typeof r === 'object');
  }
  return [];
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const round = (n: number): number => Math.round(n * 10) / 10;

// 2D affine transform [a, b, c, d, e, f] — maps (x, y) to (a x + c y + e, b x + d y + f).
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
function compose(m: Mat, x: number, y: number, rot: number): Mat {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const [a, b, c, d, e, f] = m;
  return [a * cos + c * sin, b * cos + d * sin, -a * sin + c * cos, -b * sin + d * cos, a * x + c * y + e, b * x + d * y + f];
}
const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function downsample(points: Array<{ x?: unknown; y?: unknown }>): number[] {
  const valid = points.filter(p => p && typeof p === 'object');
  const step = Math.max(1, Math.ceil(valid.length / MAX_PATH_POINTS));
  const out: number[] = [];
  for (let i = 0; i < valid.length; i += step) out.push(round(num(valid[i].x)), round(num(valid[i].y)));
  const last = valid[valid.length - 1];
  if (last && (valid.length - 1) % step !== 0) out.push(round(num(last.x)), round(num(last.y)));
  return out;
}

// Local (shape-space) primitive for one shape, or null if it has no
// drawable geometry (it may still count as an item).
function localPrimitive(s: Rec, assets: Map<string, Rec>): Omit<PreviewItem, 'x' | 'y' | 'r'> | null {
  const p = s.props ?? {};
  const scale = num(p.scale, 1);
  const color = typeof p.color === 'string' ? p.color : undefined;
  const text = typeof p.text === 'string' && p.text.trim() ? p.text.trim().slice(0, MAX_TEXT) : undefined;
  switch (s.type) {
    case 'geo':
      return { k: 'geo', w: num(p.w, 100), h: num(p.h, 100) + num(p.growY), c: color, g: typeof p.geo === 'string' ? p.geo : 'rectangle', f: typeof p.fill === 'string' ? p.fill : 'none', t: text };
    case 'frame':
      return { k: 'frame', w: num(p.w, 100), h: num(p.h, 100), t: typeof p.name === 'string' ? p.name.slice(0, MAX_TEXT) : undefined };
    case 'image':
    case 'video': {
      const asset = typeof p.assetId === 'string' ? assets.get(p.assetId) : undefined;
      const src = asset?.props && typeof asset.props.src === 'string' ? asset.props.src : undefined;
      return { k: 'image', w: num(p.w, 100), h: num(p.h, 100), src: src && /^https?:\/\//i.test(src) && src.length <= 2048 ? src : undefined };
    }
    case 'note':
      return { k: 'note', w: 200 * scale, h: 200 * scale + num(p.growY), c: color, t: text };
    case 'text': {
      const fs = (FONT_SIZE[String(p.size)] ?? 24) * scale;
      const lines = Math.max(1, (typeof p.text === 'string' ? p.text : '').split('\n').length);
      return { k: 'text', w: num(p.w, 100), h: lines * fs * 1.35, c: color, t: text, fs: round(fs) };
    }
    case 'draw':
    case 'highlight': {
      const segments = Array.isArray(p.segments) ? (p.segments as Array<{ points?: Array<{ x?: unknown; y?: unknown }> }>) : [];
      const pts = downsample(segments.flatMap(seg => (Array.isArray(seg?.points) ? seg.points : [])));
      return pts.length >= 2 ? { k: 'path', w: 0, h: 0, p: pts, c: color, hl: s.type === 'highlight', sw: (STROKE[String(p.size)] ?? 3.5) * scale * (s.type === 'highlight' ? 4 : 1) } : null;
    }
    case 'line': {
      const raw = p.points && typeof p.points === 'object' ? Object.values(p.points as Record<string, { x?: unknown; y?: unknown; index?: string }>) : [];
      raw.sort((a, b) => String(a?.index ?? '').localeCompare(String(b?.index ?? '')));
      const pts = downsample(raw);
      return pts.length >= 2 ? { k: 'path', w: 0, h: 0, p: pts, c: color, sw: STROKE[String(p.size)] ?? 3.5 } : null;
    }
    case 'arrow': {
      const a = p.start as { x?: unknown; y?: unknown } | undefined;
      const b = p.end as { x?: unknown; y?: unknown } | undefined;
      if (!a || !b) return null;
      return { k: 'path', w: 0, h: 0, p: [round(num(a.x)), round(num(a.y)), round(num(b.x)), round(num(b.y))], c: color, sw: STROKE[String(p.size)] ?? 3.5 };
    }
    default:
      if (typeof p.w === 'number' && typeof p.h === 'number') return { k: 'box', w: p.w, h: p.h };
      return null;
  }
}

export function summarizeCanvas(snapshot: unknown): CanvasSummary {
  const records = extractRecords(snapshot);
  const shapes = new Map<string, Rec>();
  const assets = new Map<string, Rec>();
  const pages: Rec[] = [];
  for (const r of records) {
    if (r.typeName === 'shape' && typeof r.id === 'string') shapes.set(r.id, r);
    else if (r.typeName === 'asset' && typeof r.id === 'string') assets.set(r.id, r);
    else if (r.typeName === 'page') pages.push(r);
  }

  const content = [...shapes.values()].filter(s => s.type !== 'group');
  const placedItemIds = [...shapes.keys()].filter(id => UUID_SHAPE_ID.test(id));
  if (content.length === 0) return { count: 0, placedItemIds, preview: null };

  // Page of each shape (walk up through parent shapes) and its transform.
  const pageOf = new Map<string, string>();
  const matOf = new Map<string, Mat>();
  const orderOf = new Map<string, string[]>();
  const resolve = (s: Rec, depth = 0): void => {
    const id = s.id!;
    if (matOf.has(id) || depth > 50) return;
    const parent = typeof s.parentId === 'string' ? shapes.get(s.parentId) : undefined;
    let base = IDENTITY;
    let order: string[] = [];
    let page = typeof s.parentId === 'string' ? s.parentId : '';
    if (parent) {
      resolve(parent, depth + 1);
      base = matOf.get(parent.id!) ?? IDENTITY;
      order = orderOf.get(parent.id!) ?? [];
      page = pageOf.get(parent.id!) ?? '';
    }
    matOf.set(id, compose(base, num(s.x), num(s.y), num(s.rotation)));
    orderOf.set(id, [...order, String(s.index ?? '')]);
    pageOf.set(id, page);
  };
  for (const s of shapes.values()) resolve(s);

  // Preview the page with the most content (ties: the first page).
  const perPage = new Map<string, number>();
  for (const s of content) perPage.set(pageOf.get(s.id!) ?? '', (perPage.get(pageOf.get(s.id!) ?? '') ?? 0) + 1);
  const pageOrder = pages.slice().sort((a, b) => String(a.index ?? '').localeCompare(String(b.index ?? ''))).map(p => p.id);
  const previewPage = [...perPage.entries()].sort((a, b) => b[1] - a[1] || pageOrder.indexOf(a[0]) - pageOrder.indexOf(b[0]))[0][0];

  const cmpOrder = (a: string[], b: string[]): number => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return a.length - b.length;
  };

  let items: Array<PreviewItem & { area: number; order: string[] }> = [];
  for (const s of content) {
    if (pageOf.get(s.id!) !== previewPage) continue;
    const prim = localPrimitive(s, assets);
    if (!prim) continue;
    const m = matOf.get(s.id!)!;
    const [x, y] = apply(m, 0, 0);
    const r = Math.atan2(m[1], m[0]);
    const area = prim.k === 'path' ? 1 : Math.abs(prim.w * prim.h);
    items.push({ ...prim, x: round(x), y: round(y), r: Math.abs(r) < 1e-6 ? 0 : round(r * 1000) / 1000, w: round(prim.w), h: round(prim.h), area, order: orderOf.get(s.id!)! });
  }
  if (items.length > MAX_ITEMS) items = items.sort((a, b) => b.area - a.area).slice(0, MAX_ITEMS);
  items.sort((a, b) => cmpOrder(a.order, b.order));

  // Bounds in page space (rotated boxes / path points).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const extend = (px: number, py: number) => { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); };
  for (const it of items) {
    const cos = Math.cos(it.r), sin = Math.sin(it.r);
    const local: Array<[number, number]> = it.p
      ? Array.from({ length: it.p.length / 2 }, (_, i) => [it.p![2 * i], it.p![2 * i + 1]] as [number, number])
      : [[0, 0], [it.w, 0], [0, it.h], [it.w, it.h]];
    for (const [lx, ly] of local) extend(it.x + lx * cos - ly * sin, it.y + lx * sin + ly * cos);
  }

  const cleaned: PreviewItem[] = items.map(({ area: _a, order: _o, ...rest }) => {
    const out: PreviewItem = { ...rest };
    for (const key of Object.keys(out) as Array<keyof PreviewItem>) if (out[key] === undefined) delete out[key];
    return out;
  });

  const preview: CanvasPreview | null = cleaned.length && Number.isFinite(minX)
    ? { v: 1, x: round(minX), y: round(minY), w: round(Math.max(1, maxX - minX)), h: round(Math.max(1, maxY - minY)), items: cleaned }
    : null;
  return { count: content.length, placedItemIds, preview };
}

// The three boards columns every canvas_data write keeps in sync.
// Accepts the raw JSON string (manual save, copies) or an already-parsed
// snapshot (realtime save). Unparseable input summarizes as empty.
export function canvasSummaryColumns(canvasData: string | object | null | undefined): {
  canvas_item_count: number;
  canvas_preview: string | null;
  canvas_placed_item_ids: string[];
} {
  let parsed: unknown = canvasData;
  if (typeof canvasData === 'string') {
    try { parsed = JSON.parse(canvasData); } catch { parsed = null; }
  }
  const summary = summarizeCanvas(parsed);
  return {
    canvas_item_count: summary.count,
    canvas_preview: summary.preview ? JSON.stringify(summary.preview) : null,
    canvas_placed_item_ids: summary.placedItemIds,
  };
}

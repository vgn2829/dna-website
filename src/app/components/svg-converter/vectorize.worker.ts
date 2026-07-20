/// <reference lib="webworker" />
// Vectorization Web Worker — runs vtracer-wasm off the main thread.
//
// Single-threaded WASM (verified: no SharedArrayBuffer/atomics/rayon in the
// binary): no COOP/COEP / cross-origin isolation required. vtracer-wasm and
// its .wasm live in this worker's own chunk, fetched only when the worker
// spins up (first "Vectorize" click).

import init, { to_svg } from 'vtracer-wasm';
// vtracer-wasm@0.1.0's default init() requests "vtracer_bg.wasm" relative to
// its own module URL, but the package only ships "vtracer.wasm" — a filename
// mismatch in the published glue (verified against the installed package).
// Passing the real asset URL explicitly works around it.
import wasmUrl from 'vtracer-wasm/vtracer.wasm?url';
import type { WorkerRequest, VectorizeResult, VectorizeError } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let ready: Promise<void> | null = null;

function rgbaToHex(rgba: Uint8Array, width: number, x: number, y: number): string {
  const i = (y * width + x) * 4;
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(rgba[i])}${toHex(rgba[i + 1])}${toHex(rgba[i + 2])}`;
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type !== 'vectorize') return;
  try {
    if (!ready) ready = init({ module_or_path: wasmUrl }).then(() => undefined);
    await ready;

    const pixels = new Uint8Array(msg.rgba);
    const raw = to_svg(pixels, msg.width, msg.height, msg.config);

    // to_svg() emits width/height but no viewBox (verified against the
    // installed package's output). Without one, the SVG has no coordinate-
    // to-viewport mapping, so CSS-driven scaling in the preview panel can't
    // rescale the internal geometry — the result renders zoomed/clipped to a
    // fraction of the traced image. Inject a viewBox matching the declared
    // pixel dimensions so it scales correctly wherever it's embedded.
    //
    // Curve-fit paths (spline mode, permissive cornerThreshold) can legitimately
    // extend beyond the source image bounds — Bezier control points overshoot
    // to stay smooth around the frame's own corners (verified: Photo preset
    // overshoots on every tested image; pixel mode never does, since its
    // boundary is pixel-accurate and can't exceed the canvas). A bare viewBox
    // only clips implicitly in non-root SVG contexts (the in-app preview); a
    // standalone downloaded file or an editor like Illustrator/Inkscape renders
    // root-level SVGs without that implicit clip and shows the raw overshoot.
    // An explicit clipPath is honored in every context, so add one unconditionally.
    const withViewBox = raw.replace(
      /<svg([^>]*)\swidth="(\d+)"([^>]*)\sheight="(\d+)"([^>]*)>/,
      (_m, a, w, b, h, c) => `<svg${a} width="${w}"${b} height="${h}"${c} viewBox="0 0 ${w} ${h}">`,
    );

    // Spline curve-fitting doesn't route through the canvas's true corners —
    // it smooths a diagonal chord across each one instead (verified: for a
    // background/frame-covering shape, the fitted curve crosses two adjacent
    // edges 150-275px from the corner rather than meeting at the corner
    // itself, on all four corners). The clipPath above correctly removes the
    // shape's out-of-bounds overshoot, but that also removes the only
    // coverage those corner wedges had — before clipping, the overshoot
    // geometry happened to still paint over them; after, they're uncovered.
    // A small square in each corner's own sampled pixel color, placed under
    // every traced path, guarantees real coverage there regardless of
    // preset/mode. Sampling actual source pixels (rather than assuming the
    // first path is a uniform background) stays correct even if the four
    // corners differ in color, and for presets whose first path isn't a
    // background layer at all (e.g. Line Art's binary mode).
    const cw = Math.min(300, msg.width);
    const ch = Math.min(300, msg.height);
    const corners = [
      { x: 0, y: 0, sx: 0, sy: 0 },
      { x: msg.width - cw, y: 0, sx: msg.width - 1, sy: 0 },
      { x: 0, y: msg.height - ch, sx: 0, sy: msg.height - 1 },
      { x: msg.width - cw, y: msg.height - ch, sx: msg.width - 1, sy: msg.height - 1 },
    ];
    const cornerRects = corners
      .map(c => `<rect x="${c.x}" y="${c.y}" width="${cw}" height="${ch}" fill="${rgbaToHex(pixels, msg.width, c.sx, c.sy)}"/>`)
      .join('');

    const svg = withViewBox.replace(
      /(<svg[^>]*>)([\s\S]*)(<\/svg>)/,
      (_m, open, body, close) =>
        `${open}<defs><clipPath id="vt-bounds"><rect x="0" y="0" width="${msg.width}" height="${msg.height}"/></clipPath></defs>` +
        `<g clip-path="url(#vt-bounds)">${cornerRects}${body}</g>${close}`,
    );

    const res: VectorizeResult = { type: 'result', id: msg.id, svg };
    ctx.postMessage(res);
  } catch (err) {
    const res: VectorizeError = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : 'Vectorize failed',
    };
    ctx.postMessage(res);
  }
};

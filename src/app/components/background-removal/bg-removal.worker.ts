/// <reference lib="webworker" />
// Background-removal Web Worker.
//
// PHASE 1 SCAFFOLD — this worker does NOT run an AI model yet. It returns a
// deterministic, non-AI PLACEHOLDER mask (a soft centred ellipse) so the whole
// pipeline — image transfer, off-main-thread work, mask compositing, and PNG
// export — is wired and verifiable end-to-end before any model exists.
//
// PHASE 2 will replace computePlaceholderMask() with ONNX Runtime Web + a
// segmentation model. The message protocol (SegmentRequest -> SegmentResult)
// is intentionally model-agnostic and will not change.

import type { WorkerRequest, SegmentResult, SegmentError } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type !== 'segment') return;
  try {
    const mask = computePlaceholderMask(msg.width, msg.height);
    const res: SegmentResult = { type: 'result', id: msg.id, mask: mask.buffer };
    ctx.postMessage(res, [mask.buffer]);
  } catch (err) {
    const res: SegmentError = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : 'Worker failed',
    };
    ctx.postMessage(res);
  }
};

/**
 * Deterministic stand-in mask: a soft-edged centred ellipse (~70% of the frame).
 * This is NOT segmentation — it exists purely to exercise the compositing
 * pipeline in Phase 1, and is replaced by the real model in Phase 2.
 */
function computePlaceholderMask(width: number, height: number): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  const cx = width / 2;
  const cy = height / 2;
  const rx = width * 0.35;
  const ry = height * 0.45;
  const feather = 0.12; // fraction of the radius over which alpha ramps 255 -> 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = Math.sqrt(nx * nx + ny * ny); // 0 at centre, 1 at ellipse edge
      let a: number;
      if (d <= 1 - feather) a = 255;
      else if (d >= 1) a = 0;
      else a = Math.round(255 * (1 - (d - (1 - feather)) / feather));
      mask[y * width + x] = a;
    }
  }
  return mask;
}

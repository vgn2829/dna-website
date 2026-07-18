// Shared types for the Background Removal feature.
// Deliberately minimal — only what the current tool needs. No speculative types
// for unbuilt future features (object removal, upscaling, inpainting).

/** Lifecycle of a background-removal run. */
export type RemovalStatus = 'idle' | 'processing' | 'done' | 'error';

/** Backdrop composited behind the cut-out subject (display + export). */
export type Backdrop =
  | { kind: 'transparent' }
  | { kind: 'color'; color: string };

/** A decoded source image plus its dimensions, ready for compositing. */
export interface SourceImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Original file name without extension — used for the download filename. */
  name: string;
}

// ── Worker message protocol ──────────────────────────────────────────────────
// The worker receives raw RGBA pixels and returns a single-channel alpha mask
// (0 = background, 255 = foreground). Phase 1 produces the mask with a non-AI
// placeholder; Phase 2 swaps the mask source for an ONNX segmentation model
// WITHOUT changing this protocol.

export interface SegmentRequest {
  type: 'segment';
  id: number;
  width: number;
  height: number;
  /** RGBA pixel buffer, transferred to the worker. */
  rgba: ArrayBuffer;
}

export interface SegmentResult {
  type: 'result';
  id: number;
  /** One alpha byte per pixel (width * height), transferred back. */
  mask: ArrayBuffer;
}

export interface SegmentError {
  type: 'error';
  id: number;
  message: string;
}

export type WorkerRequest = SegmentRequest;
export type WorkerResponse = SegmentResult | SegmentError;

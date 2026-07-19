// Shared types for the Background Removal feature.
// Deliberately minimal — only what the current tool needs. No speculative types
// for unbuilt future features (object removal, upscaling, inpainting).

/** Lifecycle of a background-removal run. */
export type RemovalStatus = 'idle' | 'processing' | 'done' | 'error';

/** Which segmentation model to run. */
export type ModelId = 'general' | 'portrait';

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
  /** True if the image was downscaled to the working-resolution cap on load. */
  downscaled: boolean;
}

// ── Worker message protocol ──────────────────────────────────────────────────
// The worker receives raw RGBA pixels and runs an ONNX segmentation model,
// returning a single-channel alpha mask (0 = background, 255 = foreground).
// The protocol is model-agnostic — `model` selects which network runs.

export interface SegmentRequest {
  type: 'segment';
  id: number;
  model: ModelId;
  width: number;
  height: number;
  /** RGBA pixel buffer, transferred to the worker. */
  rgba: ArrayBuffer;
}

/** Progress ticks so the UI can show download / init / inference phases. */
export interface SegmentProgress {
  type: 'progress';
  id: number;
  phase: 'download' | 'init' | 'infer';
  /** 0–100 for downloads with a known length; omitted when indeterminate. */
  pct?: number;
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
export type WorkerResponse = SegmentProgress | SegmentResult | SegmentError;

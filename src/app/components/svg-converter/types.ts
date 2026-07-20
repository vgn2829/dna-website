// Shared types for the VTracer-backed vectorization path in SvgConverter.
// Deliberately minimal — only what the current tool needs.

/** Lifecycle of a vectorize run. */
export type VectorizeStatus = 'idle' | 'processing' | 'done' | 'error';

/**
 * Config surface accepted by vtracer-wasm's `to_svg(pixels, width, height, config)`.
 * The package ships this as an untyped `config_js: any` with no shipped TS type and
 * no `Default` impl — every field must be supplied by the caller. Field names and
 * casing (camelCase) mirror jsscheller/vtracer-wasm's Rust-side `Config` struct
 * (`#[serde(rename_all = "camelCase")]`, src/lib.rs).
 */
export interface TracerConfig {
  /** true = black/white binary tracing, false = color tracing. */
  binary: boolean;
  /** Curve-fitting mode. 'pixel' is an alias for "no curve fitting" (PathSimplifyMode::None). */
  mode: 'spline' | 'polygon' | 'pixel';
  hierarchical: 'stacked' | 'cutout';
  /** Degrees; corners sharper than this are treated as hard corners. */
  cornerThreshold: number;
  /** Minimum segment length. */
  lengthThreshold: number;
  /** Degrees; controls when adjacent segments are spliced into one curve. */
  spliceThreshold: number;
  maxIterations: number;
  /** Speckle/noise filter — regions smaller than this (in pixels) are dropped. */
  filterSpeckle: number;
  /**
   * 0–7 (NOT the CLI's 1–8 "precision" scale — this binding passes the value
   * straight into visioncortex's `is_same_color_a`, which asserts `< 8` with
   * no conversion; see presets.ts for the CLI-value-to-this-field mapping,
   * confirmed by a runtime panic when testing colorPrecision:8 directly).
   * Lower = more sensitive to color difference (more clusters/detail).
   */
  colorPrecision: number;
  /** Minimum color difference between adjacent layers (gradient step). */
  layerDifference: number;
  /** Decimal places retained in output path coordinates. */
  pathPrecision: number;
}

// ── Worker message protocol ──────────────────────────────────────────────────
// The worker receives raw RGBA pixels + a TracerConfig and runs vtracer-wasm's
// to_svg(), returning the resulting SVG markup as a string.

export interface VectorizeRequest {
  type: 'vectorize';
  id: number;
  width: number;
  height: number;
  /** RGBA pixel buffer, transferred to the worker. */
  rgba: ArrayBuffer;
  config: TracerConfig;
}

export interface VectorizeResult {
  type: 'result';
  id: number;
  svg: string;
}

export interface VectorizeError {
  type: 'error';
  id: number;
  message: string;
}

export type WorkerRequest = VectorizeRequest;
export type WorkerResponse = VectorizeResult | VectorizeError;

import type { TracerConfig } from './types';

// Preset config bundles for Vector Trace. Sourcing varies by preset — see each
// comment. vtracer-wasm ships no presets and no Default impl (every field must
// be supplied), so these mirror upstream visioncortex/vtracer's own Config
// values where such a value exists.
//
// IMPORTANT — colorPrecision unit mismatch (found via runtime testing, not
// docs): the CLI's Config::into_converter_config() converts its 1–8
// "precision" field via `color_precision_loss = 8 - color_precision` before
// it reaches the core library. jsscheller/vtracer-wasm's to_svg() (src/lib.rs)
// skips this conversion and passes `colorPrecision` straight through to
// visioncortex's `RunnerConfig.is_same_color_a`, which asserts `< 8`. Passing
// the CLI's own colorPrecision:8 (Preset::Photo) therefore panics inside the
// WASM (`assert!(is_same_color_a < 8)` in visioncortex's runner.rs) — verified
// by running to_svg() directly. Every colorPrecision value below is therefore
// the CLI's documented value ALREADY CONVERTED (8 - cliValue), so it's valid
// for this binding while still tracing back to the same upstream precision.

/**
 * Based on `Preset::Photo` from visioncortex/vtracer, cmdapp/src/config.rs
 * (lines 138–150 as of the vtracer master branch). Every field is vtracer's
 * own documented photo-preset value; colorPrecision is converted per the note
 * above (CLI value 8 → 8-8=0) to avoid the wasm binding's assertion panic.
 */
export const PHOTO: TracerConfig = {
  binary: false,
  mode: 'spline',
  hierarchical: 'stacked',
  filterSpeckle: 10,
  colorPrecision: 0, // CLI Preset::Photo value 8, converted (8 - 8)
  layerDifference: 48,
  cornerThreshold: 180,
  lengthThreshold: 4.0,
  spliceThreshold: 45,
  maxIterations: 10,
  pathPrecision: 2,
};

/**
 * "Line Art" is NOT an official vtracer preset — vtracer ships no preset by
 * this name. The `binary: true` value below is vtracer's real `Preset::Bw`
 * (binary color mode); every other field in `Preset::Bw` equals
 * `Config::default()` (cmdapp/src/config.rs lines 55–68 and 112–124). The
 * tighter `filterSpeckle`/`cornerThreshold` here are OUR OWN tuning for
 * crisper line output, not vtracer-documented values — flagged explicitly so
 * this isn't mistaken for an upstream preset. colorPrecision is converted per
 * the note above (CLI default 6 → 8-6=2).
 */
export const LINE_ART: TracerConfig = {
  binary: true, // = Preset::Bw's color_mode: Binary
  mode: 'spline', // Config::default()
  hierarchical: 'stacked', // Config::default()
  filterSpeckle: 2, // our tuning (default/Bw: 4) — drop less, keep thin strokes
  colorPrecision: 2, // Config::default() value 6, converted (8 - 6)
  layerDifference: 16, // Config::default()
  cornerThreshold: 40, // our tuning (default/Bw: 60) — crisper corners
  lengthThreshold: 4.0, // Config::default()
  spliceThreshold: 45, // Config::default()
  maxIterations: 10, // Config::default()
  pathPrecision: 2, // Config::default()
};

/**
 * "Pixel Art" is NOT an official vtracer preset, and vtracer has no `Pixel`
 * enum variant at all — `mode: 'pixel'` is purely a CLI/wasm alias for "no
 * curve fitting" (PathSimplifyMode::None). It carries no associated
 * parameter bundle upstream. Every field besides `mode` here is plain
 * `Config::default()` (cmdapp/src/config.rs lines 55–68) — there is no
 * upstream pixel-art tuning to cite. colorPrecision is converted per the note
 * above (CLI default 6 → 8-6=2).
 */
export const PIXEL_ART: TracerConfig = {
  binary: false,
  mode: 'pixel', // alias for PathSimplifyMode::None — no curve fitting
  hierarchical: 'stacked',
  filterSpeckle: 4,
  colorPrecision: 2, // Config::default() value 6, converted (8 - 6)
  layerDifference: 16,
  cornerThreshold: 60,
  lengthThreshold: 4.0,
  spliceThreshold: 45,
  maxIterations: 10,
  pathPrecision: 2,
};

export const PRESETS = {
  photo: PHOTO,
  lineArt: LINE_ART,
  pixelArt: PIXEL_ART,
} as const;

export type PresetId = keyof typeof PRESETS;

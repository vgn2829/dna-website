// Pure pre/post-processing for segmentation. No ORT, no React — just pixel math
// and OffscreenCanvas resizing (available inside the worker).

import type { ModelConfig } from './models';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** High-quality resize of an RGBA buffer via OffscreenCanvas. */
function resizeRGBA(rgba: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const src = new OffscreenCanvas(sw, sh);
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), sw, sh), 0, 0);
  const dst = new OffscreenCanvas(dw, dh);
  const dctx = dst.getContext('2d')!;
  dctx.drawImage(src, 0, 0, dw, dh);
  return dctx.getImageData(0, 0, dw, dh).data;
}

/** Resize a single-channel mask by packing it into RGBA, scaling, unpacking. */
function resizeMask(mask: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < mask.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = mask[i];
    rgba[i * 4 + 3] = 255;
  }
  const resized = resizeRGBA(rgba, sw, sh, dw, dh);
  const out = new Uint8ClampedArray(dw * dh);
  for (let i = 0; i < out.length; i++) out[i] = resized[i * 4];
  return out;
}

/** MODNet's dynamic export accepts multiples of 32. Preserve aspect ratio, bound work to 1024px. */
export function modelInputDimensions(srcW: number, srcH: number, cfg: ModelConfig) {
  if (cfg.id !== 'portrait') return { width: cfg.inputSize, height: cfg.inputSize };
  let scale = Math.max(srcW, srcH) < 512 || Math.min(srcW, srcH) > 512 ? 512 / Math.min(srcW, srcH) : 1;
  scale = Math.min(scale, 1024 / Math.max(srcW, srcH));
  return { width: Math.max(32, Math.floor(srcW * scale / 32) * 32), height: Math.max(32, Math.floor(srcH * scale / 32) * 32) };
}

/** Resize source RGBA to validated model dimensions and produce an NCHW float32 input tensor. */
export function toInputTensor(rgba: Uint8ClampedArray, srcW: number, srcH: number, cfg: ModelConfig): Float32Array {
  const dimensions = modelInputDimensions(srcW, srcH, cfg);
  const px = resizeRGBA(rgba, srcW, srcH, dimensions.width, dimensions.height);
  const plane = dimensions.width * dimensions.height;
  const out = new Float32Array(3 * plane);
  let divisor = cfg.scaleDiv;
  if (cfg.id === 'general') {
    // Match rembg/U2NETP: normalize RGB by the resized image maximum, excluding alpha.
    divisor = 1;
    for (let i = 0; i < px.length; i += 4) divisor = Math.max(divisor, px[i], px[i + 1], px[i + 2]);
  }
  for (let i = 0; i < plane; i++) {
    const r = px[i * 4] / divisor;
    const g = px[i * 4 + 1] / divisor;
    const b = px[i * 4 + 2] / divisor;
    out[i] = (r - cfg.mean[0]) / cfg.std[0];
    out[plane + i] = (g - cfg.mean[1]) / cfg.std[1];
    out[2 * plane + i] = (b - cfg.mean[2]) / cfg.std[2];
  }
  return out;
}

/**
 * Convert model output into a full-resolution alpha mask (0–255).
 * Saliency maps are contrast-stretched (min-max) like rembg; mattes are used
 * directly as alpha.
 */
export function toFullResMask(
  output: Float32Array,
  modelN: number | { width: number; height: number },
  srcW: number,
  srcH: number,
  cfg: ModelConfig,
): Uint8ClampedArray {
  const dimensions = typeof modelN === "number" ? { width: modelN, height: modelN } : modelN;
  if (output.length !== dimensions.width * dimensions.height || output.some(v => !Number.isFinite(v))) throw new Error("Invalid segmentation output");
  let lo = 0;
  let span = 1;
  if (cfg.output === 'saliency') {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < output.length; i++) {
      const v = output[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    lo = min;
    span = max - min || 1;
  }
  const small = new Uint8ClampedArray(dimensions.width * dimensions.height);
  for (let i = 0; i < small.length; i++) {
    const v = cfg.output === 'saliency' ? (output[i] - lo) / span : cfg.output === 'logits' ? 1 / (1 + Math.exp(-output[i])) : output[i];
    small[i] = Math.round(clamp01(v) * 255);
  }
  return resizeMask(small, dimensions.width, dimensions.height, srcW, srcH);
}

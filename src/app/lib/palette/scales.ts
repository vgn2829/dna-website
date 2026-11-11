import { hexToRgb, normalizeHex, oklchToHex, rgbToOKLCH } from "./color";

export const TONAL_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type TonalStep = { step: number; hex: string; source: boolean };
const LIGHT = 0.97, DARK = 0.24;

/**
 * 100–900 scale at constant OKLCH hue. The source colour sits exactly on its
 * nearest step; lightness interpolates linearly to fixed endpoints on each side
 * and chroma tapers toward the extremes (more toward white, where sRGB narrows)
 * before the shared fixed-L/H gamut mapping.
 */
export function tonalScale(hex: string): TonalStep[] {
  const source = normalizeHex(hex), src = rgbToOKLCH(hexToRgb(source)), last = TONAL_STEPS.length - 1;
  const k = Math.round(Math.max(0, Math.min(last, (LIGHT - src.L) / ((LIGHT - DARK) / last))));
  return TONAL_STEPS.map((step, i) => {
    if (i === k) return { step, hex: source, source: true };
    const lighter = i < k, t = lighter ? (k - i) / k : (i - k) / (last - k);
    const L = lighter ? src.L + (LIGHT - src.L) * t : src.L + (DARK - src.L) * t;
    const C = src.C * (1 - (lighter ? 0.65 : 0.35) * t ** 1.4);
    return { step, hex: oklchToHex({ L: Math.max(0, Math.min(1, L)), C, H: src.H }), source: false };
  });
}

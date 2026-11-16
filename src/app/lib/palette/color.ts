// Shared sRGB / OKLab / OKLCH conversion, gamut mapping and WCAG 2.x contrast.
// Single implementation for the editor facade (./engine) and the generation
// module (../palette-engine); its gamut policy is frozen by the ColorAide
// fixtures in engine.test.ts. Reference provenance: references.md.
export type RGB = { r: number; g: number; b: number };
export type OKLCH = { L: number; C: number; H: number };
export function clamp(v: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

export function normalizeHex(hex: string): string {
  let value = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value))
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-f]{6}$/i.test(value))
    throw new Error("Enter a complete hex colour, such as #6366F1.");
  return "#" + value.toUpperCase();
}

export function hexToRgb(hex: string): RGB {
  hex = normalizeHex(hex);
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.slice(0, 2), 16) / 255,
    g: parseInt(c.slice(2, 4), 16) / 255,
    b: parseInt(c.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex(rgb: RGB) {
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map((v) =>
        Math.round(clamp(v) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

export function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbToOKLCH(rgb: RGB) {
  const r = srgbToLinear(rgb.r),
    g = srgbToLinear(rgb.g),
    b = srgbToLinear(rgb.b);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073970466 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l),
    m_ = Math.cbrt(m),
    s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + b2 * b2);
  let H = (Math.atan2(b2, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  // Exact neutral sRGB inputs have no defined hue. Use zero rather than the
  // numerical direction of the reference matrix's tiny rounding residual.
  if (rgb.r === rgb.g && rgb.g === rgb.b) return { L: clamp(L), C: 0, H: 0 };
  return { L: clamp(L), C, H };
}

function oklchToRgbRaw(c: OKLCH) {
  const hRad = (c.H * Math.PI) / 180;
  const a = c.C * Math.cos(hRad),
    b = c.C * Math.sin(hRad);
  const l_ = c.L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = c.L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = c.L - 0.0894841775 * a - 1.291485548 * b;
  const lc = l_ * l_ * l_,
    mc = m_ * m_ * m_,
    sc = s_ * s_ * s_;
  return {
    r: linearToSrgb(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    g: linearToSrgb(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    b: linearToSrgb(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  };
}

function inGamut(rgb: RGB) {
  return (
    rgb.r >= -0.001 &&
    rgb.r <= 1.001 &&
    rgb.g >= -0.001 &&
    rgb.g <= 1.001 &&
    rgb.b >= -0.001 &&
    rgb.b <= 1.001
  );
}

export function gamutMap(color: OKLCH) {
  if (
    ![color.L, color.C, color.H].every(Number.isFinite) ||
    color.L < 0 ||
    color.L > 1 ||
    color.C < 0
  )
    throw new Error("Invalid OKLCH colour.");
  const initial = oklchToRgbRaw(color);
  if (inGamut(initial)) return { ...color };
  let lo = 0,
    hi = color.C;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgbRaw({ ...color, C: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...color, C: lo };
}

export function oklchToHex(color: OKLCH) {
  const mapped = gamutMap(color);
  const rgb = oklchToRgbRaw(mapped);
  return rgbToHex({ r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) });
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESSIBILITY — WCAG luminance and contrast ratio
// ─────────────────────────────────────────────────────────────────────────────

export function wcagLuminance(rgb: RGB) {
  const r = srgbToLinear(rgb.r),
    g = srgbToLinear(rgb.g),
    b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: RGB, bg: RGB) {
  const l1 = wcagLuminance(fg),
    l2 = wcagLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

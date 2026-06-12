// color-engine.ts — Framework-agnostic colour logic for Palette Studio

// ─── Types ────────────────────────────────────────────────────────────────────

export type Color = { h: number; s: number; l: number };
export type Swatch = { color: Color; hex: string; label: string };
export type Palette = { type: string; swatches: Swatch[] };
export type WcagLevel = "AAA" | "AA" | "AA Large" | "Fail";
export type Pair = { a: Color; b: Color; indexA: number; indexB: number; ratio: number; level: WcagLevel };
export type Report = {
  pairs: Pair[];
  passingCount: number;
  failingCount: number;
  contrastScore: number;
  harmonyScore: number;
  detectedScheme: string;
  harmonyLabel: string;
  overallScore: number;
  recommendations: string[];
  warnings: string[];
};

// ─── 4.1 Colour conversions ───────────────────────────────────────────────────

export function hslToRgb({ h, s, l }: Color): { r: number; g: number; b: number } {
  const H = h / 360;
  if (s === 0) return { r: l, g: l, b: l };
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue2rgb(p, q, H + 1 / 3), g: hue2rgb(p, q, H), b: hue2rgb(p, q, H - 1 / 3) };
}

export function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): Color {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s, l };
}

export function hslToHex(c: Color): string {
  const { r, g, b } = hslToRgb(c);
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hexToHsl(hex: string): Color | null {
  const m = hex.replace('#', '');
  if (m.length !== 6) return null;
  const r = parseInt(m.slice(0, 2), 16) / 255,
        g = parseInt(m.slice(2, 4), 16) / 255,
        b = parseInt(m.slice(4, 6), 16) / 255;
  if ([r, g, b].some(v => isNaN(v))) return null;
  return rgbToHsl({ r, g, b });
}

// ─── 4.2 Warm/cool + colour name ─────────────────────────────────────────────

export function isWarm(h: number): boolean {
  return (h >= 0 && h <= 60) || h >= 300;
}

export function colorName({ h, s, l }: Color): string {
  if (s < 0.1) return l < 0.2 ? "Charcoal" : l < 0.5 ? "Slate Gray" : l < 0.8 ? "Silver" : "White";
  if (h < 15)  return l < 0.4 ? "Deep Crimson" : "Rose";
  if (h < 30)  return "Vermillion";
  if (h < 45)  return "Amber";
  if (h < 60)  return "Golden";
  if (h < 80)  return "Chartreuse";
  if (h < 150) return l < 0.4 ? "Forest Green" : "Sage";
  if (h < 195) return "Teal";
  if (h < 240) return "Cerulean";
  if (h < 270) return l < 0.4 ? "Indigo" : "Periwinkle";
  if (h < 300) return "Violet";
  if (h < 330) return "Magenta";
  return "Crimson";
}

// ─── 4.3 The 5 harmony palettes ──────────────────────────────────────────────

const wrap   = (h: number) => ((h % 360) + 360) % 360;
const shift  = (c: Color, deg: number): Color => ({ h: wrap(c.h + deg), s: c.s, l: c.l });
const lighten = (c: Color, a: number): Color => ({ h: c.h, s: c.s, l: Math.min(1, Math.max(0, c.l + a)) });
const darken  = (c: Color, a: number): Color => ({ h: c.h, s: c.s, l: Math.min(1, Math.max(0, c.l - a)) });
const desat   = (c: Color, a: number): Color => ({ h: c.h, s: Math.min(1, Math.max(0, c.s - a)), l: c.l });

export function generatePalette(type: string, base: Color): Palette | null {
  const sw = (color: Color, label: string): Swatch => ({ color, label, hex: hslToHex(color) });
  switch (type) {
    case "complementary": {
      const comp = shift(base, 180);
      return { type, swatches: [sw(base, "Base"), sw(comp, "Complement"),
        sw(lighten(base, .15), "Tint"), sw(darken(base, .15), "Shade"), sw(lighten(comp, .15), "Comp Tint")] };
    }
    case "triadic": {
      const t1 = shift(base, 120), t2 = shift(base, 240);
      return { type, swatches: [sw(base, "Base"), sw(t1, "Triadic 1"), sw(t2, "Triadic 2"),
        sw(lighten(base, .2), "Tint"), sw(darken(t1, .1), "Accent")] };
    }
    case "analogous":
      return { type, swatches: [sw(base, "Base"), sw(shift(base, -30), "Analog -1"), sw(shift(base, 30), "Analog +1"),
        sw(shift(base, -60), "Analog -2"), sw(shift(base, 60), "Analog +2")] };
    case "splitComplementary":
      return { type, swatches: [sw(base, "Base"), sw(shift(base, 150), "Split 1"), sw(shift(base, 210), "Split 2"),
        sw(lighten(base, .2), "Tint"), sw(desat(base, .3), "Muted")] };
    case "tetradic":
      return { type, swatches: [sw(base, "Base"), sw(shift(base, 90), "90°"), sw(shift(base, 180), "180°"), sw(shift(base, 270), "270°")] };
    default:
      return null;
  }
}

export const HARMONY_TYPES = ["complementary", "triadic", "analogous", "splitComplementary", "tetradic"];

export const HARMONY_LABELS: Record<string, string> = {
  complementary: "Complementary",
  triadic: "Triadic",
  analogous: "Analogous",
  splitComplementary: "Split-Comp",
  tetradic: "Tetradic",
};

export function generateAllPalettes(base: Color): (Palette | null)[] {
  return HARMONY_TYPES.map(t => generatePalette(t, base));
}

// ─── 4.4 WCAG contrast (WCAG 2.1) ────────────────────────────────────────────

export function luminance(color: Color): number {
  const { r, g, b } = hslToRgb(color);
  const lin = (v: number) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(c1: Color, c2: Color): number {
  const L1 = luminance(c1), L2 = luminance(c2);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

export function wcagLevel(ratio: number): WcagLevel {
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA Large" : "Fail";
}

// ─── 4.5 Harmony scoring + scheme detection + full Report ────────────────────

const hueDiff = (a: number, b: number): number => { let d = Math.abs(a - b); return d > 180 ? 360 - d : d; };

function buildPairs(colors: Color[]): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++) {
      const ratio = contrastRatio(colors[i], colors[j]);
      pairs.push({ a: colors[i], b: colors[j], indexA: i, indexB: j, ratio, level: wcagLevel(ratio) });
    }
  return pairs;
}

function detectScheme(hues: number[]): string {
  if (hues.length < 2) return "complementary";
  if (hues.length === 2) {
    const d = hueDiff(hues[0], hues[1]);
    if (Math.abs(d - 180) < 35) return "complementary";
    if (d < 45) return "analogous";
    if (Math.abs(d - 120) < 35) return "triadic";
  } else if (hues.length === 3) {
    const s = [...hues].sort((a, b) => a - b);
    const d1 = hueDiff(s[0], s[1]), d2 = hueDiff(s[1], s[2]);
    if (Math.abs(d1 - 120) < 30 && Math.abs(d2 - 120) < 30) return "triadic";
    if (d1 < 45 && d2 < 45) return "analogous";
    if (Math.abs(d1 - 30) < 20) return "splitComplementary";
  } else return "tetradic";
  return "complementary";
}

function maxPairDiff(hues: number[]): number {
  let m = 0;
  for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) m = Math.max(m, hueDiff(hues[i], hues[j]));
  return m;
}

function computeHarmonyScore(hues: number[], scheme: string): number {
  if (hues.length < 2) return 50;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  switch (scheme) {
    case "complementary": {
      const d = hueDiff(hues[0], hues.length > 1 ? hues[1] : hues[0] + 180);
      return clamp(100 - Math.abs(d - 180) * 2.5);
    }
    case "analogous":
      return clamp(100 - Math.max(0, maxPairDiff(hues) - 30) * 2.2);
    case "triadic": {
      if (hues.length < 3) return 60;
      const s = [...hues].sort((a, b) => a - b);
      const devs = [hueDiff(s[0], s[1]), hueDiff(s[1], s[2]), hueDiff(s[0], s[2])].map(x => Math.abs(x - 120));
      return clamp(100 - (devs.reduce((a, b) => a + b, 0) / 3) * 2);
    }
    case "tetradic": {
      if (hues.length < 4) return 60;
      const s = [...hues].sort((a, b) => a - b);
      const devs: number[] = [];
      for (let i = 0; i < s.length - 1; i++) devs.push(Math.abs(hueDiff(s[i], s[i + 1]) - 90));
      return clamp(100 - (devs.reduce((a, b) => a + b, 0) / devs.length) * 2);
    }
    case "splitComplementary":
      return clamp(65 - maxPairDiff(hues) * 0.3);
    default: return 60;
  }
}

function getHarmonyLabel(score: number): string {
  return score >= 85 ? "Excellent" : score >= 68 ? "Good" : score >= 45 ? "Fair" : "Weak";
}

export function analyze(colors: Color[]): Report | null {
  if (!colors || colors.length < 2) return null;
  const pairs   = buildPairs(colors);
  const hues    = colors.map(c => c.h);
  const scheme  = detectScheme(hues);
  const hScore  = computeHarmonyScore(hues, scheme);
  const passing = pairs.filter(p => p.ratio >= 4.5).length;
  const failing = pairs.length - passing;
  const contrastScore = pairs.length ? (passing / pairs.length) * 100 : 100;
  const overall = Math.round(contrastScore * 0.5 + hScore * 0.5);

  const recs: string[] = [];
  if (failing > 0) recs.push(`${failing} pair${failing === 1 ? "" : "s"} fail WCAG AA — increase lightness contrast to improve readability.`);
  if (hScore < 65) recs.push(`Hue relationships are inconsistent — try anchoring to ${scheme.toLowerCase()} positions.`);
  const highSat = colors.filter(c => c.s > 0.88);
  if (highSat.length > 2) recs.push(`Too many fully-saturated colours (${highSat.length}) — desaturate ${highSat.length - 1} to reduce visual tension.`);
  const ls = colors.map(c => c.l);
  if (Math.max(...ls) - Math.min(...ls) < 0.22) recs.push("Low lightness contrast across the set — add darker or lighter tones to build visual hierarchy.");
  const hasDark = colors.some(c => c.l < 0.25), hasLight = colors.some(c => c.l > 0.75);
  if (!hasDark && !hasLight) recs.push("No anchor tones — include at least one very light or very dark colour as a neutral base.");
  if (recs.length === 0) recs.push("All checks passed — contrast, harmony, and accessibility are in good shape.");

  const isRed   = (c: Color) => (c.h < 25 || c.h > 340) && c.s > 0.3;
  const isGreen = (c: Color) => c.h > 90 && c.h < 165 && c.s > 0.3;
  const warnings: string[] = [];
  for (const p of pairs)
    if (p.ratio < 3.0 && ((isRed(p.a) && isGreen(p.b)) || (isRed(p.b) && isGreen(p.a))))
      warnings.push("A red–green pair may be invisible to deuteranopia / protanopia users.");

  return {
    pairs: [...pairs].sort((a, b) => b.ratio - a.ratio),
    passingCount: passing,
    failingCount: failing,
    contrastScore: Math.round(contrastScore),
    harmonyScore: Math.round(hScore),
    detectedScheme: scheme,
    harmonyLabel: getHarmonyLabel(hScore),
    overallScore: overall,
    recommendations: recs,
    warnings: [...new Set(warnings)],
  };
}

// ─── 4.6 Image colour extraction ─────────────────────────────────────────────

export function extractColours(img: HTMLImageElement): Color[] {
  const c = document.createElement("canvas"); c.width = 40; c.height = 40;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, 40, 40);
  const d = ctx.getImageData(0, 0, 40, 40).data;
  const buckets: Record<number, { r: number; g: number; b: number; n: number }> = {};
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    if (a < 128) continue;
    if (r > 230 && g > 230 && b > 230) continue;
    if (r < 20  && g < 20  && b < 20)  continue;
    const key = ((r / 40 | 0) * 49) + ((g / 40 | 0) * 7) + (b / 40 | 0);
    if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, n: 0 };
    const x = buckets[key]; x.r += r; x.g += g; x.b += b; x.n++;
  }
  const results = Object.values(buckets)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map(v => rgbToHsl({ r: v.r / v.n / 255, g: v.g / v.n / 255, b: v.b / v.n / 255 }));
  return results;
}

// ─── Verification helpers (exported for testing) ─────────────────────────────

export function verifyContrast(): { ratio: number; pass: boolean } {
  const black = hexToHsl('#000000')!;
  const white = hexToHsl('#FFFFFF')!;
  const ratio = contrastRatio(black, white);
  return { ratio, pass: Math.abs(ratio - 21) < 0.001 };
}

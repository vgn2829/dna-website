import * as quality from "../palette-engine";
// Pure colour domain. Reference provenance and limitations: palette/references.md.
import { simulateCB } from "./simulation";
export { simulateCB } from "./simulation";
export type RGB = { r: number; g: number; b: number };
export type OKLCH = { L: number; C: number; H: number };
export type Role =
  | "bg"
  | "surface"
  | "surfaceElevated"
  | "text"
  | "textMuted"
  | "border"
  | "primary"
  | "primaryFg"
  | "secondary"
  | "accent"
  | "success"
  | "successBg"
  | "warning"
  | "warningBg"
  | "error"
  | "errorBg"
  | "info"
  | "infoBg";
export type Palette = Record<Role, string>;
export type Harmony =
  | "complementary"
  | "analogous"
  | "triadic"
  | "splitComplementary"
  | "tetradic";
export type Mood = "visual" | "poster" | "luxury" | "minimal" | "cyberpunk";
export function deltaOK(
  a: { L: number; a: number; b: number },
  b: { L: number; a: number; b: number },
): number {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}
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

// APCA removed from the product; no unresolved licensed algorithm is exposed.


// ─────────────────────────────────────────────────────────────────────────────
// CONTRAST-SEEKING LIGHTNESS
// ─────────────────────────────────────────────────────────────────────────────

export function findAccessibleLightness(
  hue: number,
  chroma: number,
  bgHex: string,
  targetL: number,
  minCR = 4.5,
): number {
  const passes = (L: number) =>
    contrastRatio(
      hexToRgb(oklchToHex({ L, C: chroma, H: hue })),
      hexToRgb(bgHex),
    ) >= minCR;
  if (passes(targetL)) return targetL;
  const candidates: number[] = [];
  for (const endpoint of [0, 1]) {
    if (!passes(endpoint)) continue;
    let fail = targetL,
      pass = endpoint;
    for (let i = 0; i < 32; i++) {
      const mid = (fail + pass) / 2;
      if (passes(mid)) pass = mid;
      else fail = mid;
    }
    candidates.push(pass);
  }
  if (!candidates.length) throw new Error("Contrast target is not achievable.");
  return candidates.sort(
    (a, b) => Math.abs(a - targetL) - Math.abs(b - targetL),
  )[0];
}

function oklchToLab(oklch: OKLCH) {
  const hRad = (oklch.H * Math.PI) / 180;
  return {
    L: oklch.L,
    a: oklch.C * Math.cos(hRad),
    b: oklch.C * Math.sin(hRad),
  };
}

export const HARMONY_MODES = {
  complementary: {
    label: "Complementary",
    description: "Bold contrast — opposite hue",
    getHues: (h: number) => ({
      secondary: (h + 180) % 360,
      accent: (h + 150) % 360,
    }),
  },
  analogous: {
    label: "Analogous",
    description: "Harmonious — neighboring hues",
    getHues: (h: number) => ({
      secondary: (h + 30) % 360,
      accent: (h - 30 + 360) % 360,
    }),
  },
  triadic: {
    label: "Triadic",
    description: "Vibrant — three equal hue steps",
    getHues: (h: number) => ({
      secondary: (h + 120) % 360,
      accent: (h + 240) % 360,
    }),
  },
  splitComplementary: {
    label: "Split Comp",
    description: "Balanced — two near-complements",
    getHues: (h: number) => ({
      secondary: (h + 150) % 360,
      accent: (h + 210) % 360,
    }),
  },
  tetradic: {
    label: "Tetradic",
    description: "Rich — four hues in a rectangle",
    getHues: (h: number) => ({
      secondary: (h + 90) % 360,
      accent: (h + 270) % 360,
    }),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COLOR SYMBOLISM
// ─────────────────────────────────────────────────────────────────────────────

export function getSeedSymbolism(hex: string) {
  try {
    const rgb = hexToRgb(hex);
    const { L, C, H } = rgbToOKLCH(rgb);

    if (C < 0.04) {
      if (L > 0.85)
        return {
          label: "White",
          emoji: "⬜",
          keywords: ["Purity", "Clarity", "Simplicity"],
          mood: "Clean and minimal — conveys openness and space.",
          use: "Backgrounds, negative space, minimal UI",
        };
      if (L < 0.2)
        return {
          label: "Black",
          emoji: "⬛",
          keywords: ["Power", "Elegance", "Mystery"],
          mood: "Authoritative and sophisticated — commands attention.",
          use: "Luxury brands, high contrast UI, editorial design",
        };
      return {
        label: "Gray",
        emoji: "🩶",
        keywords: ["Neutrality", "Balance", "Professionalism"],
        mood: "Calm and balanced — lets other colors breathe.",
        use: "UI surfaces, text, supporting elements",
      };
    }

    if ((H >= 0 && H < 30) || H >= 345)
      return {
        label: "Red",
        emoji: "🔴",
        keywords: ["Energy", "Urgency", "Passion"],
        mood: "Bold and attention-grabbing — stimulates action and excitement.",
        use: "CTAs, alerts, food & entertainment brands",
      };
    if (H >= 30 && H < 60)
      return {
        label: "Orange",
        emoji: "🟠",
        keywords: ["Enthusiasm", "Warmth", "Playfulness"],
        mood: "Energetic and friendly — encourages optimism and creativity.",
        use: "Consumer apps, food brands, creative platforms",
      };
    if (H >= 60 && H < 95)
      return {
        label: "Yellow",
        emoji: "🟡",
        keywords: ["Optimism", "Attention", "Warmth"],
        mood: "Cheerful and energizing — draws the eye and conveys positivity.",
        use: "Highlights, warnings, youth-oriented brands",
      };
    if (H >= 95 && H < 165)
      return {
        label: "Green",
        emoji: "🟢",
        keywords: ["Nature", "Health", "Growth"],
        mood: "Calming and restorative — signals safety, progress, and balance.",
        use: "Health & wellness, finance, sustainability brands",
      };
    if (H >= 165 && H < 220)
      return {
        label: "Teal / Cyan",
        emoji: "🩵",
        keywords: ["Clarity", "Innovation", "Calm"],
        mood: "Fresh and modern — balances the trust of blue with the energy of green.",
        use: "Tech products, healthcare, communication tools",
      };
    if (H >= 220 && H < 270)
      return {
        label: "Blue",
        emoji: "🔵",
        keywords: ["Trust", "Reliability", "Calm"],
        mood: "Stable and professional — the most universally trusted color in UI.",
        use: "Corporate, SaaS, finance, social platforms",
      };
    if (H >= 270 && H < 310)
      return {
        label: "Purple / Violet",
        emoji: "🟣",
        keywords: ["Luxury", "Creativity", "Mystery"],
        mood: "Imaginative and refined — evokes premium quality and artistic depth.",
        use: "Luxury brands, creative tools, beauty & fashion",
      };
    if (H >= 310 && H < 345)
      return {
        label: "Pink / Magenta",
        emoji: "🩷",
        keywords: ["Romance", "Playfulness", "Energy"],
        mood: "Warm and expressive — ranges from gentle and romantic to vibrant and bold.",
        use: "Beauty, lifestyle, entertainment, youth brands",
      };
  } catch {
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR BLINDNESS SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PALETTE DERIVATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────


export function derivePalette(seedHex: string, darkMode: boolean, harmonyKey: Harmony, lockedColors: Partial<Palette> = {}, variation = seedHex): Palette {
  if (!HARMONY_MODES[harmonyKey]) throw new Error("Unknown harmony mode.");
  const locks: Record<string,string> = {};
  for (const [key,value] of Object.entries(lockedColors)) { if (value) locks[key]=normalizeHex(value); }
  return checkedPalette(quality.derivePalette(normalizeHex(seedHex), darkMode, harmonyKey, locks, variation));
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────────────────────

export function scorePalette(palette: Palette) {
  const pairs: { name: string; fg: Role; bg: Role; w: number }[] = [
    { name: "Text / BG", fg: "text", bg: "bg", w: 3.0 },
    { name: "TextMuted / BG", fg: "textMuted", bg: "bg", w: 2.0 },
    { name: "TextMuted / Surface", fg: "textMuted", bg: "surface", w: 1.5 },
    { name: "Primary / BG", fg: "primary", bg: "bg", w: 2.0 },
    { name: "Primary / Surface", fg: "primary", bg: "surface", w: 1.5 },
    { name: "PrimaryFg / Primary", fg: "primaryFg", bg: "primary", w: 2.5 },
    { name: "Secondary / BG", fg: "secondary", bg: "bg", w: 1.5 },
    { name: "Accent / BG", fg: "accent", bg: "bg", w: 1.5 },
    { name: "Text / Surface", fg: "text", bg: "surface", w: 2.0 },
    { name: "Success / SuccessBg", fg: "success", bg: "successBg", w: 1.0 },
    { name: "Error / ErrorBg", fg: "error", bg: "errorBg", w: 1.0 },
    { name: "Warning / WarningBg", fg: "warning", bg: "warningBg", w: 1.0 },
    { name: "Success / Surface", fg: "success", bg: "surface", w: 1 },
    { name: "Warning / Surface", fg: "warning", bg: "surface", w: 1 },
    { name: "Error / Surface", fg: "error", bg: "surface", w: 1 },
    {
      name: "TextMuted / SurfaceElevated",
      fg: "textMuted",
      bg: "surfaceElevated",
      w: 1,
    },
    { name: "Info / InfoBg", fg: "info", bg: "infoBg", w: 1 },
    { name: "Text / SurfaceElevated", fg: "text", bg: "surfaceElevated", w: 2 },
    { name: "Text / SuccessBg", fg: "text", bg: "successBg", w: 1 },
    { name: "Text / WarningBg", fg: "text", bg: "warningBg", w: 1 },
    { name: "Text / ErrorBg", fg: "text", bg: "errorBg", w: 1 },
    { name: "Text / InfoBg", fg: "text", bg: "infoBg", w: 1 },
  ];

  let total = 0,
    wSum = 0;
  const pairData: Record<string, { cr: number; score: number }> =
    {};
  for (const p of pairs) {
    const fg = hexToRgb(palette[p.fg]),
      bg = hexToRgb(palette[p.bg]);
    const cr = contrastRatio(fg, bg);
    let s = cr >= 7 ? 1.0 : cr >= 4.5 ? 0.78 : cr >= 3 ? 0.42 : 0.12;
    pairData[p.name] = { cr, score: s };
    total += s * p.w;
    wSum += p.w;
  }

  const roles: Role[] = [
    "primary",
    "secondary",
    "accent",
    "success",
    "warning",
    "error",
  ];
  let dTotal = 0,
    dCount = 0;
  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      dTotal += Math.min(
        deltaOK(
          oklchToLab(rgbToOKLCH(hexToRgb(palette[roles[i]]))),
          oklchToLab(rgbToOKLCH(hexToRgb(palette[roles[j]]))),
        ) / 0.3,
        1.0,
      );
      dCount++;
    }
  }
  const dScore = dTotal / dCount;
  total += dScore * 2.0;
  wSum += 2.0;

  return {
    score: Math.round((total / wSum) * 100),
    pairs: pairData,
    dScore: Math.round(dScore * 100),
  };
}

export function analyzeCB(palette: Palette) {
  const out: Record<string, { textBgCR: number; primaryBgCR: number }> = {};
  for (const type of ["protanopia", "deuteranopia", "tritanopia"] as const) {
    const st = simulateCB(hexToRgb(palette.text), type);
    const sb = simulateCB(hexToRgb(palette.bg), type);
    const sp = simulateCB(hexToRgb(palette.primary), type);
    out[type] = {
      textBgCR: contrastRatio(st, sb),
      primaryBgCR: contrastRatio(sp, sb),
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUAL PALETTE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

function simpleColorName(hex: string) {
  const { L, C, H } = rgbToOKLCH(hexToRgb(hex));
  if (C < 0.04) {
    if (L > 0.9) return "White";
    if (L > 0.7) return "Light Gray";
    if (L > 0.45) return "Gray";
    if (L > 0.22) return "Dark Gray";
    return "Black";
  }
  const satWord = C > 0.22 ? "" : C > 0.12 ? "Muted " : "Faint ";
  const lightWord =
    L > 0.8 ? "Light " : L < 0.28 ? "Deep " : L < 0.42 ? "Dark " : "";
  const hue =
    H < 18 || H >= 345
      ? "Red"
      : H < 45
        ? "Orange"
        : H < 70
          ? "Amber"
          : H < 100
            ? "Yellow"
            : H < 150
              ? "Green"
              : H < 190
                ? "Teal"
                : H < 230
                  ? "Cyan"
                  : H < 260
                    ? "Blue"
                    : H < 295
                      ? "Violet"
                      : H < 330
                        ? "Pink"
                        : "Rose";
  return (lightWord + satWord + hue).trim();
}

function jitter(value: number, amount = 0.04, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value + (Math.random() - 0.5) * amount));
}

export function deriveVisualPalette(seedHex: string, harmonyKey: Harmony = "complementary", paletteMode: Mood = "visual", random: () => number = Math.random) {
  if (!HARMONY_MODES[harmonyKey]) throw new Error("Unknown harmony mode.");
  return quality.deriveVisualPalette(normalizeHex(seedHex), harmonyKey, paletteMode, String(random()));
}

export function checkedPalette(value: Record<string,string>): Palette {
  if (!/^#[0-9a-f]{6}$/i.test(value.bg || "")) throw new Error("Invalid palette role: bg");
  if (!/^#[0-9a-f]{6}$/i.test(value.surface || "")) throw new Error("Invalid palette role: surface");
  if (!/^#[0-9a-f]{6}$/i.test(value.surfaceElevated || "")) throw new Error("Invalid palette role: surfaceElevated");
  if (!/^#[0-9a-f]{6}$/i.test(value.text || "")) throw new Error("Invalid palette role: text");
  if (!/^#[0-9a-f]{6}$/i.test(value.textMuted || "")) throw new Error("Invalid palette role: textMuted");
  if (!/^#[0-9a-f]{6}$/i.test(value.border || "")) throw new Error("Invalid palette role: border");
  if (!/^#[0-9a-f]{6}$/i.test(value.primary || "")) throw new Error("Invalid palette role: primary");
  if (!/^#[0-9a-f]{6}$/i.test(value.primaryFg || "")) throw new Error("Invalid palette role: primaryFg");
  if (!/^#[0-9a-f]{6}$/i.test(value.secondary || "")) throw new Error("Invalid palette role: secondary");
  if (!/^#[0-9a-f]{6}$/i.test(value.accent || "")) throw new Error("Invalid palette role: accent");
  if (!/^#[0-9a-f]{6}$/i.test(value.success || "")) throw new Error("Invalid palette role: success");
  if (!/^#[0-9a-f]{6}$/i.test(value.successBg || "")) throw new Error("Invalid palette role: successBg");
  if (!/^#[0-9a-f]{6}$/i.test(value.warning || "")) throw new Error("Invalid palette role: warning");
  if (!/^#[0-9a-f]{6}$/i.test(value.warningBg || "")) throw new Error("Invalid palette role: warningBg");
  if (!/^#[0-9a-f]{6}$/i.test(value.error || "")) throw new Error("Invalid palette role: error");
  if (!/^#[0-9a-f]{6}$/i.test(value.errorBg || "")) throw new Error("Invalid palette role: errorBg");
  if (!/^#[0-9a-f]{6}$/i.test(value.info || "")) throw new Error("Invalid palette role: info");
  if (!/^#[0-9a-f]{6}$/i.test(value.infoBg || "")) throw new Error("Invalid palette role: infoBg");
  return { bg: value.bg, surface: value.surface, surfaceElevated: value.surfaceElevated, text: value.text, textMuted: value.textMuted, border: value.border, primary: value.primary, primaryFg: value.primaryFg, secondary: value.secondary, accent: value.accent, success: value.success, successBg: value.successBg, warning: value.warning, warningBg: value.warningBg, error: value.error, errorBg: value.errorBg, info: value.info, infoBg: value.infoBg };
}

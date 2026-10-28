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
// ACCESSIBILITY — WCAG luminance, contrast ratio, APCA
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

// APCA 0.0.98G / apca-w3 0.1.9, signed Lc. See references.md.
export function apcaContrast(textRgb: RGB, bgRgb: RGB): number {
  const luminance = (c: RGB) =>
    0.2126729 * c.r ** 2.4 + 0.7151522 * c.g ** 2.4 + 0.072175 * c.b ** 2.4;
  const soft = (v: number) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const text = soft(luminance(textRgb)),
    bg = soft(luminance(bgRgb));
  if (Math.abs(bg - text) < 0.0005) return 0;
  const sapc =
    bg > text
      ? (bg ** 0.56 - text ** 0.57) * 1.14
      : (bg ** 0.65 - text ** 0.62) * 1.14;
  return bg > text
    ? sapc < 0.1
      ? 0
      : (sapc - 0.027) * 100
    : sapc > -0.1
      ? 0
      : (sapc + 0.027) * 100;
}

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

const nudgeLightnessForContrast = findAccessibleLightness;
// Retained aesthetic tuning, not validated quality statistics.
const FIGMA_MEDIAN_CHROMA = 0.092;
const FIGMA_LIGHTNESS_SPREAD = 0.45;

export function derivePalette(
  seedHex: string,
  darkMode: boolean,
  harmonyKey: Harmony,
  lockedColors: Partial<Palette> = {},
) {
  if (!HARMONY_MODES[harmonyKey]) throw new Error("Unknown harmony mode.");
  for (const value of Object.values(lockedColors))
    if (value) normalizeHex(value);
  const seedRgb = hexToRgb(seedHex);
  const seed = rgbToOKLCH(seedRgb);
  const seedChroma = seed.C;
  const seedHue = seed.H;

  const isWarmSeed = (seedHue >= 0 && seedHue <= 100) || seedHue >= 300;
  const neutralHue = isWarmSeed ? 230 : 65;

  const bgHex = oklchToHex(
    gamutMap({ L: darkMode ? 0.09 : 0.985, C: 0.004, H: neutralHue }),
  );
  const surfHex = oklchToHex(
    gamutMap({ L: darkMode ? 0.13 : 0.955, C: 0.005, H: neutralHue }),
  );
  const surf2Hex = oklchToHex(
    gamutMap({ L: darkMode ? 0.17 : 0.92, C: 0.006, H: neutralHue }),
  );

  const textHex = oklchToHex(
    gamutMap({ L: darkMode ? 0.94 : 0.11, C: 0.003, H: neutralHue }),
  );
  const textMHex = oklchToHex(
    gamutMap({ L: darkMode ? 0.58 : 0.44, C: 0.006, H: neutralHue }),
  );
  const borderHex = oklchToHex(
    gamutMap({ L: darkMode ? 0.26 : 0.83, C: 0.005, H: neutralHue }),
  );

  const { secondary: secondaryHue, accent: accentHue } =
    HARMONY_MODES[harmonyKey].getHues(seedHue);
  const [cs0, cs1, cs2] = [1, 0.8, 0.7];

  const primaryChroma = Math.min(seedChroma * cs0 * 1.05, 0.38);

  const secondaryChroma = Math.min(
    seedChroma * cs1,
    Math.max(FIGMA_MEDIAN_CHROMA * 2.2, seedChroma * 0.65),
  );

  const accentChroma = Math.min(
    seedChroma * cs2 * 1.1,
    Math.max(FIGMA_MEDIAN_CHROMA * 2.8, seedChroma * 0.8),
  );

  const lightnessBudget = FIGMA_LIGHTNESS_SPREAD;

  const primaryL = nudgeLightnessForContrast(
    seedHue,
    primaryChroma,
    bgHex,
    seed.L,
  );

  const secondaryTargetL = darkMode
    ? Math.min(seed.L + lightnessBudget * 0.4, 0.88)
    : Math.max(seed.L - lightnessBudget * 0.4, 0.12);
  const secondaryL = nudgeLightnessForContrast(
    secondaryHue,
    secondaryChroma,
    bgHex,
    secondaryTargetL,
  );

  const accentTargetL = darkMode
    ? Math.min(seed.L + lightnessBudget * 0.7, 0.92)
    : Math.max(seed.L - lightnessBudget * 0.7, 0.08);
  const accentL = nudgeLightnessForContrast(
    accentHue,
    accentChroma,
    bgHex,
    accentTargetL,
  );

  const primaryHex = oklchToHex(
    gamutMap({ L: primaryL, C: primaryChroma, H: seedHue }),
  );
  const primaryFgHex =
    contrastRatio(hexToRgb(primaryHex), hexToRgb("#000000")) >=
    contrastRatio(hexToRgb(primaryHex), hexToRgb("#FFFFFF"))
      ? "#000000"
      : "#FFFFFF";
  const secondaryHex = oklchToHex(
    gamutMap({ L: secondaryL, C: secondaryChroma, H: secondaryHue }),
  );
  const accentHex = oklchToHex(
    gamutMap({ L: accentL, C: accentChroma, H: accentHue }),
  );

  // Near-neutral anchor (internal — no new palette key)
  const neutralAnchorChroma = Math.min(
    seedChroma * 0.12,
    FIGMA_MEDIAN_CHROMA * 1.3,
  );
  const neutralAnchorL = darkMode ? 0.35 : 0.65;

  const successL = nudgeLightnessForContrast(
    145,
    0.2,
    bgHex,
    darkMode ? 0.75 : 0.35,
    4.5,
  );
  const warningL = nudgeLightnessForContrast(
    75,
    0.22,
    bgHex,
    darkMode ? 0.82 : 0.5,
    4.5,
  );
  const errorL = nudgeLightnessForContrast(
    25,
    0.26,
    bgHex,
    darkMode ? 0.72 : 0.4,
    4.5,
  );
  const infoL = nudgeLightnessForContrast(
    240,
    0.2,
    bgHex,
    darkMode ? 0.72 : 0.4,
    4.5,
  );

  const successHex = oklchToHex(gamutMap({ L: successL, C: 0.2, H: 145 }));
  const warningHex = oklchToHex(gamutMap({ L: warningL, C: 0.22, H: 75 }));
  const errorHex = oklchToHex(gamutMap({ L: errorL, C: 0.26, H: 25 }));
  const infoHex = oklchToHex(gamutMap({ L: infoL, C: 0.2, H: 240 }));

  const base: Palette = {
    bg: bgHex,
    surface: surfHex,
    surfaceElevated: surf2Hex,
    text: textHex,
    textMuted: textMHex,
    border: borderHex,
    primary: primaryHex,
    primaryFg: primaryFgHex,
    secondary: secondaryHex,
    accent: accentHex,
    success: successHex,
    successBg: oklchToHex(
      gamutMap({ L: darkMode ? 0.15 : 0.94, C: 0.04, H: 145 }),
    ),
    warning: warningHex,
    warningBg: oklchToHex(
      gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.04, H: 75 }),
    ),
    error: errorHex,
    errorBg: oklchToHex(
      gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.05, H: 25 }),
    ),
    info: infoHex,
    infoBg: oklchToHex(
      gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.04, H: 240 }),
    ),
  };

  (Object.keys(lockedColors) as Role[]).forEach((k) => {
    if (lockedColors[k] && base[k] !== undefined) base[k] = lockedColors[k];
  });

  if (!lockedColors.primaryFg)
    base.primaryFg =
      contrastRatio(hexToRgb(base.primary), hexToRgb("#000000")) >=
      contrastRatio(hexToRgb(base.primary), hexToRgb("#FFFFFF"))
        ? "#000000"
        : "#FFFFFF";
  return base;
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
  const pairData: Record<string, { cr: number; apca: number; score: number }> =
    {};
  for (const p of pairs) {
    const fg = hexToRgb(palette[p.fg]),
      bg = hexToRgb(palette[p.bg]);
    const cr = contrastRatio(fg, bg);
    const ap = apcaContrast(fg, bg);
    let s = cr >= 7 ? 1.0 : cr >= 4.5 ? 0.78 : cr >= 3 ? 0.42 : 0.12;
    if (Math.abs(ap) >= 75) s = Math.min(1.0, s + 0.08);
    pairData[p.name] = { cr, apca: ap, score: s };
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

export function deriveVisualPalette(
  seedHex: string,
  harmonyKey: Harmony = "complementary",
  paletteMode: Mood = "visual",
  random: () => number = Math.random,
) {
  const jitter = (value: number, amount = 0.04, min = 0, max = 1) =>
    clamp(value + (random() - 0.5) * amount, min, max);
  const { L, C, H } = rgbToOKLCH(hexToRgb(seedHex));

  const harmony = HARMONY_MODES[harmonyKey] || HARMONY_MODES.complementary;
  const { secondary: H2, accent: H3 } = harmony.getHues(H);

  // Softened harmony angles — break rigid geometry
  const H2soft = (H2 + (random() - 0.5) * 60 + 360) % 360;
  const H3soft = (H3 + (random() - 0.5) * 50 + 360) % 360;

  // Adaptive chroma cap — yellow-green stays clean, blue-purple gets headroom
  const chromaCap =
    H >= 60 && H <= 110 ? 0.22 : H >= 240 && H <= 280 ? 0.32 : 0.28;

  // Temperature-skewed neutrals — warm seed → cool slate, cool seed → warm amber
  const isWarmSeed = (H >= 0 && H <= 100) || H >= 300;
  const neutralH = isWarmSeed ? 250 : 70;

  const profiles = {
    visual: [
      {
        L: jitter(L, 0.06),
        C: jitter(C, 0.03, 0, chromaCap),
        H: (H + (random() - 0.5) * 12 + 360) % 360,
      },
      {
        L: jitter(Math.min(L + 0.15, 0.85), 0.1),
        C: jitter(C * 0.65, 0.04, 0, chromaCap),
        H: H2soft,
      },
      {
        L: jitter(Math.max(L - 0.15, 0.15), 0.1),
        C: jitter(C * 0.5, 0.04, 0, chromaCap),
        H,
      },
      { L: jitter(L, 0.1), C: jitter(C * 0.8, 0.04, 0, chromaCap), H: H3soft },
      {
        L: jitter(Math.min(L + 0.28, 0.93), 0.1),
        C: jitter(C * 0.18, 0.04, 0, chromaCap),
        H: H2soft,
      },
    ],
    poster: [
      {
        L: jitter(0.52, 0.1),
        C: jitter(Math.min(C * 1.1, chromaCap), 0.04, 0, chromaCap),
        H,
      },
      {
        L: jitter(0.6, 0.1),
        C: jitter(Math.min(C * 1.1, chromaCap), 0.04, 0, chromaCap),
        H: H2soft,
      },
      {
        L: jitter(0.42, 0.1),
        C: jitter(Math.min(C * 1.1, chromaCap), 0.04, 0, chromaCap),
        H: H3soft,
      },
      { L: jitter(0.15, 0.06), C: jitter(0.01, 0.02, 0, 0.05), H },
      { L: jitter(0.95, 0.06), C: jitter(0.006, 0.02, 0, 0.03), H },
    ],
    luxury: [
      { L: jitter(0.12, 0.05), C: jitter(0.015, 0.03, 0, 0.06), H: neutralH },
      {
        L: jitter(0.28, 0.05),
        C: jitter(Math.min(C * 0.5, 0.14), 0.03, 0, chromaCap),
        H,
      },
      {
        L: jitter(0.48, 0.05),
        C: jitter(Math.min(C * 0.35, 0.1), 0.03, 0, chromaCap),
        H,
      },
      { L: jitter(0.72, 0.05), C: jitter(0.018, 0.03, 0, 0.06), H: neutralH },
      { L: jitter(0.88, 0.05), C: jitter(0.012, 0.03, 0, 0.05), H: neutralH },
    ],
    minimal: [
      { L: jitter(0.97, 0.05), C: jitter(0.004, 0.02, 0, 0.03), H: neutralH },
      { L: jitter(0.88, 0.05), C: jitter(0.007, 0.02, 0, 0.04), H: neutralH },
      { L: jitter(0.68, 0.05), C: jitter(0.01, 0.02, 0, 0.05), H: neutralH },
      { L: jitter(0.32, 0.05), C: jitter(0.012, 0.02, 0, 0.05), H: neutralH },
      {
        L: jitter(L, 0.05),
        C: jitter(Math.min(C * 0.7, 0.2), 0.03, 0, chromaCap),
        H,
      },
    ],
    cyberpunk: [
      { L: jitter(0.07, 0.04), C: jitter(0.008, 0.02, 0, 0.04), H },
      { L: jitter(0.11, 0.04), C: jitter(0.012, 0.02, 0, 0.05), H },
      {
        L: jitter(0.72, 0.05),
        C: jitter(Math.min(C * 1.4, chromaCap), 0.03, 0, chromaCap),
        H,
      },
      {
        L: jitter(0.68, 0.05),
        C: jitter(Math.min(C * 1.3, chromaCap), 0.03, 0, chromaCap),
        H: H2soft,
      },
      {
        L: jitter(0.65, 0.05),
        C: jitter(Math.min(C * 1.2, chromaCap), 0.03, 0, chromaCap),
        H: H3soft,
      },
    ],
  };

  const swatchDefs = profiles[paletteMode] || profiles.visual;
  return swatchDefs.map((p, i) => {
    const hex = oklchToHex(gamutMap({ L: p.L, C: p.C, H: p.H }));
    return { index: i, hex, name: simpleColorName(hex) };
  });
}

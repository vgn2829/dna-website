// @ts-nocheck
/**
 * PaletteStudio
 * Self-contained palette generator.
 * No external dependencies required (uses only React hooks).
 *
 * Tabler Icons (outline) loaded dynamically by PalettePage on mount.
 */

import { useState, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// COLOR SCIENCE — OKLCH, gamut mapping, sRGB conversions
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function hexToRgb(hex) {
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.slice(0, 2), 16) / 255,
    g: parseInt(c.slice(2, 4), 16) / 255,
    b: parseInt(c.slice(4, 6), 16) / 255,
  };
}

function rgbToHex(rgb) {
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function rgbToOKLCH(rgb) {
  const r = srgbToLinear(rgb.r),
    g = srgbToLinear(rgb.g),
    b = srgbToLinear(rgb.b);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073970466 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + b2 * b2);
  let H = (Math.atan2(b2, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

function oklchToRgbRaw(c) {
  const hRad = (c.H * Math.PI) / 180;
  const a = c.C * Math.cos(hRad), b = c.C * Math.sin(hRad);
  const l_ = c.L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = c.L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = c.L - 0.0894841775 * a - 1.291485548 * b;
  const lc = l_ * l_ * l_, mc = m_ * m_ * m_, sc = s_ * s_ * s_;
  return {
    r: linearToSrgb(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    g: linearToSrgb(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    b: linearToSrgb(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  };
}

function inGamut(rgb) {
  return (
    rgb.r >= -0.001 && rgb.r <= 1.001 &&
    rgb.g >= -0.001 && rgb.g <= 1.001 &&
    rgb.b >= -0.001 && rgb.b <= 1.001
  );
}

function gamutMap(color) {
  const initial = oklchToRgbRaw(color);
  if (inGamut(initial)) return { ...color };
  let lo = 0, hi = color.C;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgbRaw({ ...color, C: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...color, C: lo };
}

function oklchToHex(color) {
  const mapped = gamutMap(color);
  const rgb = oklchToRgbRaw(mapped);
  return rgbToHex({ r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) });
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESSIBILITY — WCAG luminance, contrast ratio, APCA
// ─────────────────────────────────────────────────────────────────────────────

function wcagLuminance(rgb) {
  const r = srgbToLinear(rgb.r), g = srgbToLinear(rgb.g), b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const l1 = wcagLuminance(fg), l2 = wcagLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function apcaLuminance(rgb) {
  const r = srgbToLinear(rgb.r), g = srgbToLinear(rgb.g), b = srgbToLinear(rgb.b);
  return (
    0.2126729 * Math.pow(Math.max(0, r), 2.4) +
    0.7151522 * Math.pow(Math.max(0, g), 2.4) +
    0.0721750 * Math.pow(Math.max(0, b), 2.4)
  );
}

function apcaContrast(textRgb, bgRgb) {
  const SA = { Ntxt: 0.57, Nbg: 0.56, Rtxt: 0.62, Rbg: 0.65, W: 1.14, Ofs: 0.027 };
  const Yt = apcaLuminance(textRgb), Yb = apcaLuminance(bgRgb);
  if (Yt < 0.0005 || Yt > 10 || Yb < 0.0005 || Yb > 10) return 0;
  let S =
    Yb > Yt
      ? (Math.pow(Yb, SA.Nbg) - Math.pow(Yt, SA.Ntxt)) * SA.W
      : (Math.pow(Yb, SA.Rbg) - Math.pow(Yt, SA.Rtxt)) * SA.W;
  if (Math.abs(S) < SA.Ofs) return 0;
  return S > 0 ? (S - SA.Ofs) * 100 : (S + SA.Ofs) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRAST-SEEKING LIGHTNESS
// ─────────────────────────────────────────────────────────────────────────────

function findAccessibleLightness(hue, chroma, bgHex, targetL, minCR = 4.5) {
  const bgRgb = hexToRgb(bgHex);
  const originalRgb = hexToRgb(oklchToHex(gamutMap({ L: targetL, C: chroma, H: hue })));
  if (contrastRatio(originalRgb, bgRgb) >= minCR) return targetL;
  const bgLum = wcagLuminance(bgRgb);
  const searchDark = bgLum > 0.5;
  let lo = searchDark ? 0.05 : targetL;
  let hi = searchDark ? targetL : 0.95;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const testRgb = hexToRgb(oklchToHex(gamutMap({ L: mid, C: chroma, H: hue })));
    const cr = contrastRatio(testRgb, bgRgb);
    if (cr >= minCR) {
      if (searchDark) hi = mid; else lo = mid;
    } else {
      if (searchDark) lo = mid; else hi = mid;
    }
  }
  return searchDark ? hi : lo;
}

// ─────────────────────────────────────────────────────────────────────────────
// DELTA E 2000
// ─────────────────────────────────────────────────────────────────────────────

function oklchToLab(oklch) {
  const hRad = (oklch.H * Math.PI) / 180;
  return {
    L: oklch.L * 100,
    a: oklch.C * Math.cos(hRad) * 100,
    b: oklch.C * Math.sin(hRad) * 100,
  };
}

function deltaE2000(lab1, lab2) {
  const d2r = (d) => (d * Math.PI) / 180;
  const avgL = (lab1.L + lab2.L) / 2;
  const C1 = Math.sqrt(lab1.a ** 2 + lab1.b ** 2);
  const C2 = Math.sqrt(lab2.a ** 2 + lab2.b ** 2);
  const avgC = (C1 + C2) / 2;
  const avgC7 = Math.pow(avgC, 7), p25_7 = Math.pow(25, 7);
  const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + p25_7)));
  const a1p = lab1.a * (1 + G), a2p = lab2.a * (1 + G);
  const C1p = Math.sqrt(a1p ** 2 + lab1.b ** 2);
  const C2p = Math.sqrt(a2p ** 2 + lab2.b ** 2);
  const avgCp = (C1p + C2p) / 2;
  let h1p = (Math.atan2(lab1.b, a1p) * 180) / Math.PI; if (h1p < 0) h1p += 360;
  let h2p = (Math.atan2(lab2.b, a2p) * 180) / Math.PI; if (h2p < 0) h2p += 360;
  let dhp =
    Math.abs(h1p - h2p) <= 180
      ? h2p - h1p
      : h2p <= h1p
      ? h2p - h1p + 360
      : h2p - h1p - 360;
  const dLp = lab2.L - lab1.L, dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(d2r(dhp / 2));
  const avgHp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T =
    1 - 0.17 * Math.cos(d2r(avgHp - 30)) +
    0.24 * Math.cos(d2r(2 * avgHp)) +
    0.32 * Math.cos(d2r(3 * avgHp + 6)) -
    0.2 * Math.cos(d2r(4 * avgHp - 63));
  const alm50 = (avgL - 50) ** 2;
  const SL = 1 + (0.015 * alm50) / Math.sqrt(20 + alm50);
  const SC = 1 + 0.045 * avgCp, SH = 1 + 0.015 * avgCp * T;
  const aCp7 = Math.pow(avgCp, 7), hpT = (avgHp - 275) / 25;
  const RT =
    -2 * Math.sqrt(aCp7 / (aCp7 + p25_7)) *
    Math.sin(d2r(60 * Math.exp(-(hpT ** 2))));
  const ds = dLp / SL, dcs = dCp / SC, dhs = dHp / SH;
  return Math.sqrt(ds ** 2 + dcs ** 2 + dhs ** 2 + RT * dcs * dhs);
}

// ─────────────────────────────────────────────────────────────────────────────
// HARMONY MODES
// ─────────────────────────────────────────────────────────────────────────────

export const HARMONY_MODES = {
  complementary: {
    label: "Complementary",
    description: "Bold contrast — opposite hue",
    getHues: (h) => ({ secondary: (h + 180) % 360, accent: (h + 150) % 360 }),
  },
  analogous: {
    label: "Analogous",
    description: "Harmonious — neighboring hues",
    getHues: (h) => ({ secondary: (h + 30) % 360, accent: (h - 30 + 360) % 360 }),
  },
  triadic: {
    label: "Triadic",
    description: "Vibrant — three equal hue steps",
    getHues: (h) => ({ secondary: (h + 120) % 360, accent: (h + 240) % 360 }),
  },
  splitComplementary: {
    label: "Split Comp",
    description: "Balanced — two near-complements",
    getHues: (h) => ({ secondary: (h + 150) % 360, accent: (h + 210) % 360 }),
  },
  tetradic: {
    label: "Tetradic",
    description: "Rich — four hues in a rectangle",
    getHues: (h) => ({ secondary: (h + 90) % 360, accent: (h + 270) % 360 }),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COLOR BLINDNESS SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

const CB_MATRICES = {
  protanopia:   [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  deuteranopia: [[0.625, 0.375, 0], [0.70,  0.30,  0], [0, 0.30,  0.70 ]],
  tritanopia:   [[0.95,  0.05,  0], [0,     0.433, 0.567], [0, 0.475, 0.525]],
};

function simulateCB(rgb, type) {
  const m = CB_MATRICES[type];
  return {
    r: clamp(rgb.r * m[0][0] + rgb.g * m[0][1] + rgb.b * m[0][2]),
    g: clamp(rgb.r * m[1][0] + rgb.g * m[1][1] + rgb.b * m[1][2]),
    b: clamp(rgb.r * m[2][0] + rgb.g * m[2][1] + rgb.b * m[2][2]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PALETTE DERIVATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function derivePalette(seedHex, darkMode, harmonyKey, lockedColors = {}) {
  const seedRgb = hexToRgb(seedHex);
  const seed = rgbToOKLCH(seedRgb);
  const seedChroma = seed.C;
  const seedHue = seed.H;

  const harmony = HARMONY_MODES[harmonyKey] || HARMONY_MODES.complementary;
  const { secondary: secondaryHue, accent: accentHue } = harmony.getHues(seedHue);

  const neutralHue = (seedHue + 200) % 360;

  const bgHex    = oklchToHex(gamutMap({ L: darkMode ? 0.09  : 0.985, C: 0.006, H: neutralHue }));
  const surfHex  = oklchToHex(gamutMap({ L: darkMode ? 0.13  : 0.955, C: 0.008, H: neutralHue }));
  const surf2Hex = oklchToHex(gamutMap({ L: darkMode ? 0.17  : 0.920, C: 0.009, H: neutralHue }));

  const textHex   = oklchToHex(gamutMap({ L: darkMode ? 0.94 : 0.11, C: 0.004, H: neutralHue }));
  const textMHex  = oklchToHex(gamutMap({ L: darkMode ? 0.58 : 0.44, C: 0.008, H: neutralHue }));
  const borderHex = oklchToHex(gamutMap({ L: darkMode ? 0.26 : 0.83, C: 0.007, H: neutralHue }));

  const primaryL   = findAccessibleLightness(seedHue,      seedChroma,                    bgHex, seed.L);
  const secondaryL = findAccessibleLightness(secondaryHue, seedChroma * 0.80,             bgHex, seed.L);
  const accentL    = findAccessibleLightness(accentHue,    Math.min(seedChroma * 1.1, 0.38), bgHex, seed.L);

  const primaryHex   = oklchToHex(gamutMap({ L: primaryL,   C: seedChroma,                    H: seedHue      }));
  const primaryFgHex = oklchToHex(gamutMap({ L: darkMode ? 0.10 : 0.97, C: 0.004,             H: seedHue      }));
  const secondaryHex = oklchToHex(gamutMap({ L: secondaryL, C: seedChroma * 0.80,             H: secondaryHue }));
  const accentHex    = oklchToHex(gamutMap({ L: accentL,    C: Math.min(seedChroma * 1.1, 0.38), H: accentHue }));

  const successL = findAccessibleLightness(145, 0.17, bgHex, darkMode ? 0.72 : 0.38);
  const warningL = findAccessibleLightness(75,  0.19, bgHex, darkMode ? 0.80 : 0.46);
  const errorL   = findAccessibleLightness(25,  0.23, bgHex, darkMode ? 0.72 : 0.42);
  const infoL    = findAccessibleLightness(240, 0.17, bgHex, darkMode ? 0.72 : 0.42);

  const base = {
    bg:             bgHex,
    surface:        surfHex,
    surfaceElevated: surf2Hex,
    text:           textHex,
    textMuted:      textMHex,
    border:         borderHex,
    primary:        primaryHex,
    primaryFg:      primaryFgHex,
    secondary:      secondaryHex,
    accent:         accentHex,
    success:        oklchToHex(gamutMap({ L: successL, C: 0.17, H: 145 })),
    successBg:      oklchToHex(gamutMap({ L: darkMode ? 0.15 : 0.94, C: 0.04, H: 145 })),
    warning:        oklchToHex(gamutMap({ L: warningL, C: 0.19, H: 75  })),
    warningBg:      oklchToHex(gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.04, H: 75  })),
    error:          oklchToHex(gamutMap({ L: errorL,   C: 0.23, H: 25  })),
    errorBg:        oklchToHex(gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.05, H: 25  })),
    info:           oklchToHex(gamutMap({ L: infoL,    C: 0.17, H: 240 })),
    infoBg:         oklchToHex(gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.04, H: 240 })),
  };

  Object.keys(lockedColors).forEach((k) => {
    if (lockedColors[k] && base[k] !== undefined) base[k] = lockedColors[k];
  });

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────────────────────

export function scorePalette(palette) {
  const pairs = [
    { name: "Text / BG",           fg: "text",      bg: "bg",        w: 3.0 },
    { name: "TextMuted / BG",      fg: "textMuted", bg: "bg",        w: 2.0 },
    { name: "TextMuted / Surface", fg: "textMuted", bg: "surface",   w: 1.5 },
    { name: "Primary / BG",        fg: "primary",   bg: "bg",        w: 2.0 },
    { name: "Primary / Surface",   fg: "primary",   bg: "surface",   w: 1.5 },
    { name: "PrimaryFg / Primary", fg: "primaryFg", bg: "primary",   w: 2.5 },
    { name: "Secondary / BG",      fg: "secondary", bg: "bg",        w: 1.5 },
    { name: "Accent / BG",         fg: "accent",    bg: "bg",        w: 1.5 },
    { name: "Text / Surface",      fg: "text",      bg: "surface",   w: 2.0 },
    { name: "Success / SuccessBg", fg: "success",   bg: "successBg", w: 1.0 },
    { name: "Error / ErrorBg",     fg: "error",     bg: "errorBg",   w: 1.0 },
    { name: "Warning / WarningBg", fg: "warning",   bg: "warningBg", w: 1.0 },
  ];

  let total = 0, wSum = 0;
  const pairData = {};
  for (const p of pairs) {
    const fg = hexToRgb(palette[p.fg]), bg = hexToRgb(palette[p.bg]);
    const cr = contrastRatio(fg, bg);
    const ap = Math.abs(apcaContrast(fg, bg));
    let s = cr >= 7 ? 1.0 : cr >= 4.5 ? 0.78 : cr >= 3 ? 0.42 : 0.12;
    if (ap >= 75) s = Math.min(1.0, s + 0.08);
    pairData[p.name] = { cr: cr.toFixed(2), apca: ap.toFixed(1), score: s };
    total += s * p.w;
    wSum += p.w;
  }

  const roles = ["primary", "secondary", "accent", "success", "warning", "error"];
  let dTotal = 0, dCount = 0;
  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      dTotal += Math.min(
        deltaE2000(
          oklchToLab(rgbToOKLCH(hexToRgb(palette[roles[i]]))),
          oklchToLab(rgbToOKLCH(hexToRgb(palette[roles[j]])))
        ) / 30,
        1.0
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

export function analyzeCB(palette) {
  const out = {};
  for (const type of ["protanopia", "deuteranopia", "tritanopia"]) {
    const st = simulateCB(hexToRgb(palette.text), type);
    const sb = simulateCB(hexToRgb(palette.bg), type);
    const sp = simulateCB(hexToRgb(palette.primary), type);
    out[type] = {
      textBgCR:    contrastRatio(st, sb).toFixed(2),
      primaryBgCR: contrastRatio(sp, sb).toFixed(2),
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUAL PALETTE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

function simpleColorName(hex) {
  const { L, C, H } = rgbToOKLCH(hexToRgb(hex));
  if (C < 0.04) {
    if (L > 0.90) return "White";
    if (L > 0.70) return "Light Gray";
    if (L > 0.45) return "Gray";
    if (L > 0.22) return "Dark Gray";
    return "Black";
  }
  const satWord   = C > 0.22 ? "" : C > 0.12 ? "Muted " : "Faint ";
  const lightWord = L > 0.80 ? "Light " : L < 0.28 ? "Deep " : L < 0.42 ? "Dark " : "";
  const hue =
    H < 18 || H >= 345 ? "Red"    :
    H < 45             ? "Orange" :
    H < 70             ? "Amber"  :
    H < 100            ? "Yellow" :
    H < 150            ? "Green"  :
    H < 190            ? "Teal"   :
    H < 230            ? "Cyan"   :
    H < 260            ? "Blue"   :
    H < 295            ? "Violet" :
    H < 330            ? "Pink"   : "Rose";
  return (lightWord + satWord + hue).trim();
}

function jitter(value, amount = 0.04, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value + (Math.random() - 0.5) * amount));
}

export function deriveVisualPalette(seedHex, harmonyKey = "complementary", paletteMode = "visual") {
  const { L, C, H } = rgbToOKLCH(hexToRgb(seedHex));

  const harmony = HARMONY_MODES[harmonyKey] || HARMONY_MODES.complementary;
  const { secondary: H2, accent: H3 } = harmony.getHues(H);

  // Softened harmony angles — break rigid geometry
  const H2soft = (H2 + (Math.random() - 0.5) * 25 + 360) % 360;
  const H3soft = (H3 + (Math.random() - 0.5) * 20 + 360) % 360;

  // Adaptive chroma cap — yellow-green stays clean, blue-purple gets headroom
  const chromaCap =
    H >= 60 && H <= 110  ? 0.28 :
    H >= 240 && H <= 280 ? 0.42 : 0.38;

  // Temperature-skewed neutrals — warm seed → cool slate, cool seed → warm amber
  const isWarmSeed = (H >= 0 && H <= 100) || H >= 300;
  const neutralH = isWarmSeed ? 250 : 70;

  const profiles = {
    visual: [
      { L,                                        C,                                              H       },
      { L: jitter(Math.min(L+0.15,0.85), 0.05),  C: jitter(C*0.75, 0.03, 0, chromaCap),         H: H2soft },
      { L: jitter(Math.max(L-0.15,0.15), 0.05),  C: jitter(C*0.6,  0.03, 0, chromaCap),         H       },
      { L: jitter(L,                     0.05),  C: jitter(C*0.9,  0.03, 0, chromaCap),          H: H3soft },
      { L: jitter(Math.min(L+0.28,0.93), 0.05),  C: jitter(C*0.25, 0.03, 0, chromaCap),         H: H2soft },
    ],
    poster: [
      { L: jitter(0.52, 0.05), C: jitter(Math.min(C*1.3, chromaCap), 0.03, 0, chromaCap), H       },
      { L: jitter(0.60, 0.05), C: jitter(Math.min(C*1.1, chromaCap), 0.03, 0, chromaCap), H: H2soft },
      { L: jitter(0.42, 0.05), C: jitter(Math.min(C*1.2, chromaCap), 0.03, 0, chromaCap), H: H3soft },
      { L: jitter(0.15, 0.05), C: jitter(0.015, 0.03, 0, 0.06),                           H       },
      { L: jitter(0.95, 0.05), C: jitter(0.008, 0.03, 0, 0.04),                           H       },
    ],
    luxury: [
      { L: jitter(0.12, 0.05), C: jitter(0.015,                  0.03, 0, 0.06),          H: neutralH },
      { L: jitter(0.28, 0.05), C: jitter(Math.min(C*0.5,  0.14), 0.03, 0, chromaCap),    H       },
      { L: jitter(0.48, 0.05), C: jitter(Math.min(C*0.35, 0.10), 0.03, 0, chromaCap),    H       },
      { L: jitter(0.72, 0.05), C: jitter(0.018,                  0.03, 0, 0.06),          H: neutralH },
      { L: jitter(0.88, 0.05), C: jitter(0.012,                  0.03, 0, 0.05),          H: neutralH },
    ],
    minimal: [
      { L: jitter(0.97, 0.05), C: jitter(0.004,                  0.02, 0, 0.03),          H: neutralH },
      { L: jitter(0.88, 0.05), C: jitter(0.007,                  0.02, 0, 0.04),          H: neutralH },
      { L: jitter(0.68, 0.05), C: jitter(0.010,                  0.02, 0, 0.05),          H: neutralH },
      { L: jitter(0.32, 0.05), C: jitter(0.012,                  0.02, 0, 0.05),          H: neutralH },
      { L: jitter(L,    0.05), C: jitter(Math.min(C*0.7, 0.20),  0.03, 0, chromaCap),    H       },
    ],
    cyberpunk: [
      { L: jitter(0.07, 0.04), C: jitter(0.008,                     0.02, 0, 0.04),       H       },
      { L: jitter(0.11, 0.04), C: jitter(0.012,                     0.02, 0, 0.05),       H       },
      { L: jitter(0.72, 0.05), C: jitter(Math.min(C*1.4, chromaCap), 0.03, 0, chromaCap), H       },
      { L: jitter(0.68, 0.05), C: jitter(Math.min(C*1.3, chromaCap), 0.03, 0, chromaCap), H: H2soft },
      { L: jitter(0.65, 0.05), C: jitter(Math.min(C*1.2, chromaCap), 0.03, 0, chromaCap), H: H3soft },
    ],
  };

  const swatchDefs = profiles[paletteMode] || profiles.visual;
  return swatchDefs.map((p, i) => {
    const hex = oklchToHex(gamutMap({ L: p.L, C: p.C, H: p.H }));
    return { index: i, hex, name: simpleColorName(hex) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const GRADE = (cr) => {
  const n = parseFloat(cr);
  if (n >= 7.0) return { label: "AAA", color: "#22c55e" };
  if (n >= 4.5) return { label: "AA",  color: "#84cc16" };
  if (n >= 3.0) return { label: "AA+", color: "#eab308" };
  return { label: "Fail", color: "#ef4444" };
};

const SCORE_COLOR = (s) =>
  s >= 85 ? "#22c55e" : s >= 70 ? "#84cc16" : s >= 55 ? "#eab308" : "#ef4444";

const ROLES = [
  { key: "bg",             label: "Background",        group: "base"     },
  { key: "surface",        label: "Surface",           group: "base"     },
  { key: "surfaceElevated",label: "Surface Elevated",  group: "base"     },
  { key: "text",           label: "Text",              group: "base"     },
  { key: "textMuted",      label: "Text Muted",        group: "base"     },
  { key: "border",         label: "Border",            group: "base"     },
  { key: "primary",        label: "Primary",           group: "brand"    },
  { key: "primaryFg",      label: "Primary Fg",        group: "brand"    },
  { key: "secondary",      label: "Secondary",         group: "brand"    },
  { key: "accent",         label: "Accent",            group: "brand"    },
  { key: "success",        label: "Success",           group: "semantic" },
  { key: "successBg",      label: "Success BG",        group: "semantic" },
  { key: "warning",        label: "Warning",           group: "semantic" },
  { key: "warningBg",      label: "Warning BG",        group: "semantic" },
  { key: "error",          label: "Error",             group: "semantic" },
  { key: "errorBg",        label: "Error BG",          group: "semantic" },
  { key: "info",           label: "Info",              group: "semantic" },
  { key: "infoBg",         label: "Info BG",           group: "semantic" },
];

const GROUP_LABELS = {
  base:     "Neutrals & Structure",
  brand:    "Brand Colors",
  semantic: "Semantic States",
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function PaletteStudio() {
  const [seed, setSeed]         = useState("#6366F1");
  const [darkMode, setDarkMode] = useState(false);
  const [harmony, setHarmony]   = useState("complementary");
  const [palette, setPalette]   = useState(null);
  const [fitness, setFitness]   = useState(null);
  const [cbData, setCbData]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [tab, setTab]               = useState("palette");
  const [copied, setCopied]         = useState("");
  const [locked, setLocked]         = useState({});
  const [visualMode, setVisualMode] = useState("visual");
  const [visualPalette, setVisualPalette] = useState(null);

  const generate = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      try {
        const p = derivePalette(seed, darkMode, harmony, locked);
        setPalette(p);
        setFitness(scorePalette(p));
        setCbData(analyzeCB(p));
        setVisualPalette(deriveVisualPalette(seed, harmony, visualMode));
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }, 30);
  }, [seed, darkMode, harmony, locked, visualMode]);

  const rerollVisual = useCallback(() => {
    try {
      setVisualPalette(deriveVisualPalette(seed, harmony, visualMode));
    } catch (e) {
      console.error(e);
    }
  }, [seed, harmony, visualMode]);

  const changeVisualMode = useCallback((mode) => {
    setVisualMode(mode);
    try {
      setVisualPalette(deriveVisualPalette(seed, harmony, mode));
    } catch (e) {
      console.error(e);
    }
  }, [seed, harmony]);

  const toggleLock = (key) => {
    if (!palette) return;
    setLocked((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = palette[key];
      return next;
    });
  };

  const copyColor = (hex) => {
    navigator.clipboard.writeText(hex).catch(() => {});
    setCopied(hex);
    setTimeout(() => setCopied(""), 1500);
  };

  const exportCSS = () => {
    if (!palette) return;
    const vars = Object.entries(palette)
      .map(([k, v]) => `  --color-${k.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase())}: ${v};`)
      .join("\n");
    navigator.clipboard.writeText(`:root {\n${vars}\n}`).catch(() => {});
    setCopied("css");
    setTimeout(() => setCopied(""), 2000);
  };

  const s = styles;
  const lockedCount = Object.keys(locked).length;

  return (
    <div style={s.wrap}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <header style={s.toolbar}>
        <div style={s.toolbarBrand}>
          <span style={s.eyebrow}>Color Intelligence Engine</span>
          <span style={s.pageTitle}>Palette Studio</span>
        </div>

        <div style={s.toolbarControls}>
          {/* Seed input — color picker + hex field grouped as one pill */}
          <label style={s.seedGroup} aria-label="Seed color">
            <span style={s.seedLabel}>Seed</span>
            <input
              type="color"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              style={s.colorInput}
              aria-label="Pick seed color"
            />
            <span style={s.seedDivider} aria-hidden="true" />
            <input
              type="text"
              value={seed}
              onChange={(e) => {
                if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setSeed(e.target.value);
              }}
              style={s.hexInput}
              aria-label="Hex value"
              spellCheck={false}
              maxLength={7}
            />
          </label>

          {/* Dark / light toggle */}
          <button
            onClick={() => setDarkMode((d) => !d)}
            style={s.modeBtn}
            aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
          >
            {darkMode ? "Dark" : "Light"}
          </button>

          {/* Generate — primary CTA */}
          <button
            onClick={generate}
            disabled={loading}
            style={{ ...s.generateBtn, opacity: loading ? 0.6 : 1 }}
            aria-live="polite"
          >
            {loading ? "Generating…" : "Generate"}
          </button>

          {/* Export CSS */}
          {palette && (
            <button onClick={exportCSS} style={s.exportBtn}>
              {copied === "css" ? "✓ Copied!" : "Export CSS"}
            </button>
          )}
        </div>
      </header>

      {/* ── Harmony selector ────────────────────────────────────────────────── */}
      <div style={s.harmonyBar}>
        <span style={s.harmonyLabel} aria-hidden="true">Harmony</span>
        <div style={s.harmonySegment} role="group" aria-label="Harmony mode">
          {Object.entries(HARMONY_MODES).map(([key, mode]) => (
            <button
              key={key}
              onClick={() => setHarmony(key)}
              aria-pressed={harmony === key}
              style={{ ...s.harmonyBtn, ...(harmony === key ? s.harmonyBtnActive : {}) }}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <span style={s.harmonyDesc}>{HARMONY_MODES[harmony]?.description}</span>
      </div>

      {/* ── Output tabs ─────────────────────────────────────────────────────── */}
      {palette && (
        <div style={s.tabBar} role="tablist">
          {[
            { id: "palette",       label: "Palette"       },
            { id: "accessibility", label: "Accessibility"  },
            { id: "colorblind",    label: "Color Blind"    },
            { id: "mood",          label: "Mood"           },
          ].map((t2) => (
            <button
              key={t2.id}
              role="tab"
              aria-selected={tab === t2.id}
              onClick={() => setTab(t2.id)}
              style={{ ...s.tab, ...(tab === t2.id ? s.tabActive : {}) }}
            >
              {t2.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <main style={s.content}>

        {/* Empty state */}
        {!palette && (
          <div style={s.empty}>
            <div style={s.emptyIcon} aria-hidden="true">◈</div>
            <p style={s.emptyTitle}>Pick a seed color and hit Generate</p>
            <p style={s.emptySub}>
              OKLCH · contrast-seeking lightness · 5 harmony modes · WCAG + APCA · per-slot locking
            </p>
          </div>
        )}

        {/* ── Palette tab ───────────────────────────────────────────────────── */}
        {palette && tab === "palette" && (
          <div>

            {/* Score bar */}
            {fitness && (
              <div style={s.scoreBar}>
                <div style={s.scoreBlock}>
                  <span style={s.scoreLabel}>Quality Score</span>
                  <span style={{ ...s.scoreNum, color: SCORE_COLOR(fitness.score) }}>
                    {fitness.score}
                    <span style={s.scoreOutOf}>/100</span>
                  </span>
                </div>

                <div style={s.scoreDivider} />

                <div style={s.pairGrid}>
                  {Object.entries(fitness.pairs).slice(0, 6).map(([name, data]) => {
                    const g = GRADE(data.cr);
                    return (
                      <div key={name} style={s.pairItem}>
                        <span style={s.pairName}>{name}</span>
                        <span style={s.pairRow}>
                          <span style={{ ...s.gradeChip, color: g.color, background: g.color + "22" }}>
                            {g.label}
                          </span>
                          <span style={s.pairRatio}>{data.cr}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div style={s.deltaBox}>
                  <span style={s.deltaLabel}>ΔE</span>
                  <span style={{ ...s.deltaVal, color: SCORE_COLOR(fitness.dScore) }}>
                    {fitness.dScore}%
                  </span>
                </div>
              </div>
            )}

            {/* Swatch groups */}
            {["base", "brand", "semantic"].map((group) => (
              <section key={group} style={s.swatchSection}>
                <h2 style={s.groupLabel}>{GROUP_LABELS[group]}</h2>
                <div style={s.swatchGrid}>
                  {ROLES.filter((r) => r.group === group).map((role) => {
                    const hex = palette[role.key];
                    const lum = wcagLuminance(hexToRgb(hex));
                    const onColor = lum > 0.28 ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.85)";
                    const isLocked = !!locked[role.key];
                    return (
                      <div
                        key={role.key}
                        style={{
                          ...s.swatch,
                          outline: isLocked
                            ? "2px solid #a16207"
                            : "1px solid var(--color-hairline)",
                          outlineOffset: isLocked ? 2 : 0,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = "translateY(-2px)";
                          e.currentTarget.style.boxShadow = "var(--shadow-level-1)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = "none";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        {/* Color area — click to copy */}
                        <button
                          onClick={() => copyColor(hex)}
                          aria-label={`Copy ${role.label} ${hex}`}
                          style={{ ...s.swatchColor, background: hex }}
                        >
                          <span style={{ ...s.swatchHex, color: onColor }}>
                            {copied === hex ? "✓ Copied" : hex}
                          </span>
                        </button>

                        {/* Footer row */}
                        <div style={s.swatchFoot}>
                          <span style={s.swatchName}>{role.label}</span>
                          <button
                            onClick={() => toggleLock(role.key)}
                            aria-label={`${isLocked ? "Unlock" : "Lock"} ${role.label}`}
                            style={{
                              ...s.lockBtn,
                              color: isLocked ? "#a16207" : "var(--color-ink-muted)",
                            }}
                          >
                            <i
                              className={isLocked ? "ti ti-lock" : "ti ti-lock-open"}
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {/* Lock hint */}
            {lockedCount > 0 && (
              <div style={s.lockHint}>
                <i
                  className="ti ti-lock"
                  style={{ fontSize: 12, color: "#a16207", flexShrink: 0 }}
                  aria-hidden="true"
                />
                {lockedCount} color{lockedCount > 1 ? "s" : ""} locked — regenerating preserves{" "}
                {lockedCount > 1 ? "them" : "it"}.
                <button onClick={() => setLocked({})} style={s.clearBtn}>
                  Clear all
                </button>
              </div>
            )}

            {/* Preview */}
            <hr style={s.previewDivider} />
            <h2 style={s.previewLabel}>Preview</h2>
            <Preview palette={palette} />
          </div>
        )}

        {palette && tab === "accessibility" && fitness && (
          <AccessibilityTab palette={palette} fitness={fitness} />
        )}

        {palette && tab === "colorblind" && cbData && (
          <ColorBlindTab palette={palette} cbData={cbData} />
        )}

        {palette && tab === "mood" && (
          <MoodTab
            palette={visualPalette}
            visualMode={visualMode}
            onChangeMode={changeVisualMode}
            onReroll={rerollVisual}
          />
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Preview({ palette: p }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {/* Dashboard card */}
      <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: 14, padding: 22, width: 400, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ color: p.textMuted, fontSize: 9, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 2 }}>Overview</div>
            <div style={{ color: p.text, fontSize: 16, fontWeight: 800, letterSpacing: "-.02em" }}>Dashboard</div>
          </div>
          <div style={{ background: p.primary, color: p.primaryFg, padding: "6px 12px", borderRadius: 7, fontSize: 10, fontWeight: 700 }}>+ New</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 13 }}>
          {[
            { label: "Active",  val: "12", col: p.primary },
            { label: "Done",    val: "48", col: p.success },
            { label: "Pending", val: "6",  col: p.warning },
            { label: "Issues",  val: "2",  col: p.error   },
          ].map((stat) => (
            <div key={stat.label} style={{ background: p.surface, border: `1px solid ${p.border}`, borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ color: p.textMuted, fontSize: 8, textTransform: "uppercase", letterSpacing: ".1em", opacity: .5, marginBottom: 2 }}>{stat.label}</div>
              <div style={{ color: stat.col, fontSize: 18, fontWeight: 800 }}>{stat.val}</div>
            </div>
          ))}
        </div>
        <div style={{ background: p.surfaceElevated, border: `1px solid ${p.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ color: p.text, fontSize: 11, fontWeight: 600, marginBottom: 7 }}>Recent Activity</div>
          {[
            { msg: "Deploy to production succeeded", type: "success" },
            { msg: "PR #42 awaiting review",         type: "warning" },
            { msg: "2 tests failing on main",        type: "error"   },
          ].map((a, i) => {
            const dotColor = a.type === "success" ? p.success : a.type === "warning" ? p.warning : p.error;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", borderTop: i > 0 ? `1px solid ${p.border}` : "none" }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                <span style={{ color: p.text, fontSize: 10 }}>{a.msg}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          {[
            { bg: p.primary,   fg: p.primaryFg, label: "Primary"   },
            { bg: p.secondary, fg: p.bg,         label: "Secondary" },
            { bg: p.accent,    fg: p.bg,         label: "Accent"    },
          ].map((b) => (
            <div key={b.label} style={{ flex: 1, background: b.bg, color: b.fg, padding: 8, borderRadius: 7, fontSize: 10, fontWeight: 700, textAlign: "center" }}>
              {b.label}
            </div>
          ))}
        </div>
      </div>

      {/* Typography + semantic cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 260 }}>
        <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: 14, padding: 22 }}>
          <div style={{ color: p.textMuted, fontSize: 9, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 10 }}>Typography</div>
          <div style={{ color: p.primary, fontSize: 22, fontWeight: 900, letterSpacing: "-.025em", lineHeight: 1.1, marginBottom: 4 }}>Display Heading</div>
          <div style={{ color: p.text, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Section Title</div>
          <div style={{ color: p.text, fontSize: 11, lineHeight: 1.75, marginBottom: 6 }}>Body text renders cleanly with sufficient contrast for extended reading.</div>
          <div style={{ color: p.textMuted, fontSize: 10, lineHeight: 1.65 }}>Muted helper text for metadata and secondary content.</div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {[
              { bg: p.primary,   fg: p.primaryFg, label: "Primary"   },
              { bg: p.secondary, fg: p.bg,         label: "Secondary" },
              { bg: p.accent,    fg: p.bg,         label: "Accent"    },
            ].map((t) => (
              <div key={t.label} style={{ background: t.bg, color: t.fg, padding: "3px 10px", borderRadius: 20, fontSize: 9, fontWeight: 700 }}>{t.label}</div>
            ))}
          </div>
        </div>
        <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: 14, padding: 22 }}>
          <div style={{ color: p.textMuted, fontSize: 9, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 10 }}>Semantic States</div>
          {[
            { label: "Success", color: p.success, bg: p.successBg, msg: "Deploy completed"     },
            { label: "Warning", color: p.warning, bg: p.warningBg, msg: "Session expires soon"  },
            { label: "Error",   color: p.error,   bg: p.errorBg,   msg: "Connection failed"     },
            { label: "Info",    color: p.info,    bg: p.infoBg,    msg: "New version available" },
          ].map((sem) => (
            <div key={sem.label} style={{ background: sem.bg, border: `1px solid ${sem.color}40`, borderRadius: 7, padding: "8px 10px", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: sem.color, flexShrink: 0 }} />
              <span style={{ color: sem.color, fontSize: 9, fontWeight: 700, marginRight: 5 }}>{sem.label}</span>
              <span style={{ color: p.text, fontSize: 10 }}>{sem.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccessibilityTab({ palette, fitness }) {
  const keyMap = {
    Text: "text", TextMuted: "textMuted", Primary: "primary", PrimaryFg: "primaryFg",
    Secondary: "secondary", Accent: "accent", Success: "success", Error: "error",
    Warning: "warning", BG: "bg", Surface: "surface", SuccessBg: "successBg",
    ErrorBg: "errorBg", WarningBg: "warningBg",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
      {Object.entries(fitness.pairs).map(([name, data]) => {
        const parts  = name.split(" / ");
        const fgHex  = palette[keyMap[parts[0]]] || palette.text;
        const bgHex  = palette[keyMap[parts[1]]] || palette.bg;
        const g      = GRADE(data.cr);
        const ap     = parseFloat(data.apca);
        const apColor = ap >= 75 ? "#22c55e" : ap >= 60 ? "#eab308" : "#ef4444";
        return (
          <div
            key={name}
            style={{
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-hairline)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}
          >
            {/* Live text preview on actual palette background */}
            <div style={{ background: bgHex, padding: "14px 16px", minHeight: 56, display: "flex", alignItems: "center" }}>
              <span style={{ color: fgHex, fontSize: 13, fontWeight: 500, fontFamily: "var(--font-body)" }}>
                The quick brown fox jumps
              </span>
            </div>
            {/* Metadata row */}
            <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-ink)", marginBottom: 3 }}>{name}</div>
                <div style={{ fontSize: 10, color: "var(--color-ink-muted)" }}>
                  APCA{" "}
                  <span style={{ color: apColor, fontWeight: 700 }}>{data.apca} Lc</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: g.color,
                    background: g.color + "22",
                    padding: "2px 8px",
                    borderRadius: "var(--radius-xs)",
                  }}
                >
                  {g.label}
                </span>
                <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--color-ink-muted)" }}>
                  {data.cr}:1
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColorBlindTab({ palette, cbData }) {
  const names = {
    protanopia:   "Protanopia (Red-blind)",
    deuteranopia: "Deuteranopia (Green-blind)",
    tritanopia:   "Tritanopia (Blue-blind)",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
      {Object.entries(cbData).map(([type, data]) => {
        const tCR = parseFloat(data.textBgCR), pCR = parseFloat(data.primaryBgCR);
        const tG = GRADE(tCR), pG = GRADE(pCR);
        return (
          <div
            key={type}
            style={{
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-hairline)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}
          >
            {/* Card header */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-hairline)" }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-ink-muted)", marginBottom: 3 }}>
                Simulation
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>
                {names[type]}
              </div>
            </div>
            {/* Simulated color strip */}
            <div style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", height: 36, borderRadius: "var(--radius-sm)", overflow: "hidden", marginBottom: 12 }}>
                {["bg", "surface", "primary", "secondary", "accent", "text"].map((k) => {
                  const sim = simulateCB(hexToRgb(palette[k]), type);
                  return <div key={k} style={{ flex: 1, background: rgbToHex(sim) }} />;
                })}
              </div>
              {/* Contrast rows */}
              {[
                { label: "Text on BG",    cr: data.textBgCR,    g: tG },
                { label: "Primary on BG", cr: data.primaryBgCR, g: pG },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--color-ink-muted)" }}>{row.label}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--color-ink-muted)" }}>
                      {row.cr}:1
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: row.g.color,
                        background: row.g.color + "22",
                        padding: "2px 7px",
                        borderRadius: "var(--radius-xs)",
                      }}
                    >
                      {row.g.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const VISUAL_MODES = [
  { id: "visual",    label: "Visual"    },
  { id: "poster",    label: "Poster"    },
  { id: "luxury",    label: "Luxury"    },
  { id: "minimal",   label: "Minimal"   },
  { id: "cyberpunk", label: "Cyberpunk" },
];

const VISUAL_MODE_DESCRIPTIONS = {
  visual:    "Tonal range built around the seed",
  poster:    "High-chroma mid-tones with neutrals",
  luxury:    "Restrained depth with tinted neutrals",
  minimal:   "Near-achromatic — one colour accent",
  cyberpunk: "Near-black darks with neon highlights",
};

function MoodTab({ palette, visualMode, onChangeMode, onReroll }) {
  const s = styles;
  return (
    <div>
      {/* Mode selector row */}
      <div style={s.moodBar}>
        <div style={s.harmonySegment} role="group" aria-label="Visual palette mood">
          {VISUAL_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => onChangeMode(m.id)}
              aria-pressed={visualMode === m.id}
              style={{ ...s.harmonyBtn, ...(visualMode === m.id ? s.harmonyBtnActive : {}) }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span style={s.harmonyDesc}>{VISUAL_MODE_DESCRIPTIONS[visualMode]}</span>
        <button onClick={onReroll} style={s.rerollBtn} aria-label="Re-roll visual palette">
          <i className="ti ti-refresh" aria-hidden="true" style={{ fontSize: 13 }} />
          Re-roll
        </button>
      </div>

      {/* Swatch strip */}
      {palette ? (
        <div style={s.moodGrid}>
          {palette.map((swatch) => {
            const lum = wcagLuminance(hexToRgb(swatch.hex));
            const onColor = lum > 0.28 ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.85)";
            return (
              <button
                key={swatch.index}
                onClick={() => navigator.clipboard.writeText(swatch.hex).catch(() => {})}
                aria-label={`Copy ${swatch.name} ${swatch.hex}`}
                style={{ ...s.moodSwatch, background: swatch.hex }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-3px)";
                  e.currentTarget.style.boxShadow = "var(--shadow-level-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div style={{ ...s.moodSwatchInner, color: onColor }}>
                  <span style={s.moodSwatchName}>{swatch.name}</span>
                  <span style={s.moodSwatchHex}>{swatch.hex}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={s.empty}>
          <p style={s.emptySub}>Hit Generate to build a mood palette.</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = {
  // ── Page shell ──────────────────────────────────────────────────────────────
  wrap: {
    fontFamily: "var(--font-body)",
    background: "var(--color-canvas)",
    minHeight: "100vh",
    color: "var(--color-ink)",
  },

  // ── Toolbar ─────────────────────────────────────────────────────────────────
  toolbar: {
    position: "sticky",
    top: 56,           // clears the site nav (h-14 = 56 px)
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    padding: "12px 24px",
    background: "var(--color-canvas)",
    borderBottom: "1px solid var(--color-hairline)",
  },
  toolbarBrand: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: "var(--color-ink-muted)",
    lineHeight: 1,
  },
  pageTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: "-0.5px",
    color: "var(--color-ink)",
    lineHeight: 1.15,
  },
  toolbarControls: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },

  // ── Seed input group ────────────────────────────────────────────────────────
  seedGroup: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "var(--color-surface-1)",
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--radius-pill)",
    padding: "5px 12px 5px 8px",
    cursor: "default",
  },
  seedLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: "var(--color-ink-muted)",
    userSelect: "none",
    letterSpacing: ".04em",
    lineHeight: 1,
  },
  colorInput: {
    width: 22,
    height: 22,
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    borderRadius: "var(--radius-xs)",
    outline: "none",
    flexShrink: 0,
  },
  seedDivider: {
    display: "inline-block",
    width: 1,
    height: 14,
    background: "var(--color-hairline)",
    flexShrink: 0,
  },
  hexInput: {
    background: "none",
    border: "none",
    outline: "none",
    color: "var(--color-ink)",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    width: 68,
    letterSpacing: ".04em",
    padding: 0,
    lineHeight: 1,
  },

  // ── Toolbar buttons ─────────────────────────────────────────────────────────
  modeBtn: {
    background: "var(--color-surface-1)",
    color: "var(--color-ink-muted)",
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--radius-pill)",
    padding: "7px 16px",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1,
  },
  generateBtn: {
    background: "var(--color-inverse-canvas)",
    color: "var(--color-canvas)",
    border: "none",
    borderRadius: "var(--radius-pill)",
    padding: "9px 22px",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1,
    letterSpacing: "-0.1px",
  },
  exportBtn: {
    background: "var(--color-surface-1)",
    color: "var(--color-ink-muted)",
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--radius-pill)",
    padding: "7px 16px",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1,
  },

  // ── Harmony bar ─────────────────────────────────────────────────────────────
  harmonyBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 24px",
    borderBottom: "1px solid var(--color-hairline)",
    flexWrap: "wrap",
  },
  harmonyLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".10em",
    textTransform: "uppercase",
    color: "var(--color-ink-muted)",
    flexShrink: 0,
    lineHeight: 1,
  },
  harmonySegment: {
    display: "flex",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-pill)",
    padding: 3,
    gap: 2,
  },
  harmonyBtn: {
    background: "none",
    border: "none",
    borderRadius: "var(--radius-pill)",
    padding: "5px 13px",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    color: "var(--color-ink-muted)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1,
    transition: "background .12s, color .12s",
  },
  harmonyBtnActive: {
    background: "var(--color-surface-2)",
    color: "var(--color-ink)",
  },
  harmonyDesc: {
    fontSize: 11,
    color: "var(--color-ink-muted)",
    fontStyle: "italic",
    lineHeight: 1,
  },

  // ── Tab bar ─────────────────────────────────────────────────────────────────
  tabBar: {
    display: "flex",
    padding: "0 24px",
    borderBottom: "1px solid var(--color-hairline)",
  },
  tab: {
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    padding: "12px 18px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    color: "var(--color-ink-muted)",
    cursor: "pointer",
    lineHeight: 1,
    transition: "color .12s, border-color .12s",
  },
  tabActive: {
    color: "var(--color-ink)",
    borderBottomColor: "var(--color-ink)",
  },

  // ── Content ─────────────────────────────────────────────────────────────────
  content: {
    padding: "24px",
    maxWidth: 1200,
    margin: "0 auto",
  },

  // ── Empty state ─────────────────────────────────────────────────────────────
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "96px 24px",
    textAlign: "center",
    gap: 10,
  },
  emptyIcon: {
    fontSize: 40,
    color: "var(--color-ink-muted)",
    opacity: 0.35,
    lineHeight: 1,
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "-0.3px",
    color: "var(--color-ink)",
    fontFamily: "var(--font-display)",
    margin: 0,
  },
  emptySub: {
    fontSize: 13,
    color: "var(--color-ink-muted)",
    lineHeight: 1.65,
    maxWidth: 380,
    margin: 0,
  },

  // ── Score bar ────────────────────────────────────────────────────────────────
  scoreBar: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    flexWrap: "wrap",
    background: "var(--color-surface-1)",
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--radius-lg)",
    padding: "16px 20px",
    marginBottom: 28,
  },
  scoreBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 80,
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: "var(--color-ink-muted)",
    lineHeight: 1,
  },
  scoreNum: {
    fontSize: 38,
    fontWeight: 800,
    lineHeight: 1,
    fontFamily: "var(--font-display)",
    letterSpacing: "-1.5px",
  },
  scoreOutOf: {
    fontSize: 15,
    fontWeight: 400,
    color: "var(--color-ink-muted)",
    marginLeft: 2,
    letterSpacing: 0,
  },
  scoreDivider: {
    width: 1,
    alignSelf: "stretch",
    background: "var(--color-hairline)",
    flexShrink: 0,
  },
  pairGrid: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    flex: 1,
  },
  pairItem: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  pairName: {
    fontSize: 10,
    color: "var(--color-ink-muted)",
    letterSpacing: ".04em",
    whiteSpace: "nowrap",
    lineHeight: 1,
  },
  pairRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  gradeChip: {
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: "var(--radius-xs)",
    letterSpacing: ".02em",
    lineHeight: 1.4,
  },
  pairRatio: {
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: "var(--color-ink-muted)",
    lineHeight: 1,
  },
  deltaBox: {
    marginLeft: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
  },
  deltaLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: "var(--color-ink-muted)",
    lineHeight: 1,
  },
  deltaVal: {
    fontSize: 24,
    fontWeight: 800,
    lineHeight: 1,
    fontFamily: "var(--font-display)",
    letterSpacing: "-0.5px",
  },

  // ── Swatch groups ────────────────────────────────────────────────────────────
  swatchSection: {
    marginBottom: 28,
  },
  groupLabel: {
    display: "block",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: "var(--color-ink-muted)",
    marginBottom: 12,
    lineHeight: 1,
  },
  swatchGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: 8,
  },
  swatch: {
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    background: "var(--color-surface-1)",
    transition: "transform .12s, box-shadow .12s",
  },
  swatchColor: {
    display: "flex",
    alignItems: "flex-end",
    padding: "8px 10px",
    height: 88,
    width: "100%",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  },
  swatchHex: {
    fontSize: 9,
    fontFamily: "var(--font-mono)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    lineHeight: 1,
  },
  swatchFoot: {
    background: "var(--color-surface-1)",
    padding: "7px 10px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 4,
  },
  swatchName: {
    fontSize: 11,
    fontWeight: 500,
    color: "var(--color-ink-muted)",
    lineHeight: 1.2,
  },
  lockBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px 4px",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    fontSize: 14,
    borderRadius: "var(--radius-xs)",
    flexShrink: 0,
  },

  // ── Lock hint ────────────────────────────────────────────────────────────────
  lockHint: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--color-ink-muted)",
    marginTop: 4,
    marginBottom: 20,
  },
  clearBtn: {
    background: "none",
    border: "none",
    color: "var(--color-ink)",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "var(--font-body)",
    padding: 0,
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },

  // ── Preview section ─────────────────────────────────────────────────────────
  previewDivider: {
    border: "none",
    borderTop: "1px solid var(--color-hairline)",
    margin: "28px 0 24px",
  },
  previewLabel: {
    display: "block",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: "var(--color-ink-muted)",
    marginBottom: 16,
    lineHeight: 1,
  },

  // ── Mood tab ─────────────────────────────────────────────────────────────────
  moodBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  rerollBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "var(--color-surface-1)",
    color: "var(--color-ink-muted)",
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--radius-pill)",
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
    marginLeft: "auto",
  },
  moodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 8,
  },
  moodSwatch: {
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    padding: 0,
    position: "relative",
    minHeight: 200,
    display: "block",
    transition: "transform .12s, box-shadow .12s",
  },
  moodSwatchInner: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  moodSwatchName: {
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  moodSwatchHex: {
    fontSize: 9,
    fontFamily: "var(--font-mono)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    lineHeight: 1,
    opacity: 0.85,
  },
};

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/app/components/PaletteStudio.tsx
var PaletteStudio_exports = {};
__export(PaletteStudio_exports, {
  HARMONY_MODES: () => HARMONY_MODES,
  analyzeCB: () => analyzeCB,
  default: () => PaletteStudio,
  derivePalette: () => derivePalette,
  scorePalette: () => scorePalette
});
module.exports = __toCommonJS(PaletteStudio_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}
function hexToRgb(hex) {
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.slice(0, 2), 16) / 255,
    g: parseInt(c.slice(2, 4), 16) / 255,
    b: parseInt(c.slice(4, 6), 16) / 255
  };
}
function rgbToHex(rgb) {
  return "#" + [rgb.r, rgb.g, rgb.b].map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  return c <= 31308e-7 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function rgbToOKLCH(rgb) {
  const r = srgbToLinear(rgb.r), g = srgbToLinear(rgb.g), b = srgbToLinear(rgb.b);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073970466 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + b2 * b2);
  let H = Math.atan2(b2, a) * 180 / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}
function oklchToRgbRaw(c) {
  const hRad = c.H * Math.PI / 180;
  const a = c.C * Math.cos(hRad), b = c.C * Math.sin(hRad);
  const l_ = c.L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = c.L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = c.L - 0.0894841775 * a - 1.291485548 * b;
  const lc = l_ * l_ * l_, mc = m_ * m_ * m_, sc = s_ * s_ * s_;
  return {
    r: linearToSrgb(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    g: linearToSrgb(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    b: linearToSrgb(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc)
  };
}
function inGamut(rgb) {
  return rgb.r >= -1e-3 && rgb.r <= 1.001 && rgb.g >= -1e-3 && rgb.g <= 1.001 && rgb.b >= -1e-3 && rgb.b <= 1.001;
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
  return 0.2126729 * Math.pow(Math.max(0, r), 2.4) + 0.7151522 * Math.pow(Math.max(0, g), 2.4) + 0.072175 * Math.pow(Math.max(0, b), 2.4);
}
function apcaContrast(textRgb, bgRgb) {
  const SA = { Ntxt: 0.57, Nbg: 0.56, Rtxt: 0.62, Rbg: 0.65, W: 1.14, Ofs: 0.027 };
  const Yt = apcaLuminance(textRgb), Yb = apcaLuminance(bgRgb);
  if (Yt < 5e-4 || Yt > 10 || Yb < 5e-4 || Yb > 10) return 0;
  let S = Yb > Yt ? (Math.pow(Yb, SA.Nbg) - Math.pow(Yt, SA.Ntxt)) * SA.W : (Math.pow(Yb, SA.Rbg) - Math.pow(Yt, SA.Rtxt)) * SA.W;
  if (Math.abs(S) < SA.Ofs) return 0;
  return S > 0 ? (S - SA.Ofs) * 100 : (S + SA.Ofs) * 100;
}
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
      if (searchDark) hi = mid;
      else lo = mid;
    } else {
      if (searchDark) lo = mid;
      else hi = mid;
    }
  }
  return searchDark ? hi : lo;
}
function oklchToLab(oklch) {
  const hRad = oklch.H * Math.PI / 180;
  return {
    L: oklch.L * 100,
    a: oklch.C * Math.cos(hRad) * 100,
    b: oklch.C * Math.sin(hRad) * 100
  };
}
function deltaE2000(lab1, lab2) {
  const d2r = (d) => d * Math.PI / 180;
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
  let h1p = Math.atan2(lab1.b, a1p) * 180 / Math.PI;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(lab2.b, a2p) * 180 / Math.PI;
  if (h2p < 0) h2p += 360;
  let dhp = Math.abs(h1p - h2p) <= 180 ? h2p - h1p : h2p <= h1p ? h2p - h1p + 360 : h2p - h1p - 360;
  const dLp = lab2.L - lab1.L, dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(d2r(dhp / 2));
  const avgHp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos(d2r(avgHp - 30)) + 0.24 * Math.cos(d2r(2 * avgHp)) + 0.32 * Math.cos(d2r(3 * avgHp + 6)) - 0.2 * Math.cos(d2r(4 * avgHp - 63));
  const alm50 = (avgL - 50) ** 2;
  const SL = 1 + 0.015 * alm50 / Math.sqrt(20 + alm50);
  const SC = 1 + 0.045 * avgCp, SH = 1 + 0.015 * avgCp * T;
  const aCp7 = Math.pow(avgCp, 7), hpT = (avgHp - 275) / 25;
  const RT = -2 * Math.sqrt(aCp7 / (aCp7 + p25_7)) * Math.sin(d2r(60 * Math.exp(-(hpT ** 2))));
  const ds = dLp / SL, dcs = dCp / SC, dhs = dHp / SH;
  return Math.sqrt(ds ** 2 + dcs ** 2 + dhs ** 2 + RT * dcs * dhs);
}
var HARMONY_MODES = {
  complementary: {
    label: "Complementary",
    description: "Bold contrast \u2014 opposite hue",
    getHues: (h) => ({ secondary: (h + 180) % 360, accent: (h + 150) % 360 })
  },
  analogous: {
    label: "Analogous",
    description: "Harmonious \u2014 neighboring hues",
    getHues: (h) => ({ secondary: (h + 30) % 360, accent: (h - 30 + 360) % 360 })
  },
  triadic: {
    label: "Triadic",
    description: "Vibrant \u2014 three equal hue steps",
    getHues: (h) => ({ secondary: (h + 120) % 360, accent: (h + 240) % 360 })
  },
  splitComplementary: {
    label: "Split Comp",
    description: "Balanced \u2014 two near-complements",
    getHues: (h) => ({ secondary: (h + 150) % 360, accent: (h + 210) % 360 })
  },
  tetradic: {
    label: "Tetradic",
    description: "Rich \u2014 four hues in a rectangle",
    getHues: (h) => ({ secondary: (h + 90) % 360, accent: (h + 270) % 360 })
  }
};
var CB_MATRICES = {
  protanopia: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  tritanopia: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]]
};
function simulateCB(rgb, type) {
  const m = CB_MATRICES[type];
  return {
    r: clamp(rgb.r * m[0][0] + rgb.g * m[0][1] + rgb.b * m[0][2]),
    g: clamp(rgb.r * m[1][0] + rgb.g * m[1][1] + rgb.b * m[1][2]),
    b: clamp(rgb.r * m[2][0] + rgb.g * m[2][1] + rgb.b * m[2][2])
  };
}
function derivePalette(seedHex, darkMode, harmonyKey, lockedColors = {}) {
  const seedRgb = hexToRgb(seedHex);
  const seed = rgbToOKLCH(seedRgb);
  const seedChroma = seed.C;
  const seedHue = seed.H;
  const harmony = HARMONY_MODES[harmonyKey] || HARMONY_MODES.complementary;
  const { secondary: secondaryHue, accent: accentHue } = harmony.getHues(seedHue);
  const neutralHue = (seedHue + 200) % 360;
  const bgHex = oklchToHex(gamutMap({ L: darkMode ? 0.09 : 0.985, C: 6e-3, H: neutralHue }));
  const surfHex = oklchToHex(gamutMap({ L: darkMode ? 0.13 : 0.955, C: 8e-3, H: neutralHue }));
  const surf2Hex = oklchToHex(gamutMap({ L: darkMode ? 0.17 : 0.92, C: 9e-3, H: neutralHue }));
  const textHex = oklchToHex(gamutMap({ L: darkMode ? 0.94 : 0.11, C: 4e-3, H: neutralHue }));
  const textMHex = oklchToHex(gamutMap({ L: darkMode ? 0.58 : 0.44, C: 8e-3, H: neutralHue }));
  const borderHex = oklchToHex(gamutMap({ L: darkMode ? 0.26 : 0.83, C: 7e-3, H: neutralHue }));
  const primaryL = findAccessibleLightness(seedHue, seedChroma, bgHex, seed.L);
  const secondaryL = findAccessibleLightness(secondaryHue, seedChroma * 0.8, bgHex, seed.L);
  const accentL = findAccessibleLightness(accentHue, Math.min(seedChroma * 1.1, 0.38), bgHex, seed.L);
  const primaryHex = oklchToHex(gamutMap({ L: primaryL, C: seedChroma, H: seedHue }));
  const primaryFgHex = oklchToHex(gamutMap({ L: darkMode ? 0.1 : 0.97, C: 4e-3, H: seedHue }));
  const secondaryHex = oklchToHex(gamutMap({ L: secondaryL, C: seedChroma * 0.8, H: secondaryHue }));
  const accentHex = oklchToHex(gamutMap({ L: accentL, C: Math.min(seedChroma * 1.1, 0.38), H: accentHue }));
  const successL = findAccessibleLightness(145, 0.17, bgHex, darkMode ? 0.72 : 0.38);
  const warningL = findAccessibleLightness(75, 0.19, bgHex, darkMode ? 0.8 : 0.46);
  const errorL = findAccessibleLightness(25, 0.23, bgHex, darkMode ? 0.72 : 0.42);
  const infoL = findAccessibleLightness(240, 0.17, bgHex, darkMode ? 0.72 : 0.42);
  const base = {
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
    success: oklchToHex(gamutMap({ L: successL, C: 0.17, H: 145 })),
    successBg: oklchToHex(gamutMap({ L: darkMode ? 0.15 : 0.94, C: 0.04, H: 145 })),
    warning: oklchToHex(gamutMap({ L: warningL, C: 0.19, H: 75 })),
    warningBg: oklchToHex(gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.04, H: 75 })),
    error: oklchToHex(gamutMap({ L: errorL, C: 0.23, H: 25 })),
    errorBg: oklchToHex(gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.05, H: 25 })),
    info: oklchToHex(gamutMap({ L: infoL, C: 0.17, H: 240 })),
    infoBg: oklchToHex(gamutMap({ L: darkMode ? 0.15 : 0.95, C: 0.04, H: 240 }))
  };
  Object.keys(lockedColors).forEach((k) => {
    if (lockedColors[k] && base[k] !== void 0) base[k] = lockedColors[k];
  });
  return base;
}
function scorePalette(palette) {
  const pairs = [
    { name: "Text / BG", fg: "text", bg: "bg", w: 3 },
    { name: "TextMuted / BG", fg: "textMuted", bg: "bg", w: 2 },
    { name: "TextMuted / Surface", fg: "textMuted", bg: "surface", w: 1.5 },
    { name: "Primary / BG", fg: "primary", bg: "bg", w: 2 },
    { name: "Primary / Surface", fg: "primary", bg: "surface", w: 1.5 },
    { name: "PrimaryFg / Primary", fg: "primaryFg", bg: "primary", w: 2.5 },
    { name: "Secondary / BG", fg: "secondary", bg: "bg", w: 1.5 },
    { name: "Accent / BG", fg: "accent", bg: "bg", w: 1.5 },
    { name: "Text / Surface", fg: "text", bg: "surface", w: 2 },
    { name: "Success / SuccessBg", fg: "success", bg: "successBg", w: 1 },
    { name: "Error / ErrorBg", fg: "error", bg: "errorBg", w: 1 },
    { name: "Warning / WarningBg", fg: "warning", bg: "warningBg", w: 1 }
  ];
  let total = 0, wSum = 0;
  const pairData = {};
  for (const p of pairs) {
    const fg = hexToRgb(palette[p.fg]), bg = hexToRgb(palette[p.bg]);
    const cr = contrastRatio(fg, bg);
    const ap = Math.abs(apcaContrast(fg, bg));
    let s = cr >= 7 ? 1 : cr >= 4.5 ? 0.78 : cr >= 3 ? 0.42 : 0.12;
    if (ap >= 75) s = Math.min(1, s + 0.08);
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
        1
      );
      dCount++;
    }
  }
  const dScore = dTotal / dCount;
  total += dScore * 2;
  wSum += 2;
  return {
    score: Math.round(total / wSum * 100),
    pairs: pairData,
    dScore: Math.round(dScore * 100)
  };
}
function analyzeCB(palette) {
  const out = {};
  for (const type of ["protanopia", "deuteranopia", "tritanopia"]) {
    const st = simulateCB(hexToRgb(palette.text), type);
    const sb = simulateCB(hexToRgb(palette.bg), type);
    const sp = simulateCB(hexToRgb(palette.primary), type);
    out[type] = {
      textBgCR: contrastRatio(st, sb).toFixed(2),
      primaryBgCR: contrastRatio(sp, sb).toFixed(2)
    };
  }
  return out;
}
var GRADE = (cr) => {
  const n = parseFloat(cr);
  if (n >= 7) return { label: "AAA", color: "#22c55e" };
  if (n >= 4.5) return { label: "AA", color: "#84cc16" };
  if (n >= 3) return { label: "AA+", color: "#eab308" };
  return { label: "Fail", color: "#ef4444" };
};
var SCORE_COLOR = (s) => s >= 85 ? "#22c55e" : s >= 70 ? "#84cc16" : s >= 55 ? "#eab308" : "#ef4444";
var ROLES = [
  { key: "bg", label: "Background", group: "base" },
  { key: "surface", label: "Surface", group: "base" },
  { key: "surfaceElevated", label: "Surface Elevated", group: "base" },
  { key: "text", label: "Text", group: "base" },
  { key: "textMuted", label: "Text Muted", group: "base" },
  { key: "border", label: "Border", group: "base" },
  { key: "primary", label: "Primary", group: "brand" },
  { key: "primaryFg", label: "Primary Fg", group: "brand" },
  { key: "secondary", label: "Secondary", group: "brand" },
  { key: "accent", label: "Accent", group: "brand" },
  { key: "success", label: "Success", group: "semantic" },
  { key: "successBg", label: "Success BG", group: "semantic" },
  { key: "warning", label: "Warning", group: "semantic" },
  { key: "warningBg", label: "Warning BG", group: "semantic" },
  { key: "error", label: "Error", group: "semantic" },
  { key: "errorBg", label: "Error BG", group: "semantic" },
  { key: "info", label: "Info", group: "semantic" },
  { key: "infoBg", label: "Info BG", group: "semantic" }
];
var GROUP_LABELS = {
  base: "Neutrals & Structure",
  brand: "Brand Colors",
  semantic: "Semantic States"
};
function PaletteStudio() {
  const [seed, setSeed] = (0, import_react.useState)("#6366F1");
  const [darkMode, setDarkMode] = (0, import_react.useState)(false);
  const [harmony, setHarmony] = (0, import_react.useState)("complementary");
  const [palette, setPalette] = (0, import_react.useState)(null);
  const [fitness, setFitness] = (0, import_react.useState)(null);
  const [cbData, setCbData] = (0, import_react.useState)(null);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [tab, setTab] = (0, import_react.useState)("palette");
  const [copied, setCopied] = (0, import_react.useState)("");
  const [locked, setLocked] = (0, import_react.useState)({});
  const generate = (0, import_react.useCallback)(() => {
    setLoading(true);
    setTimeout(() => {
      try {
        const p = derivePalette(seed, darkMode, harmony, locked);
        setPalette(p);
        setFitness(scorePalette(p));
        setCbData(analyzeCB(p));
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }, 30);
  }, [seed, darkMode, harmony, locked]);
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
    navigator.clipboard.writeText(hex).catch(() => {
    });
    setCopied(hex);
    setTimeout(() => setCopied(""), 1500);
  };
  const exportCSS = () => {
    if (!palette) return;
    const vars = Object.entries(palette).map(([k, v]) => `  --color-${k.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase())}: ${v};`).join("\n");
    navigator.clipboard.writeText(`:root {
${vars}
}`).catch(() => {
    });
    setCopied("css");
    setTimeout(() => setCopied(""), 2e3);
  };
  const s = styles;
  const lockedCount = Object.keys(locked).length;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.wrap, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.header, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.logo, children: "Color Intelligence Engine" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.title, children: "Palette Studio" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { flex: 1 } }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.pill, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.pillLabel, children: "Seed" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "color",
            value: seed,
            onChange: (e) => setSeed(e.target.value),
            style: s.colorInput
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "text",
            value: seed,
            onChange: (e) => {
              if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) setSeed(e.target.value);
            },
            style: s.textInput
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => setDarkMode((d) => !d), style: s.btn, children: darkMode ? "\u2B24 Dark" : "\u25CB Light" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: generate, disabled: loading, style: { ...s.btn, ...s.btnPrimary, opacity: loading ? 0.5 : 1 }, children: loading ? "Generating\u2026" : "Generate" }),
      palette && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: exportCSS, style: s.btn, children: copied === "css" ? "\u2713 Copied!" : "Export CSS" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.hbar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.hbarLabel, children: "Harmony" }),
      Object.entries(HARMONY_MODES).map(([key, mode]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          onClick: () => setHarmony(key),
          style: { ...s.hbtn, ...harmony === key ? s.hbtnActive : {} },
          children: mode.label
        },
        key
      )),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: s.hbarDesc, children: [
        "\u2192 ",
        HARMONY_MODES[harmony]?.description
      ] })
    ] }),
    palette && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.tabBar, children: ["palette", "accessibility", "colorblind"].map((t2) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        onClick: () => setTab(t2),
        style: { ...s.tab, ...tab === t2 ? s.tabActive : {} },
        children: t2 === "colorblind" ? "Color Blind" : t2.charAt(0).toUpperCase() + t2.slice(1)
      },
      t2
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.content, children: [
      !palette && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.empty, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 36, marginBottom: 12 }, children: "\u25C8" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.emptyTitle, children: "Pick a seed color and hit Generate" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.emptySub, children: "OKLCH \xB7 contrast-seeking lightness \xB7 chroma preservation \xB7 5 harmony modes \xB7 WCAG + APCA \xB7 per-slot locking" })
      ] }),
      palette && tab === "palette" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        fitness && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.scoreBar, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.scoreLabel, children: "Quality Score" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...s.scoreNum, color: SCORE_COLOR(fitness.score) }, children: [
              fitness.score,
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, fontWeight: 400, color: "#252545" }, children: "/100" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.scoreDivider }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.pairGrid, children: Object.entries(fitness.pairs).slice(0, 6).map(([name, data]) => {
            const g = GRADE(data.cr);
            return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.pairName, children: name }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 5, alignItems: "center" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 10, fontWeight: 800, color: g.color }, children: g.label }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 9, fontFamily: "monospace", color: "#2e2e4e" }, children: data.cr })
              ] })
            ] }, name);
          }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginLeft: "auto", fontSize: 9, color: "#252545" }, children: [
            "\u0394E ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: "#a5b4fc", fontWeight: 700 }, children: [
              fitness.dScore,
              "%"
            ] })
          ] })
        ] }),
        ["base", "brand", "semantic"].map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginBottom: 20 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.groupLabel, children: GROUP_LABELS[group] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.swatchGrid, children: ROLES.filter((r) => r.group === group).map((role) => {
            const hex = palette[role.key];
            const lum = wcagLuminance(hexToRgb(hex));
            const labelColor = lum > 0.28 ? "#0a0a18" : "#f0f0ff";
            const isLocked = !!locked[role.key];
            return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "div",
              {
                onClick: () => copyColor(hex),
                style: {
                  ...s.swatch,
                  border: isLocked ? "1px solid #a16207" : "1px solid #15152a"
                },
                onMouseEnter: (e) => e.currentTarget.style.transform = "translateY(-2px)",
                onMouseLeave: (e) => e.currentTarget.style.transform = "translateY(0)",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...s.swatchColor, background: hex }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 8, fontFamily: "monospace", color: labelColor, opacity: 0.75 }, children: copied === hex ? "\u2713 Copied" : hex }) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.swatchFoot, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: s.swatchName, children: role.label }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        onClick: (e) => {
                          e.stopPropagation();
                          toggleLock(role.key);
                        },
                        "aria-label": `${isLocked ? "Unlock" : "Lock"} ${role.label}`,
                        style: { ...s.lockBtn, color: isLocked ? "#a16207" : "#2e2e50" },
                        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: isLocked ? "ti ti-lock" : "ti ti-lock-open", "aria-hidden": "true" })
                      }
                    )
                  ] })
                ]
              },
              role.key
            );
          }) })
        ] }, group)),
        lockedCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: s.lockHint, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "ti ti-lock", style: { fontSize: 11, verticalAlign: -1, marginRight: 3, color: "#a16207" }, "aria-hidden": "true" }),
          lockedCount,
          " color",
          lockedCount > 1 ? "s" : "",
          " locked \u2014 regenerating preserves ",
          lockedCount > 1 ? "them" : "it",
          ".",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: () => setLocked({}), style: s.clearBtn, children: "Clear all" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("hr", { style: s.previewDivider }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: s.previewSectionLabel, children: "Preview" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Preview, { palette })
      ] }),
      palette && tab === "accessibility" && fitness && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AccessibilityTab, { palette, fitness }),
      palette && tab === "colorblind" && cbData && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ColorBlindTab, { palette, cbData })
    ] })
  ] });
}
function Preview({ palette: p }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 16, flexWrap: "wrap" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: p.bg, border: `1px solid ${p.border}`, borderRadius: 14, padding: 22, width: 400, flexShrink: 0 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.textMuted, fontSize: 9, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 2 }, children: "Overview" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.text, fontSize: 16, fontWeight: 800, letterSpacing: "-.02em" }, children: "Dashboard" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { background: p.primary, color: p.primaryFg, padding: "6px 12px", borderRadius: 7, fontSize: 10, fontWeight: 700 }, children: "+ New" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 13 }, children: [
        { label: "Active", val: "12", col: p.primary },
        { label: "Done", val: "48", col: p.success },
        { label: "Pending", val: "6", col: p.warning },
        { label: "Issues", val: "2", col: p.error }
      ].map((stat) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: p.surface, border: `1px solid ${p.border}`, borderRadius: 8, padding: "9px 11px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.textMuted, fontSize: 8, textTransform: "uppercase", letterSpacing: ".1em", opacity: 0.5, marginBottom: 2 }, children: stat.label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: stat.col, fontSize: 18, fontWeight: 800 }, children: stat.val })
      ] }, stat.label)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: p.surfaceElevated, border: `1px solid ${p.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.text, fontSize: 11, fontWeight: 600, marginBottom: 7 }, children: "Recent Activity" }),
        [
          { msg: "Deploy to production succeeded", type: "success" },
          { msg: "PR #42 awaiting review", type: "warning" },
          { msg: "2 tests failing on main", type: "error" }
        ].map((a, i) => {
          const dotColor = a.type === "success" ? p.success : a.type === "warning" ? p.warning : p.error;
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 7, padding: "3px 0", borderTop: i > 0 ? `1px solid ${p.border}` : "none" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { width: 5, height: 5, borderRadius: "50%", background: dotColor, flexShrink: 0 } }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: p.text, fontSize: 10 }, children: a.msg })
          ] }, i);
        })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", gap: 7 }, children: [
        { bg: p.primary, fg: p.primaryFg, label: "Primary" },
        { bg: p.secondary, fg: p.bg, label: "Secondary" },
        { bg: p.accent, fg: p.bg, label: "Accent" }
      ].map((b) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { flex: 1, background: b.bg, color: b.fg, padding: 8, borderRadius: 7, fontSize: 10, fontWeight: 700, textAlign: "center" }, children: b.label }, b.label)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 14, flex: 1, minWidth: 260 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: p.bg, border: `1px solid ${p.border}`, borderRadius: 14, padding: 22 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.textMuted, fontSize: 9, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 10 }, children: "Typography" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.primary, fontSize: 22, fontWeight: 900, letterSpacing: "-.025em", lineHeight: 1.1, marginBottom: 4 }, children: "Display Heading" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.text, fontSize: 14, fontWeight: 600, marginBottom: 4 }, children: "Section Title" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.text, fontSize: 11, lineHeight: 1.75, marginBottom: 6 }, children: "Body text renders cleanly with sufficient contrast for extended reading." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.textMuted, fontSize: 10, lineHeight: 1.65 }, children: "Muted helper text for metadata and secondary content." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }, children: [
          { bg: p.primary, fg: p.primaryFg, label: "Primary" },
          { bg: p.secondary, fg: p.bg, label: "Secondary" },
          { bg: p.accent, fg: p.bg, label: "Accent" }
        ].map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { background: t.bg, color: t.fg, padding: "3px 10px", borderRadius: 20, fontSize: 9, fontWeight: 700 }, children: t.label }, t.label)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: p.bg, border: `1px solid ${p.border}`, borderRadius: 14, padding: 22 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: p.textMuted, fontSize: 9, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 10 }, children: "Semantic States" }),
        [
          { label: "Success", color: p.success, bg: p.successBg, msg: "Deploy completed" },
          { label: "Warning", color: p.warning, bg: p.warningBg, msg: "Session expires soon" },
          { label: "Error", color: p.error, bg: p.errorBg, msg: "Connection failed" },
          { label: "Info", color: p.info, bg: p.infoBg, msg: "New version available" }
        ].map((sem) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: sem.bg, border: `1px solid ${sem.color}40`, borderRadius: 7, padding: "8px 10px", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { width: 5, height: 5, borderRadius: "50%", background: sem.color, flexShrink: 0 } }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: sem.color, fontSize: 9, fontWeight: 700, marginRight: 5 }, children: sem.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: p.text, fontSize: 10 }, children: sem.msg })
        ] }, sem.label))
      ] })
    ] })
  ] });
}
function AccessibilityTab({ palette, fitness }) {
  const keyMap = {
    Text: "text",
    TextMuted: "textMuted",
    Primary: "primary",
    PrimaryFg: "primaryFg",
    Secondary: "secondary",
    Accent: "accent",
    Success: "success",
    Error: "error",
    Warning: "warning",
    BG: "bg",
    Surface: "surface",
    SuccessBg: "successBg",
    ErrorBg: "errorBg",
    WarningBg: "warningBg"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 8 }, children: Object.entries(fitness.pairs).map(([name, data]) => {
    const parts = name.split(" / ");
    const fgHex = palette[keyMap[parts[0]]] || palette.text;
    const bgHex = palette[keyMap[parts[1]]] || palette.bg;
    const g = GRADE(data.cr);
    const ap = parseFloat(data.apca);
    const apColor = ap >= 75 ? "#22c55e" : ap >= 60 ? "#eab308" : "#ef4444";
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: "#0f0f1e", border: "1px solid #15152a", borderRadius: 10, overflow: "hidden" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { background: bgHex, padding: "12px 16px", minHeight: 50, display: "flex", alignItems: "center" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: fgHex, fontSize: 13, fontWeight: 500 }, children: "The quick brown fox jumps" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 10, color: "#303058", marginBottom: 2 }, children: name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 9, color: "#252545" }, children: [
            "APCA ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: apColor, fontWeight: 700 }, children: [
              data.apca,
              " Lc"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11, fontWeight: 800, color: g.color, background: g.color + "20", padding: "2px 7px", borderRadius: 5 }, children: g.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 9, fontFamily: "monospace", color: "#252545" }, children: [
            data.cr,
            ":1"
          ] })
        ] })
      ] })
    ] }, name);
  }) });
}
function ColorBlindTab({ palette, cbData }) {
  const names = {
    protanopia: "Protanopia (Red-blind)",
    deuteranopia: "Deuteranopia (Green-blind)",
    tritanopia: "Tritanopia (Blue-blind)"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }, children: Object.entries(cbData).map(([type, data]) => {
    const tCR = parseFloat(data.textBgCR), pCR = parseFloat(data.primaryBgCR);
    const tG = GRADE(tCR), pG = GRADE(pCR);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { background: "#0f0f1e", border: "1px solid #15152a", borderRadius: 10, overflow: "hidden" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "12px 16px", borderBottom: "1px solid #15152a" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 9, color: "#303058", textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 2 }, children: "Simulation" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, fontWeight: 700, color: "#a0a0c8" }, children: names[type] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", height: 32, borderRadius: 6, overflow: "hidden", marginBottom: 10 }, children: ["bg", "surface", "primary", "secondary", "accent", "text"].map((k) => {
          const sim = simulateCB(hexToRgb(palette[k]), type);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { flex: 1, background: rgbToHex(sim) } }, k);
        }) }),
        [{ label: "Text on BG", cr: data.textBgCR, g: tG }, { label: "Primary on BG", cr: data.primaryBgCR, g: pG }].map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 10, color: "#303058" }, children: row.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 9, fontFamily: "monospace", color: "#252545" }, children: [
              row.cr,
              ":1"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 10, fontWeight: 800, color: row.g.color }, children: row.g.label })
          ] })
        ] }, row.label))
      ] })
    ] }, type);
  }) });
}
var styles = {
  wrap: { fontFamily: "'Inter', system-ui, sans-serif", background: "#080810", minHeight: "100vh", color: "#ddddf0", fontSize: 13 },
  header: { borderBottom: "1px solid #15152a", padding: "16px 22px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  logo: { fontSize: 10, letterSpacing: ".16em", color: "#3a3a5e", fontWeight: 700, textTransform: "uppercase" },
  title: { fontSize: 18, fontWeight: 800, letterSpacing: "-.025em", color: "#f0f0ff", marginTop: 2 },
  pill: { background: "#0f0f1e", border: "1px solid #1e1e32", borderRadius: 9, padding: "6px 11px", display: "flex", alignItems: "center", gap: 7 },
  pillLabel: { fontSize: 10, color: "#444466" },
  colorInput: { width: 26, height: 26, border: "none", background: "none", cursor: "pointer", borderRadius: 5 },
  textInput: { background: "none", border: "1px solid #1e1e32", borderRadius: 6, padding: "3px 7px", color: "#d0d0f0", fontSize: 11, fontFamily: "monospace", width: 76 },
  btn: { background: "#0f0f1e", color: "#6060a0", border: "1px solid #1e1e32", borderRadius: 8, padding: "7px 14px", fontSize: 11, cursor: "pointer", fontWeight: 600 },
  btnPrimary: { background: "#5254d0", color: "#fff", borderColor: "transparent" },
  hbar: { borderBottom: "1px solid #15152a", padding: "8px 22px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
  hbarLabel: { fontSize: 9, color: "#2e2e4e", letterSpacing: ".16em", textTransform: "uppercase", fontWeight: 700, marginRight: 4 },
  hbtn: { background: "none", border: "1px solid #15152a", borderRadius: 6, padding: "4px 10px", fontSize: 10, cursor: "pointer", color: "#383868", fontWeight: 600 },
  hbtnActive: { background: "#1a1a30", color: "#a5b4fc", borderColor: "#5254d0" },
  hbarDesc: { fontSize: 9, color: "#252545", marginLeft: 4 },
  tabBar: { borderBottom: "1px solid #15152a", padding: "0 22px", display: "flex" },
  tab: { background: "none", border: "none", borderBottom: "2px solid transparent", color: "#353560", padding: "11px 16px", fontSize: 11, cursor: "pointer", fontWeight: 600 },
  tabActive: { color: "#a5b4fc", borderBottomColor: "#5254d0" },
  content: { padding: 22 },
  empty: { textAlign: "center", padding: "60px 24px", color: "#252545" },
  emptyTitle: { fontSize: 14, fontWeight: 600, color: "#303058", marginBottom: 5 },
  emptySub: { fontSize: 11, lineHeight: 1.7, maxWidth: 400, margin: "0 auto" },
  scoreBar: { background: "#0f0f1e", border: "1px solid #15152a", borderRadius: 10, padding: "14px 18px", marginBottom: 20, display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" },
  scoreLabel: { fontSize: 9, color: "#353560", letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 3 },
  scoreNum: { fontSize: 30, fontWeight: 900, lineHeight: 1 },
  scoreDivider: { width: 1, height: 38, background: "#15152a" },
  pairGrid: { display: "flex", gap: 14, flexWrap: "wrap" },
  pairName: { fontSize: 9, color: "#353560", letterSpacing: ".07em", marginBottom: 2 },
  groupLabel: { fontSize: 9, letterSpacing: ".16em", color: "#252545", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 },
  swatchGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 7, marginBottom: 22 },
  swatch: { borderRadius: 9, overflow: "hidden", cursor: "pointer", transition: "transform .1s" },
  swatchColor: { height: 62, display: "flex", alignItems: "flex-end", padding: "5px 8px" },
  swatchFoot: { background: "#0f0f1e", padding: "5px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  swatchName: { fontSize: 9, color: "#4a4a6e", lineHeight: 1.2 },
  lockBtn: { background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, display: "flex", alignItems: "center", fontSize: 13 },
  lockHint: { fontSize: 10, color: "#3a3a3a", marginTop: 4 },
  clearBtn: { background: "none", border: "none", color: "#5254d0", cursor: "pointer", fontSize: 10, marginLeft: 6 },
  previewDivider: { border: "none", borderTop: "1px solid #15152a", margin: "28px 0 24px" },
  previewSectionLabel: { fontSize: 9, letterSpacing: ".16em", color: "#252545", textTransform: "uppercase", fontWeight: 700, marginBottom: 16 }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HARMONY_MODES,
  analyzeCB,
  derivePalette,
  scorePalette
});

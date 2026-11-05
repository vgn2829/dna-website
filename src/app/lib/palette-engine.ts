import { ColorSpace, parse, to, toGamut, contrastWCAG21, deltaE2000, getLuminance, sRGB, OKLCH, OKLab, Lab } from 'colorjs.io/fn';
// Register only the spaces needed by the functional API. APCA is not imported into the product bundle.
for (const space of [sRGB, OKLCH, OKLab, Lab]) ColorSpace.register(space);
const rgbColor = (rgb: RGB) => ({ space: sRGB, coords: [rgb.r, rgb.g, rgb.b] as [number, number, number], alpha: 1 });
export type RGB = { r: number; g: number; b: number };
export type OKLCH = { L: number; C: number; H: number };
export type RolePalette = Record<string, string>;
export type CreativeSwatch = { index: number; hex: string; name: string };
export function clamp(v: number, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }
export function validHex(value: unknown): value is string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
export function hexToRgb(hex: string): RGB {
  if (!validHex(hex)) throw new Error('Enter a six-digit hex colour, for example #6366F1');
  const [r, g, b] = to(parse(hex), sRGB).coords; return { r: Number(r), g: Number(g), b: Number(b) };
}
export function rgbToHex(rgb: RGB): string {
  return '#' + [rgb.r, rgb.g, rgb.b].map(v => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function rgbToOKLCH(rgb: RGB): OKLCH {
  const [L, C, hue] = to(rgbColor(rgb), OKLCH).coords;
  return { L: Number(L), C: Number(C), H: typeof hue === "number" && Number.isFinite(hue) ? hue : 0 };
}
export function oklchToHex(c: OKLCH): string {
  const color = to({ space: OKLCH, coords: [clamp(c.L), Math.max(0, c.C), c.H], alpha: 1 }, sRGB);
  toGamut(color, { space: sRGB, method: 'oklch.c' });
  const [r, g, b] = color.coords; return rgbToHex({ r: Number(r), g: Number(g), b: Number(b) });
}
export function wcagLuminance(c: RGB) { return getLuminance(rgbColor(c)); }
export function contrastRatio(a: RGB, b: RGB) { return contrastWCAG21(rgbColor(a), rgbColor(b)); }
export function contrast(a: string, b: string) { return contrastRatio(hexToRgb(a), hexToRgb(b)); }
export function foreground(background: string) { return contrast('#000000', background) >= contrast('#FFFFFF', background) ? '#000000' : '#FFFFFF'; }
export const HARMONY_MODES: Record<string, { label: string; description: string; getHues: (h: number) => { secondary: number; accent: number } }> = Object.fromEntries([
  ['complementary', 'Complementary', 180, 150], ['analogous', 'Analogous', 30, 330],
  ['triadic', 'Triadic', 120, 240], ['splitComplementary', 'Split Comp', 150, 210], ['tetradic', 'Tetradic', 90, 270],
].map(([key, label, secondary, accent]) => [key, { label: String(label), description: `OKLCH hue offsets +${secondary}° / +${accent}°`, getHues: (h: number) => ({ secondary: (h + Number(secondary)) % 360, accent: (h + Number(accent)) % 360 }) }]));
/** Seeded PRNG, scoped to a generation; never mutates global randomness. */
export function seededRandom(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => { state += 0x6D2B79F5; let n = Math.imul(state ^ state >>> 15, 1 | state); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
/** Searches BOTH directions against rounded, gamut-mapped output, returning the closest feasible lightness. */
export function findContrast(hue: number, chroma: number, background: string, target: number, minimum = 4.5) {
  if (!Number.isFinite(minimum) || minimum < 1 || minimum > 21) throw new Error('Contrast target must be between 1 and 21');
  const original = oklchToHex({ L: target, C: chroma, H: hue });
  if (contrast(original, background) >= minimum) return { hex: original, possible: true };
  const candidates: { hex: string; distance: number }[] = [];
  for (const edge of [0, 1]) {
    if (contrast(oklchToHex({ L: edge, C: chroma, H: hue }), background) < minimum) continue;
    let fail = target, pass = edge;
    for (let i = 0; i < 28; i++) {
      const mid = (fail + pass) / 2;
      if (contrast(oklchToHex({ L: mid, C: chroma, H: hue }), background) >= minimum) pass = mid; else fail = mid;
    }
    candidates.push({ hex: oklchToHex({ L: pass, C: chroma, H: hue }), distance: Math.abs(pass - target) });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.length ? { hex: candidates[0].hex, possible: true } : { hex: foreground(background), possible: false };
}
export const ROLE_PAIRS = [
  ['Text / BG', 'text', 'bg'], ['TextMuted / BG', 'textMuted', 'bg'], ['TextMuted / Surface', 'textMuted', 'surface'],
  ['Primary / BG', 'primary', 'bg'], ['Primary / Surface', 'primary', 'surface'], ['PrimaryFg / Primary', 'primaryFg', 'primary'],
  ['Secondary / BG', 'secondary', 'bg'], ['Accent / BG', 'accent', 'bg'], ['Text / Surface', 'text', 'surface'],
  ['Text / SurfaceElevated', 'text', 'surfaceElevated'], ['TextMuted / SurfaceElevated', 'textMuted', 'surfaceElevated'],
  ['Success / SuccessBg', 'success', 'successBg'], ['Error / ErrorBg', 'error', 'errorBg'], ['Warning / WarningBg', 'warning', 'warningBg'], ['Info / InfoBg', 'info', 'infoBg'],
];
export function repairRoles(palette: RolePalette, locked: RolePalette = {}) {
  const result = { ...palette, ...locked };
  for (const [fg, backgrounds] of [
    ['text', ['bg', 'surface', 'surfaceElevated']], ['textMuted', ['bg', 'surface', 'surfaceElevated']], ['primary', ['bg', 'surface']],
    ['secondary', ['bg']], ['accent', ['bg']], ['success', ['successBg']], ['warning', ['warningBg']], ['error', ['errorBg']], ['info', ['infoBg']],
  ] as [string, string[]][]) {
    if (locked[fg]) continue;
    const start = rgbToOKLCH(hexToRgb(result[fg]));
    const candidates = Array.from({ length: 1001 }, (_, i) => i / 1000).sort((a, b) => Math.abs(a - start.L) - Math.abs(b - start.L));
    if (backgrounds.every(bg => contrast(result[fg], result[bg]) >= 4.5)) continue;
    for (const L of candidates) {
      const hex = oklchToHex({ ...start, L });
      if (backgrounds.every(bg => contrast(hex, result[bg]) >= 4.5)) { result[fg] = hex; break; }
    }
  }
  if (!locked.primaryFg) result.primaryFg = foreground(result.primary);
  return result;
}
export function derivePalette(seedHex: string, darkMode: boolean, harmonyKey: string, lockedColors: RolePalette = {}, randomSeed = seedHex): RolePalette {
  const seed = rgbToOKLCH(hexToRgb(seedHex));
  const harmony = Object.prototype.hasOwnProperty.call(HARMONY_MODES, harmonyKey) ? HARMONY_MODES[harmonyKey] : null; if (!harmony) throw new Error('Unknown harmony');
  for (const value of Object.values(lockedColors)) hexToRgb(value);
  const random = seededRandom(randomSeed), hues = harmony.getHues(seed.H), C = Math.min(.22, seed.C);
  const make = (L: number, chroma = .008, H = seed.H) => oklchToHex({ L, C: chroma, H });
  const bg = make(darkMode ? .12 : .98), palette: RolePalette = {
    bg, surface: make(darkMode ? .17 : .95), surfaceElevated: make(darkMode ? .22 : .92),
    text: make(darkMode ? .95 : .13), textMuted: make(darkMode ? .72 : .4), border: make(darkMode ? .4 : .76),
    primary: findContrast(seed.H, C, bg, seed.L).hex, primaryFg: '#FFFFFF',
    secondary: findContrast(hues.secondary, C * .7, bg, .50 + random() * .12).hex,
    accent: findContrast(hues.accent, C * .9, bg, .55 + random() * .1).hex,
  };
  for (const [key, H] of [['success', 145], ['warning', 75], ['error', 25], ['info', 240]] as const) {
    palette[key + 'Bg'] = make(darkMode ? .20 : .94, .035, H);
    palette[key] = findContrast(H, .16, palette[key + 'Bg'], darkMode ? .75 : .4).hex;
  }
  const validLocks = Object.fromEntries(Object.entries(lockedColors).filter(([key]) => Object.prototype.hasOwnProperty.call(palette, key)));
  return repairRoles(palette, validLocks);
}
export function scorePalette(palette: RolePalette) {
  const pairs: Record<string, { cr: string; score: number }> = {};
  for (const [name, fg, bg] of ROLE_PAIRS) {
    const cr = contrast(palette[fg], palette[bg]); pairs[name] = { cr: cr.toFixed(2), score: cr >= 4.5 ? 1 : 0 };
  }
  const roles = ['primary', 'secondary', 'accent']; let total = 0, count = 0;
  for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) { total += Math.min(1, deltaE2000(palette[roles[i]], palette[roles[j]]) / 30); count++; }
  return { score: Math.round(Object.values(pairs).filter(p => p.score).length / ROLE_PAIRS.length * 100), pairs, dScore: Math.round(total / count * 100) };
}
export function paletteWarnings(palette: RolePalette) { return ROLE_PAIRS.filter(([, fg, bg]) => contrast(palette[fg], palette[bg]) < 4.5).map(([name]) => `${name} is below 4.5:1. Unlock or edit these roles to resolve the constraint.`); }
export function deriveVisualPalette(seedHex: string, harmonyKey = 'complementary', paletteMode = 'visual', randomSeed = seedHex): CreativeSwatch[] {
  const seed = rgbToOKLCH(hexToRgb(seedHex)), harmony = HARMONY_MODES[harmonyKey]; if (!harmony) throw new Error('Unknown harmony');
  const random = seededRandom(randomSeed), hues = harmony.getHues(seed.H);
  const offsets = paletteMode === 'exploratory' ? [(random() - .5) * 60, (random() - .5) * 60] : [0, 0];
  const tones: Record<string, number[]> = { visual: [.62, .78, .24, .54, .94], poster: [.52, .64, .36, .16, .95], luxury: [.14, .30, .49, .73, .91], minimal: [.98, .87, .66, .30, .58], cyberpunk: [.1, .19, .74, .68, .63] };
  const chromaProfiles: Record<string, number[]> = {
    visual: [1, .6, .35, .8, .08], poster: [1, .95, .85, .04, .02],
    luxury: [.02, .3, .4, .08, .03], minimal: [.015, .025, .04, .04, .8], cyberpunk: [.025, .035, 1, .9, .8],
  };
  const hueProfiles: Record<string, number[]> = {
    poster: [seed.H, hues.secondary, hues.accent, seed.H, seed.H],
    luxury: [seed.H, seed.H, hues.accent, hues.secondary, seed.H],
    minimal: [seed.H, seed.H, seed.H, seed.H, hues.accent],
    cyberpunk: [seed.H, seed.H, seed.H, hues.secondary, hues.accent],
  };
  const lights = tones[paletteMode] || tones.visual;
  const chromas = chromaProfiles[paletteMode] || chromaProfiles.visual;
  return lights.map((L, index) => {
    const H = (hueProfiles[paletteMode] || [seed.H, hues.secondary + offsets[0], seed.H, hues.accent + offsets[1], seed.H])[index];
    const C = Math.min(.24, seed.C) * chromas[index];
    const hex = oklchToHex({ L: clamp(L + (random() - .5) * .025), C, H });
    return { index, hex, name: ['Anchor', 'Companion', 'Shade', 'Accent', 'Paper'][index] };
  });
}

const CB_MATRICES: Record<string, number[][]> = {
  protanopia:   [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  deuteranopia: [[0.625, 0.375, 0], [0.70,  0.30,  0], [0, 0.30,  0.70 ]],
  tritanopia:   [[0.95,  0.05,  0], [0,     0.433, 0.567], [0, 0.475, 0.525]],
};

function simulateCB(rgb: RGB, type: string) {
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


export { simulateCB };
export function analyzeCB(palette: RolePalette) {
 const out: Record<string, { textBgCR: string; primaryBgCR: string }> = {};
 for (const type of ["protanopia", "deuteranopia", "tritanopia"]) { const bg = simulateCB(hexToRgb(palette.bg), type); out[type] = { textBgCR: contrastRatio(simulateCB(hexToRgb(palette.text), type), bg).toFixed(2), primaryBgCR: contrastRatio(simulateCB(hexToRgb(palette.primary), type), bg).toFixed(2) }; } return out;
}

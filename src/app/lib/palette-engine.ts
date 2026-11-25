import { ColorSpace, deltaE2000, sRGB, OKLCH as OKLCHSpace, OKLab, Lab } from 'colorjs.io/fn';
import * as color from './palette/color';
import { simulateCB as brettel, type Deficiency } from './palette/simulation';
// Colour.js is used only for CIEDE2000 in scorePalette. Conversion, gamut
// mapping and WCAG contrast come from the shared ./palette/color module, so the
// generation path and the editor facade apply one fixture-validated policy.
for (const space of [sRGB, OKLCHSpace, OKLab, Lab]) ColorSpace.register(space);
export type RGB = { r: number; g: number; b: number };
export type OKLCH = { L: number; C: number; H: number };
export type RolePalette = Record<string, string>;
export type CreativeSwatch = { index: number; hex: string; name: string };
export function clamp(v: number, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }
export function validHex(value: unknown): value is string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
export function hexToRgb(hex: string): RGB {
  if (!validHex(hex)) throw new Error('Enter a six-digit hex colour, for example #6366F1');
  return color.hexToRgb(hex);
}
export const rgbToHex = color.rgbToHex;
export const rgbToOKLCH = color.rgbToOKLCH;
/** Achromatic threshold: below this OKLCH chroma a colour has no usable hue. */
export const ACHROMATIC_CHROMA = 0.02;
/** Normalises out-of-range requests (L outside 0–1, negative C, any hue angle) before the shared fixed-L/H chroma reduction. */
export function gamutMapOKLCH(c: OKLCH): OKLCH {
  return color.gamutMap({ L: clamp(c.L), C: Math.max(0, c.C), H: ((c.H % 360) + 360) % 360 });
}
export function oklchToHex(c: OKLCH): string { return color.oklchToHex(gamutMapOKLCH(c)); }
const hexToOKLCH = (hex: string) => rgbToOKLCH(hexToRgb(hex));
/** CSS-ready OKLCH string, e.g. `oklch(62.4% 0.181 276.2)`. */
export function formatOKLCH(hex: string) {
  const { L, C, H } = hexToOKLCH(hex);
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${C < 1e-4 ? 0 : H.toFixed(1)})`;
}
export function wcagLuminance(c: RGB) { return color.wcagLuminance(c); }
export function contrastRatio(a: RGB, b: RGB) { return color.contrastRatio(a, b); }
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
  const random = seededRandom(randomSeed), C = Math.min(.22, seed.C);
  // A grey seed has no hue to build a harmony from. Primary stays neutral (it is
  // the user's choice); secondary/accent keep the selected harmony angles around
  // a hue chosen by the reproducible variation, so Generate still explores.
  const achromatic = seed.C < ACHROMATIC_CHROMA, anchorHue = achromatic ? random() * 360 : seed.H;
  const hues = harmony.getHues(anchorHue), brandC = achromatic ? .12 : C;
  // Neutrals carry a faint seed tint; a grey seed has no hue, so its neutrals stay exactly grey.
  const make = (L: number, chroma = achromatic ? 0 : .008, H = seed.H) => oklchToHex({ L, C: chroma, H });
  const bg = make(darkMode ? .12 : .98), palette: RolePalette = {
    bg, surface: make(darkMode ? .17 : .95), surfaceElevated: make(darkMode ? .22 : .92),
    text: make(darkMode ? .95 : .13), textMuted: make(darkMode ? .72 : .4), border: make(darkMode ? .4 : .76),
    primary: findContrast(seed.H, C, bg, seed.L).hex, primaryFg: '#FFFFFF',
    secondary: findContrast(hues.secondary, brandC * .7, bg, .50 + random() * .12).hex,
    accent: findContrast(hues.accent, brandC * .9, bg, .55 + random() * .1).hex,
  };
  // Status colours: [role, hue, target L light, target L dark]. Success and error
  // differ in lightness as well as hue — at equal lightness the pair was nearly
  // indistinguishable under simulated deuteranopia. Success is the lighter of the
  // two in light mode (protanopia darkens reds, so a lighter red would converge)
  // and the brighter in dark mode. Targets were chosen to clear all three Brettel
  // simulations without adding brand↔status collisions; findContrast still
  // guarantees ≥4.5:1 against each status background.
  for (const [key, H, lightL, darkL] of [['success', 150, .44, .92], ['warning', 75, .4, .75], ['error', 25, .28, .76], ['info', 240, .4, .75]] as const) {
    palette[key + 'Bg'] = make(darkMode ? .20 : .94, .035, H);
    palette[key] = findContrast(H, .16, palette[key + 'Bg'], darkMode ? darkL : lightL).hex;
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
/** Creative palette personalities. Tones/chroma are per swatch; hue slots name harmony roles. */
type CreativeProfile = { label: string; description: string; roles: string[]; tones: number[]; chroma: number[]; hueSlots: ('seed' | 'secondary' | 'accent')[]; jitter: number; floor: number; anchorIsSeed?: boolean; relaxed?: boolean };
export const CREATIVE_MODES: Record<string, CreativeProfile> = {
  visual: { label: 'Visual', description: 'Your exact seed with a tonal range built around it', roles: ['Anchor', 'Companion', 'Shade', 'Accent', 'Paper'], tones: [.62, .78, .24, .54, .94], chroma: [1, .6, .35, .8, .08], hueSlots: ['seed', 'secondary', 'seed', 'accent', 'seed'], jitter: .06, floor: .06, anchorIsSeed: true },
  minimal: { label: 'Minimal', description: 'Tinted neutrals with one deliberate colour accent', roles: ['Paper', 'Mist', 'Stone', 'Ink', 'Accent'], tones: [.98, .87, .66, .30, .58], chroma: [.015, .025, .04, .04, .8], hueSlots: ['seed', 'seed', 'seed', 'seed', 'accent'], jitter: .03, floor: .12 },
  poster: { label: 'Poster', description: 'Saturated mid-tones carried by ink and paper', roles: ['Lead', 'Support', 'Punch', 'Ink', 'Paper'], tones: [.52, .64, .36, .16, .95], chroma: [1, .95, .85, .04, .02], hueSlots: ['seed', 'secondary', 'accent', 'seed', 'seed'], jitter: .05, floor: .14 },
  luxury: { label: 'Luxury', description: 'Deep tinted darks, one jewel tone and warm ivory', roles: ['Base', 'Depth', 'Jewel', 'Patina', 'Ivory'], tones: [.14, .30, .49, .73, .91], chroma: [.02, .3, .4, .08, .03], hueSlots: ['seed', 'seed', 'accent', 'secondary', 'seed'], jitter: .04, floor: .06 },
  cyberpunk: { label: 'Cyberpunk', description: 'Near-black panels lit by three neon highlights', roles: ['Void', 'Panel', 'Neon', 'Glow', 'Spark'], tones: [.1, .19, .74, .68, .63], chroma: [.025, .035, 1, .9, .8], hueSlots: ['seed', 'seed', 'seed', 'secondary', 'accent'], jitter: .035, floor: .16 },
  exploratory: { label: 'Exploratory', description: 'Visual, with harmony angles relaxed by up to ±30°', roles: ['Anchor', 'Companion', 'Shade', 'Accent', 'Paper'], tones: [.62, .78, .24, .54, .94], chroma: [1, .6, .35, .8, .08], hueSlots: ['seed', 'secondary', 'seed', 'accent', 'seed'], jitter: .06, floor: .06, anchorIsSeed: true, relaxed: true },
};
/** Highest in-gamut chroma at a lightness/hue. */
const maxChroma = (L: number, H: number) => gamutMapOKLCH({ L, C: .5, H }).C;
/**
 * sRGB cannot hold saturated yellows/greens when dark or blues when light. For a
 * vivid slot, step lightness outward (never hue) up to ±window until 75% of the
 * requested chroma fits; otherwise use the most chromatic lightness found.
 */
function fitVividTone(L: number, C: number, H: number, window = .15) {
  let best = L, bestC = maxChroma(L, H);
  if (bestC >= C * .75) return L;
  for (let d = .01; d <= window + 1e-9; d += .01) for (const candidate of [L - d, L + d]) {
    const t = clamp(candidate, .04, .985), available = maxChroma(t, H);
    if (available >= C * .75) return t;
    if (available > bestC) { best = t; bestC = available; }
  }
  return best;
}
/**
 * Five-swatch creative palette. Each variation moves tones and chroma inside the
 * mode's personality while named harmonies keep their exact hue angles.
 * `locked` (keyed by swatch index) is returned byte-identical. Random draws are
 * made for every slot, locked or not, so locking one swatch never shifts others.
 */
export function deriveVisualPalette(seedHex: string, harmonyKey = 'complementary', paletteMode = 'visual', randomSeed = seedHex, locked: Record<string, string> = {}): CreativeSwatch[] {
  const seed = rgbToOKLCH(hexToRgb(seedHex)), harmony = Object.prototype.hasOwnProperty.call(HARMONY_MODES, harmonyKey) ? HARMONY_MODES[harmonyKey] : null; if (!harmony) throw new Error('Unknown harmony');
  for (const value of Object.values(locked)) hexToRgb(value);
  const profile = Object.prototype.hasOwnProperty.call(CREATIVE_MODES, paletteMode) ? CREATIVE_MODES[paletteMode] : CREATIVE_MODES.visual;
  const random = seededRandom(randomSeed), achromatic = seed.C < ACHROMATIC_CHROMA;
  // Grey seeds: seed-representing swatches stay neutral; chromatic slots use a variation-chosen hue.
  const baseH = achromatic ? random() * 360 : seed.H, hues = harmony.getHues(baseH);
  const offsets = profile.relaxed ? [(random() - .5) * 60, (random() - .5) * 60] : [0, 0];
  const baseC = Math.min(.24, Math.max(achromatic ? .12 : seed.C, profile.floor));
  const slotHue = { seed: baseH, secondary: hues.secondary + offsets[0], accent: hues.accent + offsets[1] };
  return profile.tones.map((tone, index) => {
    const L = clamp(tone + (random() - .5) * 2 * profile.jitter, .04, .985), chromaScale = .85 + random() * .3;
    const name = profile.roles[index];
    if (validHex(locked[index])) return { index, hex: locked[index].toUpperCase(), name };
    if (index === 0 && profile.anchorIsSeed) return { index, hex: seedHex.toUpperCase(), name };
    // A grey seed has no hue: muted swatches that represent the seed (seed hue slot,
    // profile chroma < .5 — e.g. Visual Shade/Paper, Luxury Depth) stay neutral.
    // Vivid seed slots (Poster Lead, Cyberpunk Neon) keep a variation-chosen hue.
    const neutralSeedSlot = achromatic && profile.hueSlots[index] === 'seed' && profile.chroma[index] < .5;
    const C = neutralSeedSlot ? 0 : baseC * profile.chroma[index] * chromaScale, H = slotHue[profile.hueSlots[index]];
    return { index, hex: oklchToHex({ L: profile.chroma[index] >= .5 ? fitVividTone(L, C, H) : L, C, H }), name };
  });
}
/** A pleasant, reproducible random seed (mid lightness, moderate chroma). */
export function randomSeedColour(variation: string) {
  const random = seededRandom(`seed:${variation}`);
  return oklchToHex({ H: random() * 360, L: .5 + random() * .25, C: .1 + random() * .1 });
}

// ── Colour-vision deficiency simulation ─────────────────────────────────────
// Delegates to the Brettel 1997 / libDaltonLens model in ./palette/simulation
// (linear light, full dichromacy) so every Palette Studio path uses one model.
function simulateCB(rgb: RGB, type: string): RGB {
  if (type !== 'protanopia' && type !== 'deuteranopia' && type !== 'tritanopia') throw new Error('Unknown colour-vision deficiency');
  return brettel(rgb, type as Deficiency);
}
export { simulateCB };
export function analyzeCB(palette: RolePalette) {
 const out: Record<string, { textBgCR: string; primaryBgCR: string }> = {};
 for (const type of ["protanopia", "deuteranopia", "tritanopia"]) { const bg = simulateCB(hexToRgb(palette.bg), type); out[type] = { textBgCR: contrastRatio(simulateCB(hexToRgb(palette.text), type), bg).toFixed(2), primaryBgCR: contrastRatio(simulateCB(hexToRgb(palette.primary), type), bg).toFixed(2) }; } return out;
}

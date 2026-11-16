import { describe, expect, test } from 'vitest';
import Color from 'colorjs.io';
import { contrast, derivePalette, deriveVisualPalette, findContrast, foreground, HARMONY_MODES, paletteWarnings, rgbToOKLCH, hexToRgb, oklchToHex } from './palette-engine';
describe('colour reference and role contracts', () => {
  test('WCAG reference ratios and sRGB / OKLCH round trips', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 8);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.478, 3);
    for (const hex of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#6366F1']) expect(oklchToHex(rgbToOKLCH(hexToRgb(hex)))).toBe(hex);
    expect(Color.deltaE2000(new Color('lab', [50, 2.6772, -79.7751]), new Color('lab', [50, 0, -82.7485]))).toBeCloseTo(2.0425, 4);
  });
  test('generation is seeded, handles extremes, and every declared role meets body contrast', () => {
    for (const seed of ['#000000', '#FFFFFF', '#808080', '#FF0000', '#00FF00', '#0000FF']) for (const mode of Object.keys(HARMONY_MODES)) for (const dark of [true, false]) {
      const palette = derivePalette(seed, dark, mode, {}, 'repeatable');
      expect(palette).toEqual(derivePalette(seed, dark, mode, {}, 'repeatable'));
      expect(paletteWarnings(palette)).toEqual([]);
    }
  });
  test('locked conflicts are preserved and explained; dependents repair', () => {
    const palette = derivePalette('#6366F1', false, 'triadic', { bg: '#FFFFFF', text: '#FFFFFF', primary: '#F2F2F2' });
    expect(palette.text).toBe('#FFFFFF'); expect(paletteWarnings(palette).join(' ')).toContain('Text / BG');
    expect(palette.primaryFg).toBe('#000000'); expect(foreground('#000000')).toBe('#FFFFFF');
  });
  test('contrast searches both directions and reports impossible target', () => {
    for (const bg of ['#FFFFFF', '#000000', '#777777']) {
      const found = findContrast(280, .2, bg, .6, 4.5); expect(found.possible).toBe(true); expect(contrast(found.hex, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(findContrast(280, .2, '#777777', .6, 21).possible).toBe(false);
    expect(() => derivePalette('#12zz34', false, 'triadic')).toThrow();
    expect(() => derivePalette('#123456', false, 'unknown')).toThrow();
    expect(() => findContrast(0, .1, '#FFFFFF', .5, 30)).toThrow();
  });
  test('creative palettes repeat and preserve selected hue relationships', () => {
    const a = deriveVisualPalette('#6366F1', 'triadic', 'visual', 'seed');
    expect(a).toEqual(deriveVisualPalette('#6366F1', 'triadic', 'visual', 'seed'));
    expect(a).not.toEqual(deriveVisualPalette('#6366F1', 'triadic', 'visual', 'another'));
    const h = (hex: string) => rgbToOKLCH(hexToRgb(hex)).H;
    expect(((h(a[1].hex) - h(a[0].hex)) + 360) % 360).toBeCloseTo(120, 0);
  });
});
test('creative profiles reserve chroma and tonal hierarchy intentionally', () => {
  const minimal = deriveVisualPalette('#6366F1', 'triadic', 'minimal', 'profile');
  const chroma = (hex: string) => rgbToOKLCH(hexToRgb(hex)).C;
  expect(chroma(minimal[4].hex)).toBeGreaterThan(.1);
  expect(minimal.slice(0, 4).every(s => chroma(s.hex) < .02)).toBe(true);
  const poster = deriveVisualPalette('#6366F1', 'triadic', 'poster', 'profile');
  expect(chroma(poster[2].hex)).toBeGreaterThan(chroma(poster[3].hex));
});

// ── Palette Studio professional upgrade: generation contracts ────────────────
import { ACHROMATIC_CHROMA, CREATIVE_MODES, formatOKLCH, gamutMapOKLCH, randomSeedColour, simulateCB } from './palette-engine';
import { gamutMap, oklchToHex as sharedOklchToHex } from './palette/color';
import { simulateCB as brettel } from './palette/simulation';
const lch = (hex: string) => rgbToOKLCH(hexToRgb(hex));
const hueDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const SEEDS = ['#6366F1', '#FF006E', '#00C853', '#FF6B00', '#0EA5E9', '#E5D3B3', '#8B0000', '#FFFF00'];

describe('shared conversion policy', () => {
  test('generation uses the fixture-validated fixed-L/H mapping of ./palette/color', () => {
    for (let H = 0; H < 360; H += 15) for (const L of [.2, .5, .8, .95]) {
      const c = { L, C: .4, H };
      expect(oklchToHex(c)).toBe(sharedOklchToHex(c));
      expect(gamutMapOKLCH(c)).toEqual(gamutMap(c));
    }
    expect(oklchToHex({ L: 1.4, C: .3, H: 40 })).toBe('#FFFFFF');
    expect(oklchToHex({ L: -1, C: .3, H: 40 })).toBe('#000000');
    expect(gamutMapOKLCH({ L: .5, C: .1, H: -30 }).H).toBe(330);
    expect(formatOKLCH('#777777')).toMatch(/^oklch\(\d+\.\d% 0\.000 0\)$/);
  });
  test('harmony angles survive role generation within 3° (was up to ~5° with the colorjs clip)', () => {
    for (const seed of SEEDS) for (const mode of Object.keys(HARMONY_MODES)) for (const dark of [true, false]) {
      const p = derivePalette(seed, dark, mode, {}, 'harmony'), hues = HARMONY_MODES[mode].getHues(lch(seed).H);
      for (const [key, expected] of [['secondary', hues.secondary], ['accent', hues.accent]] as const)
        if (lch(p[key]).C >= .04) expect(hueDiff(lch(p[key]).H, expected)).toBeLessThan(3);
    }
  });
  test('colour-vision simulation is the Brettel 1997 model used by the editor', () => {
    for (const type of ['protanopia', 'deuteranopia', 'tritanopia']) for (const hex of SEEDS) expect(simulateCB(hexToRgb(hex), type)).toEqual(brettel(hexToRgb(hex), type as 'protanopia'));
    expect(() => simulateCB(hexToRgb('#FF0000'), 'achromatopsia')).toThrow();
  });
});

describe('achromatic seeds', () => {
  test('neutrals stay exactly grey (no hue-0 rose tint) and brand roles get real harmony hues', () => {
    for (const seed of ['#000000', '#808080', '#FFFFFF', '#777777']) for (const mode of Object.keys(HARMONY_MODES)) for (const dark of [true, false]) {
      const p = derivePalette(seed, dark, mode, {}, 'grey');
      for (const role of ['bg', 'surface', 'surfaceElevated', 'text', 'textMuted', 'border']) expect(lch(p[role]).C).toBeLessThan(.002);
      expect(lch(p.primary).C).toBeLessThan(ACHROMATIC_CHROMA);
      expect(lch(p.secondary).C).toBeGreaterThan(.05); expect(lch(p.accent).C).toBeGreaterThan(.05);
      const offsets = HARMONY_MODES[mode].getHues(0);
      expect(hueDiff((lch(p.accent).H - lch(p.secondary).H + 360) % 360, (offsets.accent - offsets.secondary + 360) % 360)).toBeLessThan(4);
      expect(paletteWarnings(p)).toEqual([]);
    }
    expect(derivePalette('#808080', false, 'triadic', {}, 'a').secondary).not.toBe(derivePalette('#808080', false, 'triadic', {}, 'b').secondary);
  });
  test('chromatic seeds keep their faint neutral tint', () => {
    expect(lch(derivePalette('#6366F1', false, 'triadic').bg).C).toBeGreaterThan(.004);
  });
});

describe('mood palettes', () => {
  test('every mode is deterministic, varies with the variation, names its roles and keeps harmony hues', () => {
    for (const seed of SEEDS) for (const mode of Object.keys(CREATIVE_MODES)) for (const harmony of Object.keys(HARMONY_MODES)) {
      const a = deriveVisualPalette(seed, harmony, mode, 'one');
      expect(a).toEqual(deriveVisualPalette(seed, harmony, mode, 'one'));
      expect(a.map(s => s.hex)).not.toEqual(deriveVisualPalette(seed, harmony, mode, 'two').map(s => s.hex));
      expect(a.map(s => s.name)).toEqual(CREATIVE_MODES[mode].roles);
      if (CREATIVE_MODES[mode].relaxed) continue;
      const hues = HARMONY_MODES[harmony].getHues(lch(seed).H), expected = { seed: lch(seed).H, ...hues };
      a.forEach((s, i) => { if (lch(s.hex).C >= .04) expect(hueDiff(lch(s.hex).H, expected[CREATIVE_MODES[mode].hueSlots[i]])).toBeLessThan(3); });
    }
  });
  test('each mode keeps its personality across many variations', () => {
    for (let v = 0; v < 40; v++) {
      const seed = SEEDS[v % SEEDS.length], vv = `p${v}`;
      const visual = deriveVisualPalette(seed, 'triadic', 'visual', vv);
      expect(visual[0].hex).toBe(seed);
      expect(lch(visual[2].hex).L).toBeLessThan(.35); expect(lch(visual[4].hex).L).toBeGreaterThan(.85);
      const minimal = deriveVisualPalette(seed, 'triadic', 'minimal', vv);
      expect(minimal.slice(0, 4).every(s => lch(s.hex).C < .02)).toBe(true); expect(lch(minimal[4].hex).C).toBeGreaterThan(.07);
      const poster = deriveVisualPalette(seed, 'triadic', 'poster', vv);
      expect(poster.slice(0, 3).every(s => lch(s.hex).C > .08)).toBe(true); expect(lch(poster[3].hex).L).toBeLessThan(.25); expect(lch(poster[4].hex).L).toBeGreaterThan(.88);
      const luxury = deriveVisualPalette(seed, 'triadic', 'luxury', vv);
      expect(lch(luxury[0].hex).L).toBeLessThan(.2); expect(lch(luxury[4].hex).L).toBeGreaterThan(.85); expect(lch(luxury[2].hex).C).toBeGreaterThan(lch(luxury[3].hex).C);
      const cyber = deriveVisualPalette(seed, 'triadic', 'cyberpunk', vv);
      expect(cyber.slice(0, 2).every(s => lch(s.hex).L < .25)).toBe(true); expect(cyber.slice(2).every(s => lch(s.hex).C > .1 && lch(s.hex).L > .55)).toBe(true);
    }
  });
  test('locked swatches stay exact and locking one never moves the others', () => {
    const base = deriveVisualPalette('#6366F1', 'triadic', 'poster', 'lock');
    const locked = deriveVisualPalette('#6366F1', 'triadic', 'poster', 'lock', { 2: '#ABCDEF' });
    expect(locked[2].hex).toBe('#ABCDEF');
    expect(locked.filter((_, i) => i !== 2)).toEqual(base.filter((_, i) => i !== 2));
    expect(deriveVisualPalette('#FF006E', 'analogous', 'poster', 'other', { 2: '#ABCDEF', 4: '#101010' }).map(s => s.hex).filter((_, i) => i === 2 || i === 4)).toEqual(['#ABCDEF', '#101010']);
    expect(() => deriveVisualPalette('#6366F1', 'triadic', 'poster', 'x', { 1: 'red' })).toThrow();
  });
  test('grey seeds still produce chromatic mood swatches; random seeds are reproducible', () => {
    expect(deriveVisualPalette('#808080', 'complementary', 'cyberpunk', 'g').slice(2).every(s => lch(s.hex).C > .1)).toBe(true);
    expect(randomSeedColour('abc')).toBe(randomSeedColour('abc'));
    expect(randomSeedColour('abc')).not.toBe(randomSeedColour('abd'));
  });
});

// ── Verification finding F: success/error distinguishability ────────────────
import { okDistance, semanticCollisions } from './palette/contrast';
import { rgbToHex } from './palette-engine';
const F_SEEDS = ['#16A34A', '#00C853', '#DC2626', '#FF0000', '#2563EB', '#0000FF', '#EAB308', '#FFFF00', '#06B6D4', '#00FFFF', '#9333EA', '#6366F1', '#808080', '#000000', '#FFFFFF', '#FF6B00', '#E5D3B3'];
const simHex = (hex: string, type: string) => rgbToHex(simulateCB(hexToRgb(hex), type));
describe('success and error stay distinguishable (34-palette evidence set)', () => {
  test('separated after Brettel simulation, by lightness as well as hue, with ≥4.5:1 contrast', () => {
    for (const seed of F_SEEDS) for (const dark of [false, true]) {
      const p = derivePalette(seed, dark, 'triadic');
      for (const type of ['protanopia', 'deuteranopia', 'tritanopia']) expect(okDistance(simHex(p.success, type), simHex(p.error, type))).toBeGreaterThan(.12);
      expect(okDistance(p.success, p.error)).toBeGreaterThan(.2);
      // Lightness alone separates them (hue is lost to dichromacy).
      expect(Math.abs(lch(p.success).L - lch(p.error).L)).toBeGreaterThan(.12);
      for (const role of ['success', 'error']) for (const bg of [`${role}Bg`, 'surface', 'bg']) expect(contrast(p[role], p[bg])).toBeGreaterThanOrEqual(4.5);
      expect(semanticCollisions(p).some(c => [c.a, c.b].sort().join() === 'error,success')).toBe(false);
    }
  });
  test('the new status lightness does not make brand colours collide with success or error', () => {
    for (const seed of F_SEEDS) for (const harmony of Object.keys(HARMONY_MODES)) for (const dark of [false, true]) {
      const collisions = semanticCollisions(derivePalette(seed, dark, harmony)).filter(c => c.condition === 'typical vision');
      expect(collisions.filter(c => c.b === 'success' || c.b === 'error')).toEqual([]);
    }
  });
  test('locked success/error colours always win; the unlocked partner still meets contrast', () => {
    for (const dark of [false, true]) {
      const lockedSuccess = derivePalette('#6366F1', dark, 'triadic', { success: '#C0392B' });
      expect(lockedSuccess.success).toBe('#C0392B');
      expect(contrast(lockedSuccess.error, lockedSuccess.errorBg)).toBeGreaterThanOrEqual(4.5);
      const lockedError = derivePalette('#6366F1', dark, 'triadic', { error: '#123456' });
      expect(lockedError.error).toBe('#123456');
      expect(contrast(lockedError.success, lockedError.successBg)).toBeGreaterThanOrEqual(4.5);
      const both = derivePalette('#6366F1', dark, 'triadic', { success: '#2E8B57', error: '#C0392B' });
      expect([both.success, both.error]).toEqual(['#2E8B57', '#C0392B']);
      // A locked pair that converges under deuteranopia is reported, never silently changed.
      expect(semanticCollisions(both).some(c => c.condition === 'deuteranopia' && [c.a, c.b].sort().join() === 'error,success')).toBe(true);
    }
  });
});

// ── Verification finding D: achromatic seeds in creative modes ──────────────
describe('grey, black and white seeds across all six creative modes', () => {
  const GREYS = ['#808080', '#000000', '#FFFFFF'];
  test('swatches that represent the seed stay neutral; harmony and vivid slots stay chromatic', () => {
    for (const seed of GREYS) for (const mode of Object.keys(CREATIVE_MODES)) for (const variation of ['a', 'b', 'verify']) {
      const profile = CREATIVE_MODES[mode], swatches = deriveVisualPalette(seed, 'triadic', mode, variation);
      swatches.forEach((s, i) => {
        const C = lch(s.hex).C;
        if (i === 0 && profile.anchorIsSeed) expect(s.hex).toBe(seed);
        else if (profile.hueSlots[i] === 'seed' && profile.chroma[i] < .5) expect(C).toBeLessThan(1e-4);
        else if (profile.chroma[i] >= .3) expect(C).toBeGreaterThan(.03);
        else expect(C).toBeGreaterThan(.003); // muted harmony slot (Luxury Patina): tinted, not forced grey
      });
    }
  });
  test('named regressions: Visual/Exploratory Shade and Luxury Depth are neutral; Minimal stays neutral', () => {
    for (const seed of GREYS) {
      for (const mode of ['visual', 'exploratory']) {
        const shade = deriveVisualPalette(seed, 'triadic', mode, 'verify').find(s => s.name === 'Shade')!;
        expect(lch(shade.hex).C).toBeLessThan(1e-4);
      }
      expect(lch(deriveVisualPalette(seed, 'triadic', 'luxury', 'verify').find(s => s.name === 'Depth')!.hex).C).toBeLessThan(1e-4);
      const minimal = deriveVisualPalette(seed, 'triadic', 'minimal', 'verify');
      expect(minimal.slice(0, 4).every(s => lch(s.hex).C < 1e-4)).toBe(true);
      expect(lch(minimal[4].hex).C).toBeGreaterThan(.05);
    }
  });
  test('Poster Lead and Cyberpunk Neon are never neutralised', () => {
    for (const seed of GREYS) for (const variation of ['a', 'b', 'c', 'verify']) {
      expect(lch(deriveVisualPalette(seed, 'triadic', 'poster', variation).find(s => s.name === 'Lead')!.hex).C).toBeGreaterThan(.08);
      expect(lch(deriveVisualPalette(seed, 'triadic', 'cyberpunk', variation).find(s => s.name === 'Neon')!.hex).C).toBeGreaterThan(.1);
    }
  });
  test('chromatic seeds are unaffected', () => {
    const before = { visual: deriveVisualPalette('#6366F1', 'triadic', 'visual', 'x'), luxury: deriveVisualPalette('#6366F1', 'triadic', 'luxury', 'x') };
    expect(lch(before.visual.find(s => s.name === 'Shade')!.hex).C).toBeGreaterThan(.03);
    expect(lch(before.luxury.find(s => s.name === 'Depth')!.hex).C).toBeGreaterThan(.03);
  });
});

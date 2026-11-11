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

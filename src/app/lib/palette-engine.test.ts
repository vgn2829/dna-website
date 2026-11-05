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

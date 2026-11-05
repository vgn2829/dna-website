import { expect, test } from 'vitest';
import { dotRadius, halftoneGeometry, halftoneSvg, type HalftoneOptions } from './halftone-logic';
const options: HalftoneOptions = { type: 'squares', frequency: 10, resolution: 4, angle: 0, contrast: 100, brightness: 100, inverted: false, color: '#000000', backgroundColor: '#ffffff', minWidth: 0, maxWidth: 1 };
function image(width: number, height: number, value: number, alpha = 255) { return { width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? alpha : value) } as ImageData; }
test('black and white endpoints, alpha composited onto paper', () => {
  expect(halftoneGeometry(image(700, 350, 255), options).shapes).toHaveLength(0);
  expect(halftoneGeometry(image(700, 350, 0, 0), options).shapes).toHaveLength(0);
  expect(halftoneGeometry(image(700, 350, 0, 0), { ...options, backgroundColor: '#FF00FF', inverted: true, brightness: 0 }).shapes).toHaveLength(0);
  expect(halftoneGeometry(image(700, 350, 0), options).shapes[0].width).toBe(10);
  expect(halftoneGeometry(image(700, 350, 0, 128), options).shapes[0].width).toBeCloseTo(Math.sqrt(128 / 255) * 10, 5);
});
test('cell averaging uses all pixels and tone controls covered area', () => {
  const pixels = image(700, 350, 0);
  for (let i = 0; i < pixels.data.length; i += 4) { const value = (i / 4) % 2 ? 255 : 0; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; }
  const shape = halftoneGeometry(pixels, options).shapes.find(s => s.x === 0 && s.y === 0)!;
  expect(shape.width ** 2 / 100).toBeCloseTo(.5, 6);
});
test('dot calibration covers entire tonal range including overlapping disks', () => {
  expect(dotRadius(0)).toBe(0); expect(dotRadius(Math.PI / 4)).toBeCloseTo(.5, 6); expect(dotRadius(1)).toBeCloseTo(Math.SQRT1_2, 6);
});
test('resolution independent geometry and SVG share shapes', () => {
  const a = halftoneGeometry(image(700, 350, 128), { ...options, angle: 37 });
  const b = halftoneGeometry(image(1400, 700, 128), { ...options, angle: 37 });
  const centerA = a.shapes.find(s => s.x === 0 && s.y === 0)!, centerB = b.shapes.find(s => s.x === 0 && s.y === 0)!;
  expect(centerB.width).toBeCloseTo(centerA.width * 2, 6);
  const svg = halftoneSvg(b, options); expect(svg).toContain('width="1400"'); expect(svg).toContain('rotate(37)'); expect(svg).toContain('<path d='); expect(svg).toContain('rotate(37)');
});
test('limits reject invalid and pathological settings', () => {
  expect(() => halftoneGeometry(image(1, 1, 0), { ...options, frequency: 0 })).toThrow();
  expect(() => halftoneGeometry(image(1, 1, 0), { ...options, color: '<script>' })).toThrow();
  expect(() => halftoneGeometry({ width: 10000, height: 10000 } as ImageData, options)).toThrow();
});

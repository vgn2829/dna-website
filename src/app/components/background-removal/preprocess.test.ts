import { expect, test } from 'vitest';
import { modelInputDimensions } from './preprocess';
import { MODELS } from './models';
test('model input geometry respects validated static and dynamic exports', () => {
  expect(modelInputDimensions(2000, 1000, MODELS.general)).toEqual({ width: 320, height: 320 });
  expect(modelInputDimensions(1200, 800, MODELS.portrait)).toEqual({ width: 768, height: 512 });
  expect(modelInputDimensions(800, 1200, MODELS.portrait)).toEqual({ width: 512, height: 768 });
  for (const [w, h] of [[2560, 1], [1, 2560], [1, 1], [900, 500]]) {
    const size = modelInputDimensions(w, h, MODELS.portrait);
    expect(size.width % 32).toBe(0); expect(size.height % 32).toBe(0);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1024);
    expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(32);
  }
});

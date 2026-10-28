import type { RGB } from "./engine";
// Brettel 1997, Smith/Pokorny 1975, sRGB white neutral; full dichromacy.
// Precomputed coefficients: public-domain libDaltonLens (Nicolas Burrus).
// https://github.com/DaltonLens/libDaltonLens/blob/master/libDaltonLens.c
const MODELS = {
  protanopia: {
    a: [
      0.1498, 1.19548, -0.34528, 0.10764, 0.84864, 0.04372, 0.00384, -0.0054,
      1.00156,
    ],
    b: [
      0.1457, 1.16172, -0.30742, 0.10816, 0.85291, 0.03892, 0.00386, -0.00524,
      1.00139,
    ],
    n: [0.00048, 0.00393, -0.00441],
  },
  deuteranopia: {
    a: [
      0.36477, 0.86381, -0.22858, 0.26294, 0.64245, 0.09462, -0.02006, 0.02728,
      0.99278,
    ],
    b: [
      0.37298, 0.88166, -0.25464, 0.25954, 0.63506, 0.1054, -0.0198, 0.02784,
      0.99196,
    ],
    n: [-0.00281, -0.00611, 0.00892],
  },
  tritanopia: {
    a: [
      1.01277, 0.13548, -0.14826, -0.01243, 0.86812, 0.14431, 0.07589, 0.805,
      0.11911,
    ],
    b: [
      0.93678, 0.18979, -0.12657, 0.06154, 0.81526, 0.1232, -0.37562, 1.12767,
      0.24796,
    ],
    n: [0.03901, -0.02788, -0.01113],
  },
};
export type Deficiency = keyof typeof MODELS;
export function simulateCB(rgb: RGB, type: Deficiency): RGB {
  const decode = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const encode = (v: number) =>
    Math.max(
      0,
      Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055),
    );
  const c = [rgb.r, rgb.g, rgb.b].map(decode),
    model = MODELS[type];
  const m =
    model.n.reduce((sum, v, i) => sum + v * c[i], 0) >= 0 ? model.a : model.b;
  const out = [0, 3, 6].map((i) =>
    encode(m[i] * c[0] + m[i + 1] * c[1] + m[i + 2] * c[2]),
  );
  return { r: out[0], g: out[1], b: out[2] };
}

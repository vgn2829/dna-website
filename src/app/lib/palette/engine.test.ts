import { describe, expect, it } from "vitest";
import {
  apcaContrast,
  contrastRatio,
  deltaOK,
  derivePalette,
  deriveVisualPalette,
  findAccessibleLightness,
  gamutMap,
  hexToRgb,
  normalizeHex,
  oklchToHex,
  rgbToHex,
  rgbToOKLCH,
  scorePalette,
  simulateCB,
} from "./engine";
const rgb = hexToRgb;
describe("independent colour reference fixtures", () => {
  it.each([
    ["#000000", "#FFFFFF", 21],
    ["#777777", "#FFFFFF", 4.478089453577214],
    ["#123456", "#123456", 1],
  ] as const)("WCAG %s / %s", (a, b, expected) =>
    expect(contrastRatio(rgb(a), rgb(b))).toBeCloseTo(expected, 10),
  );
  // apca-w3 upstream SHA256 and fixture-generation method: references.md.
  it.each([
    ["#000000", "#FFFFFF", 106.04067321268862],
    ["#FFFFFF", "#000000", -107.88473318309848],
    ["#777777", "#FFFFFF", 71.11110332561125],
    ["#0C0C0C", "#0E0E0E", 0],
    ["#C8C8C8", "#1E1E1E", -71.45797894427486],
  ] as const)("APCA %s / %s", (a, b, expected) =>
    expect(apcaContrast(rgb(a), rgb(b))).toBeCloseTo(expected, 9),
  );
  it("uses Euclidean OKLab distance with native units, not CIEDE2000", () => {
    expect(deltaOK({ L: 0, a: 0, b: 0 }, { L: 1, a: 0, b: 0 })).toBe(1);
    expect(
      deltaOK({ L: 0.5, a: 0.1, b: 0.2 }, { L: 0.5, a: 0.4, b: 0.6 }),
    ).toBeCloseTo(0.5, 12);
    expect(
      deltaOK({ L: 0.5, a: 0.1, b: 0.2 }, { L: 0.5, a: 0.1, b: 0.2 }),
    ).toBe(0);
  });
  it("matches the published OKLab red conversion and 8-bit round trips", () => {
    expect(rgbToOKLCH(rgb("#FF0000")).L).toBeCloseTo(0.6279553606, 8);
    for (const hex of [
      "#000000",
      "#FFFFFF",
      "#FF0000",
      "#00FF00",
      "#0000FF",
      "#777777",
    ])
      expect(oklchToHex(rgbToOKLCH(rgb(hex)))).toBe(hex);
    expect(gamutMap({ L: 0.6, C: 1, H: 40 }).C).toBeLessThan(1);
    expect(() => gamutMap({ L: NaN, C: 1, H: 40 })).toThrow();
  });
  // Frozen output of libDaltonLens.c compiled independently with cc, severity 1.
  const cvd = [
    ["protanopia", "#FF0000", "#6B5C0C"],
    ["protanopia", "#00FF00", "#FFED00"],
    ["protanopia", "#0000FF", "#0037FF"],
    ["protanopia", "#782DC8", "#0048C8"],
    ["deuteranopia", "#FF0000", "#A48B00"],
    ["deuteranopia", "#00FF00", "#F1D02E"],
    ["deuteranopia", "#0000FF", "#0056FE"],
    ["deuteranopia", "#782DC8", "#0061C6"],
    ["tritanopia", "#FF0000", "#FF004D"],
    ["tritanopia", "#00FF00", "#78E9FF"],
    ["tritanopia", "#0000FF", "#006288"],
    ["tritanopia", "#782DC8", "#5C5A5A"],
  ] as const;
  it.each(cvd)("Brettel reference %s %s", (type, input, output) => {
    const actual = rgb(rgbToHex(simulateCB(rgb(input), type)));
    const expected = rgb(output);
    for (const key of ["r", "g", "b"] as const)
      expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(
        1 / 255 + 1e-9,
      );
  });
});
describe("generation contracts", () => {
  it.each(["", "#12", "#ggffff", "#0z1122", "#12345"])(
    "rejects incomplete/invalid seed %s",
    (seed) => expect(() => derivePalette(seed, false, "triadic")).toThrow(),
  );
  it("normalizes documented shorthand and optional prefix", () =>
    expect(normalizeHex(" abc ")).toBe("#AABBCC"));
  it("is deterministic and preserves locked bytes while recalculating dependent foreground", () => {
    expect(derivePalette("#6366F1", false, "triadic")).toEqual(
      derivePalette("#6366F1", false, "triadic"),
    );
    const p = derivePalette("#FF0000", false, "triadic", {
      primary: "#FFFF00",
      accent: "#123456",
    });
    expect(p.primary).toBe("#FFFF00");
    expect(p.accent).toBe("#123456");
    expect(
      contrastRatio(rgb(p.primary), rgb(p.primaryFg)),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it("finds the nearest passing lightness in either direction", () => {
    const l = findAccessibleLightness(0, 0, "#FFFFFF", 0.8);
    expect(l).toBeGreaterThan(0.5);
    expect(l).toBeLessThan(0.8);
    expect(
      contrastRatio(rgb(oklchToHex({ L: l, C: 0, H: 0 })), rgb("#FFFFFF")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(findAccessibleLightness(0, 0, "#000000", 0.2)).toBeGreaterThan(0.2);
  });
  it("has reproducible moods when supplied a random source", () =>
    expect(
      deriveVisualPalette("#6366F1", "triadic", "poster", () => 0.5),
    ).toEqual(deriveVisualPalette("#6366F1", "triadic", "poster", () => 0.5)));
  it("retains raw ratios and covers actual preview role pairs", () => {
    const f = scorePalette(derivePalette("#6366F1", false, "triadic"));
    expect(typeof f.pairs["Text / BG"].cr).toBe("number");
    expect(f.pairs["Info / InfoBg"]).toBeDefined();
    expect(f.pairs["Text / SurfaceElevated"]).toBeDefined();
  });
});

// Independently converted with ColorAide 8.13.1, not this engine.
const gamutReferences = [
  {
    input: {
      L: 0.6,
      C: 1,
      H: 40,
    },
    mapped_C: 0.18840811770762625,
    hex: "#D84A00",
  },
  {
    input: {
      L: 0.7,
      C: 0.4,
      H: 150,
    },
    mapped_C: 0.19282437839231348,
    hex: "#00BE58",
  },
  {
    input: {
      L: 0.5,
      C: 0.4,
      H: 280,
    },
    mapped_C: 0.28894420840684,
    hex: "#571AFF",
  },
  {
    input: {
      L: 0.95,
      C: 0.4,
      H: 100,
    },
    mapped_C: 0.10883512192901965,
    hex: "#FFF199",
  },
  {
    input: {
      L: 0.05,
      C: 0.4,
      H: 240,
    },
    mapped_C: 0.021065420989117373,
    hex: "#000002",
  },
];
it.each(gamutReferences)(
  "fixed-lightness/chroma gamut reference $hex",
  ({ input, mapped_C, hex }) => {
    expect(gamutMap(input).C).toBeCloseTo(mapped_C, 6);
    expect(oklchToHex(input)).toBe(hex);
  },
);
it.each(["#000000", "#777777", "#FFFFFF"])(
  "uses documented zero hue for exact neutral %s",
  (hex) => {
    const c = rgbToOKLCH(hexToRgb(hex));
    expect(c.C).toBe(0);
    expect(c.H).toBe(0);
    expect(oklchToHex(c)).toBe(hex);
  },
);

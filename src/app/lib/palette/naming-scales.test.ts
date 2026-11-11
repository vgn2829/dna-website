import { describe, expect, it } from "vitest";
import { colourName } from "./naming";
import { tonalScale, TONAL_STEPS } from "./scales";
import { hexToRgb, rgbToOKLCH } from "./color";

const lch = (hex: string) => rgbToOKLCH(hexToRgb(hex));
const hueDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const grid = (step: number) => { const out: string[] = []; for (let r = 0; r < 256; r += step) for (let g = 0; g < 256; g += step) for (let b = 0; b < 256; b += step) out.push("#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()); return out; };

describe("colour names", () => {
  it("are deterministic, human-readable and independent of role labels", () => {
    expect(colourName("#FF0000")).toBe("Vivid Red");
    expect(colourName("#0000FF")).toBe("Deep Blue");
    expect(colourName("#FFFF00")).toBe("Vivid Yellow");
    expect(colourName("#8B4513")).toBe("Brown");
    expect(colourName("#FFFFFF")).toBe("White");
    expect(colourName("#000000")).toBe("Black");
    expect(colourName("#808080")).toBe("Grey");
    for (const hex of grid(51)) { const name = colourName(hex); expect(name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+){0,2}$/); expect(colourName(hex)).toBe(name); }
  });
});

describe("tonal scales", () => {
  it("are 100–900, strictly lighter to darker, contain the source and hold hue", () => {
    for (const hex of [...grid(51), "#6366F1", "#D81B7F"]) {
      const scale = tonalScale(hex), src = lch(hex);
      expect(scale.map((s) => s.step)).toEqual([...TONAL_STEPS]);
      expect(scale.filter((s) => s.source)).toHaveLength(1);
      expect(scale.find((s) => s.source)!.hex).toBe(hex);
      for (let i = 1; i < scale.length; i++) expect(lch(scale[i].hex).L).toBeLessThan(lch(scale[i - 1].hex).L);
      for (const s of scale) { expect(s.hex).toMatch(/^#[0-9A-F]{6}$/); if (src.C >= 0.04 && lch(s.hex).C >= 0.04) expect(hueDiff(lch(s.hex).H, src.H)).toBeLessThan(2.5); }
      expect(lch(scale[0].hex).C).toBeLessThanOrEqual(src.C + 1e-3);
      expect(lch(scale[8].hex).C).toBeLessThanOrEqual(src.C + 1e-3);
    }
    expect(tonalScale("#6366F1").find((s) => s.source)!.step).toBe(500);
    expect(tonalScale("abc")[0].step).toBe(100); // shorthand normalised like the rest of the editor
  });
});

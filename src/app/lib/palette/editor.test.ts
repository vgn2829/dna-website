import { it, expect } from "vitest";
import { createEditor, paletteReducer, paletteCSS } from "./editor";
it("edits and locks exact role values across regeneration, mode and seed changes", () => {
  let s = createEditor();
  s = paletteReducer(s, {
    type: "edit",
    theme: "light",
    role: "accent",
    value: "#123456",
  });
  s = paletteReducer(s, { type: "lock", theme: "light", role: "accent" });
  s = paletteReducer(s, {
    type: "generate",
    seed: "#FF0000",
    harmony: "triadic",
  });
  expect(s.variants.light.accent).toBe("#123456");
  expect(s.variants.dark.accent).toBe("#123456");
  s = paletteReducer(s, { type: "unlockAll" });
  s = paletteReducer(s, {
    type: "generate",
    seed: "#FF0000",
    harmony: "analogous",
  });
  expect(s.variants.light.accent).not.toBe("#123456");
});
it("exports all 18 normalized role values for both themes with stable names", () => {
  const css = paletteCSS(createEditor());
  expect(css.match(/--color-/g)).toHaveLength(36);
  expect(css).toContain("--color-surface-elevated:");
  expect(css).toContain('[data-palette-theme="dark"]');
  expect(css).not.toContain("NaN");
});
it("rejects invalid edits without mutating committed palette", () => {
  const state = createEditor();
  expect(() =>
    paletteReducer(state, {
      type: "edit",
      theme: "light",
      role: "primary",
      value: "bad!",
    }),
  ).toThrow();
  expect(state.seed).toBe("#6366F1");
});

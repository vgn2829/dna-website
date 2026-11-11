// @vitest-environment jsdom
import { studioDrafts } from "./drafts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PaletteStudio from "../PaletteStudio";
import { ContrastChecker } from "./ContrastChecker";
import { contrastRatio, hexToRgb, rgbToOKLCH } from "../../lib/palette/engine";

// Interaction tests for the Palette Studio professional upgrade.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  studioDrafts.clear();
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  URL.createObjectURL = vi.fn(() => `blob:fixture-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const render = async (node: React.ReactNode) => { await act(() => root.render(node)); };
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;
const click = async (b: Element) => { await act(() => (b as HTMLElement).click()); };
const change = async (input: HTMLInputElement, value: string) => {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const press = async (init: KeyboardEventInit, target: EventTarget = document.body) => {
  await act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
};
const moodHexes = () => Array.from(host.querySelectorAll(".studio-mood-hex")).map((b) => b.textContent!.trim());
const roleHex = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label} hex value"]`)!.value;

it("mood swatches lock exactly across new variations, and undo/redo restore them", async () => {
  await render(<PaletteStudio />);
  await click(button("Mood"));
  const before = moodHexes();
  expect(before).toHaveLength(5);
  await click(host.querySelector('[aria-label="Lock Shade"]')!);
  await click(host.querySelector('[aria-label="Generate a new mood variation"]')!);
  const after = moodHexes();
  expect(after[2]).toBe(before[2]);
  expect(after.join()).not.toBe(before.join());
  expect(host.querySelector('[aria-label="Unlock Shade"]')!.getAttribute("aria-pressed")).toBe("true");
  await click(host.querySelector('[aria-label="Undo"]')!);
  expect(moodHexes()).toEqual(before);
  await click(host.querySelector('[aria-label="Undo"]')!);
  expect(host.querySelector('[aria-label="Lock Shade"]')).not.toBeNull();
  await click(host.querySelector('[aria-label="Redo"]')!);
  await click(host.querySelector('[aria-label="Redo"]')!);
  expect(moodHexes()).toEqual(after);
});

it("editing a mood swatch locks that exact value", async () => {
  await render(<PaletteStudio />);
  await click(button("Mood"));
  await change(host.querySelector<HTMLInputElement>('[aria-label="Edit Accent"]')!, "#123456");
  expect(moodHexes()[3]).toBe("#123456");
  expect(host.querySelector('[aria-label="Unlock Accent"]')).not.toBeNull();
  await click(host.querySelector('[aria-label="Generate a new mood variation"]')!);
  expect(moodHexes()[3]).toBe("#123456");
});

it("Space generates only in the Mood view and never from a focused control; Ctrl+Z undoes", async () => {
  await render(<PaletteStudio />);
  const original = roleHex("Primary");
  await press({ key: " ", code: "Space" });
  expect(roleHex("Primary")).toBe(original);
  await click(button("Mood"));
  const before = moodHexes();
  const input = host.querySelector<HTMLInputElement>('[aria-label="Seed hex"]')!;
  await press({ key: " ", code: "Space" }, input);
  expect(moodHexes()).toEqual(before);
  await press({ key: " ", code: "Space" });
  const after = moodHexes();
  expect(after.join()).not.toBe(before.join());
  await press({ key: " ", code: "Space", repeat: true });
  expect(moodHexes()).toEqual(after);
  await press({ key: "z", ctrlKey: true });
  expect(moodHexes()).toEqual(before);
  await press({ key: "z", ctrlKey: true, shiftKey: true });
  expect(moodHexes()).toEqual(after);
});

it("role locks can be undone, and undo restores the committed seed into the seed field", async () => {
  await render(<PaletteStudio />);
  await click(host.querySelector('[aria-label="Lock Accent"]')!);
  await change(host.querySelector<HTMLInputElement>('[aria-label="Seed hex"]')!, "#FF006E");
  await click(button("Generate"));
  expect(host.textContent).toContain("Generated from #FF006E");
  await click(host.querySelector('[aria-label="Undo"]')!);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Seed hex"]')!.value).toBe("#6366F1");
  expect(host.textContent).toContain("Generated from #6366F1");
  await click(host.querySelector('[aria-label="Undo"]')!);
  expect(host.querySelector('[aria-label="Lock Accent"]')!.getAttribute("aria-pressed")).toBe("false");
});

it("using a mood swatch as the seed regenerates both themes from it", async () => {
  await render(<PaletteStudio />);
  await click(button("Mood"));
  const target = moodHexes()[1];
  await click(host.querySelector('[aria-label="Use Companion as seed"]')!);
  expect(host.textContent).toContain(`Generated from ${target}`);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Seed hex"]')!.value).toBe(target);
});

it("grey seeds give exactly neutral surfaces and chromatic brand roles", async () => {
  await render(<PaletteStudio />);
  await change(host.querySelector<HTMLInputElement>('[aria-label="Seed hex"]')!, "#808080");
  await click(button("Generate"));
  for (const role of ["Background", "Surface", "Border"]) expect(rgbToOKLCH(hexToRgb(roleHex(role))).C).toBeLessThan(0.002);
  expect(rgbToOKLCH(hexToRgb(roleHex("Secondary"))).C).toBeGreaterThan(0.05);
});

it("mood settings persist across a reload", async () => {
  await render(<PaletteStudio />);
  await click(button("Mood"));
  await click(button("Poster"));
  await click(host.querySelector('[aria-label="Lock Lead"]')!);
  const saved = moodHexes();
  await act(() => root.unmount());
  studioDrafts.clear();
  root = createRoot(host);
  await render(<PaletteStudio />);
  await click(button("Mood"));
  expect(button("Poster").getAttribute("aria-pressed")).toBe("true");
  expect(moodHexes()).toEqual(saved);
});

it("Export offers CSS, Tailwind, DTCG tokens and an SVG card from the committed palette", async () => {
  await render(<PaletteStudio />);
  await click(button("Export"));
  const code = () => host.querySelector(".studio-export-code")!.textContent!;
  const tokens = JSON.parse(code());
  expect(tokens.ui.light.bg.$value.hex).toBe(roleHexFromState("bg"));
  expect(Object.keys(tokens.palette)).toHaveLength(5);
  await click(button("Tailwind"));
  expect(code()).toContain("export default");
  await click(button("CSS"));
  expect(code()).toContain('[data-palette-theme="dark"]');
  expect(code()).toContain("--palette-anchor:");
  await click(button("SVG card"));
  const img = host.querySelector<HTMLImageElement>('img[alt="SVG palette card preview"]')!;
  expect(decodeURIComponent(img.src)).toContain("<svg");
  await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Download dna-palette.svg"))!);
  expect(URL.createObjectURL).toHaveBeenCalled();
  function roleHexFromState(role: string) { return JSON.parse(localStorage.getItem("dna.studio.palette.editor.v1")!).variants.light[role].toLowerCase(); }
});

it("Accessibility reports border non-text contrast and semantic distinctness", async () => {
  await render(<PaletteStudio />);
  await click(button("Accessibility"));
  expect(host.textContent).toContain("Non-text contrast");
  expect(host.textContent).toContain("Border / BG");
  expect(host.textContent).toContain("Semantic colour distinctness");
});

it("Contrast Checker suggestions come from the shared engine and all pass AA", async () => {
  await render(<ContrastChecker />);
  await change(host.querySelector<HTMLInputElement>("#contrast-fg")!, "#777777");
  await change(host.querySelector<HTMLInputElement>("#contrast-bg")!, "#ffffff");
  const options = Array.from(host.querySelectorAll(".studio-option"));
  expect(options.length).toBeGreaterThan(0);
  for (const option of options) {
    const hex = option.querySelector(".studio-mono")!.textContent!;
    expect(contrastRatio(hexToRgb(hex), hexToRgb("#FFFFFF"))).toBeGreaterThanOrEqual(4.5);
    expect(option.textContent).toMatch(/AA/);
  }
});

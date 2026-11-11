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
const moodHexes = () => Array.from(host.querySelectorAll(".palette-column-hex")).map((b) => b.textContent!.trim());
const roleHex = (key: string) => host.querySelector<HTMLButtonElement>(`button[data-role="${key}"]`)!.textContent!.trim();
const seedField = () => host.querySelector<HTMLInputElement>('[aria-label="Seed hex"]')!;
const docButton = (text: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text)!;

it("swatches lock exactly across Generate, and undo/redo restore them", async () => {
  await render(<PaletteStudio />);
  const before = moodHexes();
  expect(before).toHaveLength(5);
  await click(host.querySelector('[aria-label="Lock Shade swatch"]')!);
  await click(button("Generate"));
  const after = moodHexes();
  expect(after[2]).toBe(before[2]);
  expect(after.join()).not.toBe(before.join());
  expect(host.querySelector('[aria-label="Unlock Shade swatch"]')!.getAttribute("aria-pressed")).toBe("true");
  await click(host.querySelector('[aria-label="Undo"]')!);
  expect(moodHexes()).toEqual(before);
  await click(host.querySelector('[aria-label="Undo"]')!);
  expect(host.querySelector('[aria-label="Lock Shade swatch"]')).not.toBeNull();
  await click(host.querySelector('[aria-label="Redo"]')!);
  await click(host.querySelector('[aria-label="Redo"]')!);
  expect(moodHexes()).toEqual(after);
});

it("editing a swatch locks that exact value", async () => {
  await render(<PaletteStudio />);
  await change(host.querySelector<HTMLInputElement>('[aria-label="Edit Accent swatch"]')!, "#123456");
  expect(moodHexes()[3]).toBe("#123456");
  expect(host.querySelector('[aria-label="Unlock Accent swatch"]')).not.toBeNull();
  await click(button("Generate"));
  expect(moodHexes()[3]).toBe("#123456");
});

it("Space generates, never from a focused control or a held key; Ctrl+Z / Ctrl+Shift+Z travel", async () => {
  await render(<PaletteStudio />);
  const before = moodHexes();
  await press({ key: " ", code: "Space" }, seedField());
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
  const locked = roleHex("accent");
  await change(seedField(), "#FF006E");
  expect(roleHex("accent")).toBe(locked);
  expect(roleHex("primary")).not.toBe("");
  await click(host.querySelector('[aria-label="Undo"]')!);
  expect(seedField().value).toBe("#6366F1");
  await click(host.querySelector('[aria-label="Undo"]')!);
  expect(host.querySelector('[aria-label="Lock Accent"]')!.getAttribute("aria-pressed")).toBe("false");
});

it("using a swatch as the seed regenerates both themes from it", async () => {
  await render(<PaletteStudio />);
  const target = moodHexes()[1];
  const primary = roleHex("primary");
  await click(host.querySelector('[aria-label="Use Companion swatch as seed"]')!);
  expect(seedField().value).toBe(target);
  expect(moodHexes()[0]).toBe(target); // Visual mode keeps the exact seed as Anchor
  expect(roleHex("primary")).not.toBe(primary);
});

it("grey seeds give exactly neutral surfaces and chromatic brand roles", async () => {
  await render(<PaletteStudio />);
  await change(seedField(), "#808080");
  for (const role of ["bg", "surface", "border"]) expect(rgbToOKLCH(hexToRgb(roleHex(role))).C).toBeLessThan(0.002);
  expect(rgbToOKLCH(hexToRgb(roleHex("secondary"))).C).toBeGreaterThan(0.05);
});

it("mood and roles persist across a reload with the existing editor key", async () => {
  await render(<PaletteStudio />);
  await click(button("Poster"));
  await click(host.querySelector('[aria-label="Lock Lead swatch"]')!);
  await click(host.querySelector('[aria-label="Lock Accent"]')!);
  const saved = moodHexes(), accent = roleHex("accent");
  expect(JSON.parse(localStorage.getItem("dna.studio.palette.editor.v1")!).locks.accent).toBe(accent);
  await act(() => root.unmount());
  studioDrafts.clear();
  root = createRoot(host);
  await render(<PaletteStudio />);
  expect(button("Poster").getAttribute("aria-pressed")).toBe("true");
  expect(moodHexes()).toEqual(saved);
  expect(roleHex("accent")).toBe(accent);
});

it("Export offers CSS, Tailwind, DTCG tokens, an SVG card and mood JSON from the committed palette", async () => {
  await render(<PaletteStudio />);
  await click(button("Export"));
  const code = () => document.querySelector('[role="dialog"] .palette-export-code')!.textContent!;
  expect(code()).toContain('[data-palette-theme="dark"]');
  expect(code()).toContain("--palette-anchor:");
  await click(docButton("Design tokens"));
  const tokens = JSON.parse(code());
  expect(tokens.ui.light.bg.$value.hex).toBe(JSON.parse(localStorage.getItem("dna.studio.palette.editor.v1")!).variants.light.bg.toLowerCase());
  expect(Object.keys(tokens.palette)).toHaveLength(5);
  await click(docButton("Tailwind"));
  expect(code()).toContain("export default");
  await click(docButton("Mood JSON"));
  expect(JSON.parse(code())).toHaveLength(5);
  await click(docButton("SVG card"));
  expect(decodeURIComponent(document.querySelector<HTMLImageElement>('img[alt="SVG swatch card preview"]')!.src)).toContain("<svg");
  await click(docButton("Download SVG"));
  expect(URL.createObjectURL).toHaveBeenCalled();
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

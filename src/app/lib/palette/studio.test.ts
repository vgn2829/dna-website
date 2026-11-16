import { describe, expect, it } from "vitest";
import { createEditor } from "./editor";
import { createMood, createUndoable, DIALOG_SELECTOR, HISTORY_LIMIT, INTERACTIVE_SELECTOR, paletteShortcut, SHORTCUT_SCOPE, TEXT_EDITING_SELECTOR, parseMood, serializeMood, undoableReducer, type UndoableAction, type UndoableStudio } from "./studio";

const start = () => createUndoable({ editor: createEditor(), mood: createMood() });
const apply = (s: UndoableStudio, action: UndoableAction) => undoableReducer(s, action);
const moodPatch = (variation: string, at = 0, coalesce = ""): UndoableAction => ({ type: "apply", action: { type: "mood", patch: { variation } }, at, coalesce });

describe("studio history", () => {
  it("undo/redo restore complete editor + mood states; a new change clears redo", () => {
    let s = start();
    s = apply(s, { type: "apply", action: { type: "editor", action: { type: "lock", theme: "light", role: "accent" } }, at: 0 });
    s = apply(s, moodPatch("v-1", 1));
    s = apply(s, { type: "apply", action: { type: "mood", patch: { locks: { 2: "#123456" } } }, at: 2 });
    s = apply(s, { type: "undo" });
    expect(s.history.present.mood.locks).toEqual({});
    s = apply(s, { type: "undo" });
    expect(s.history.present.mood.variation).toBe("mood-1");
    expect(s.history.present.editor.locks.accent).toBeDefined();
    s = apply(s, { type: "undo" });
    expect(s.history.present.editor.locks).toEqual({});
    expect(apply(s, { type: "undo" })).toBe(s);
    s = apply(s, { type: "redo" });
    expect(s.history.present.editor.locks.accent).toBeDefined();
    s = apply(s, moodPatch("v-2", 3));
    expect(s.history.future).toEqual([]);
  });
  it("keeps at most 25 states and coalesces a dragged picker into one step", () => {
    let s = start();
    for (let i = 0; i < 60; i++) s = apply(s, moodPatch(`v-${i}`, i * 1000));
    expect(s.history.past.length + 1).toBe(HISTORY_LIMIT);
    let t = start();
    t = apply(t, moodPatch("a", 0, "mood-1"));
    t = apply(t, moodPatch("b", 100, "mood-1"));
    t = apply(t, moodPatch("c", 200, "mood-1"));
    expect(t.history.past).toHaveLength(1);
    expect(t.history.present.mood.variation).toBe("c");
    t = apply(t, moodPatch("d", 5000, "mood-1"));
    expect(t.history.past).toHaveLength(2);
  });
});

describe("mood persistence", () => {
  it("round-trips and rejects malformed, oversized or out-of-range recipes", () => {
    const mood = { mode: "poster" as const, variation: "v-abc", locks: { 3: "#ABCDEF" } };
    expect(parseMood(serializeMood(mood))).toEqual(mood);
    for (const bad of ["{}", "x".repeat(2001), JSON.stringify({ version: 1, mode: "neon", variation: "a", locks: {} }), JSON.stringify({ version: 1, mode: "visual", variation: "a", locks: { 7: "#000000" } }), JSON.stringify({ version: 1, mode: "visual", variation: "a", locks: { 1: "red" } })])
      expect(() => parseMood(bad)).toThrow();
  });
});

const key = (k: string, extra: Partial<Parameters<typeof paletteShortcut>[0]> = {}) => ({ key: k, code: k === " " ? "Space" : `Key${k.toUpperCase()}`, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...extra });
// Minimal Element.closest stand-in: matches a tag, role or attribute listed in the selector.
const el = (tag: string, opts: { role?: string; type?: string; scoped?: boolean; dialog?: boolean } = {}) => ({
  closest: (selector: string) => selector.split(",").some((s) =>
    s === tag ||
    (tag === "input" && (s === `input[type="${opts.type ?? "text"}"]` || (!opts.type && s === "input:not([type])"))) ||
    (opts.role && s === `[role="${opts.role}"]`) ||
    (opts.scoped && s === SHORTCUT_SCOPE) ||
    (opts.dialog && s === '[role="dialog"]')) ? {} : null,
});

describe("keyboard shortcuts", () => {
  it("map Space, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y on the page", () => {
    expect(paletteShortcut(key(" "))).toBe("generate");
    expect(paletteShortcut(key(" ", { repeat: true }))).toBe("suppress");
    expect(paletteShortcut(key("z", { ctrlKey: true }))).toBe("undo");
    expect(paletteShortcut(key("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(paletteShortcut(key("y", { ctrlKey: true }))).toBe("redo");
  });
  // Regression (verification finding E): a clicked button keeps focus, which used to swallow undo/redo.
  it("undo/redo work while a button, tab, link or colour picker is focused", () => {
    for (const target of [el("button", { scoped: true }), el("button"), el("div", { role: "tab" }), el("a[href]"), el("input", { type: "color" }), el("select")]) {
      expect(paletteShortcut(key("z", { ctrlKey: true, target }))).toBe("undo");
      expect(paletteShortcut(key("z", { metaKey: true, target }))).toBe("undo");
      expect(paletteShortcut(key("z", { ctrlKey: true, shiftKey: true, target }))).toBe("redo");
      expect(paletteShortcut(key("y", { ctrlKey: true, target }))).toBe("redo");
    }
  });
  it("leave undo/redo to text fields and dialogs", () => {
    for (const target of [el("input"), el("input", { type: "search" }), el("input", { type: "number" }), el("textarea"), el("div", { role: "textbox" }), el("button", { dialog: true }), el("div", { dialog: true })]) {
      expect(paletteShortcut(key("z", { ctrlKey: true, target }))).toBeNull();
      expect(paletteShortcut(key("y", { ctrlKey: true, target }))).toBeNull();
    }
  });
  it("Space keeps native activation on keyboard-focused controls", () => {
    for (const target of [el("button", { scoped: true }), el("summary", { scoped: true }), el("div", { role: "tab", scoped: true }), el("input", { type: "color", scoped: true })])
      expect(paletteShortcut(key(" ", { target, pointerFocused: false }))).toBeNull();
  });
  // Regression (verification finding E): Space after clicking a lock re-activated it and unlocked the swatch.
  it("Space on a control just clicked inside the studio generates instead of re-activating it", () => {
    expect(paletteShortcut(key(" ", { target: el("button", { scoped: true }), pointerFocused: true }))).toBe("generate");
    expect(paletteShortcut(key(" ", { target: el("button", { scoped: true }), pointerFocused: true, repeat: true }))).toBe("suppress");
    // Outside the studio, or in text fields and dialogs, Space is never taken.
    expect(paletteShortcut(key(" ", { target: el("button"), pointerFocused: true }))).toBeNull();
    expect(paletteShortcut(key(" ", { target: el("input", { scoped: true }), pointerFocused: true }))).toBeNull();
    expect(paletteShortcut(key(" ", { target: el("textarea", { scoped: true }), pointerFocused: true }))).toBeNull();
    expect(paletteShortcut(key(" ", { target: el("select", { scoped: true }), pointerFocused: true }))).toBeNull();
    expect(paletteShortcut(key(" ", { target: el("button", { scoped: true, dialog: true }), pointerFocused: true }))).toBeNull();
  });
  it("ignore IME composition, handled events and modified Space", () => {
    expect(paletteShortcut(key(" ", { target: el("div") }))).toBe("generate");
    expect(paletteShortcut(key(" ", { defaultPrevented: true }))).toBeNull();
    expect(paletteShortcut(key(" ", { isComposing: true }))).toBeNull();
    expect(paletteShortcut(key("z", { ctrlKey: true, isComposing: true }))).toBeNull();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) expect(paletteShortcut(key(" ", mod))).toBeNull();
    expect(paletteShortcut(key("z"))).toBeNull();
    expect(paletteShortcut(key("z", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(paletteShortcut(key("y", { metaKey: true }))).toBeNull(); // Cmd+Y is browser history on macOS
    expect(INTERACTIVE_SELECTOR).toContain("[contenteditable]");
    expect(TEXT_EDITING_SELECTOR).toContain("textarea");
    expect(DIALOG_SELECTOR).toContain('[aria-modal="true"]');
  });
});

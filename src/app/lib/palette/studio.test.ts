import { describe, expect, it } from "vitest";
import { createEditor } from "./editor";
import { createMood, createUndoable, HISTORY_LIMIT, INTERACTIVE_SELECTOR, paletteShortcut, parseMood, serializeMood, undoableReducer, type UndoableAction, type UndoableStudio } from "./studio";

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
const el = (tag: string, role?: string) => ({ closest: (selector: string) => (selector.split(",").some((s) => s === tag || (role && s === `[role="${role}"]`)) ? {} : null) });

describe("keyboard shortcuts", () => {
  it("map Space, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y", () => {
    expect(paletteShortcut(key(" "))).toBe("generate");
    expect(paletteShortcut(key(" ", { repeat: true }))).toBe("suppress");
    expect(paletteShortcut(key("z", { ctrlKey: true }))).toBe("undo");
    expect(paletteShortcut(key("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(paletteShortcut(key("y", { ctrlKey: true }))).toBe("redo");
  });
  it("never take keys from controls, dialogs, IME or modified combinations", () => {
    for (const target of [el("input"), el("textarea"), el("select"), el("button"), el("summary"), el("div", "tab"), el("div", "dialog")]) {
      expect(paletteShortcut(key(" ", { target }))).toBeNull();
      expect(paletteShortcut(key("z", { ctrlKey: true, target }))).toBeNull();
    }
    expect(paletteShortcut(key(" ", { target: el("div") }))).toBe("generate");
    expect(paletteShortcut(key(" ", { defaultPrevented: true }))).toBeNull();
    expect(paletteShortcut(key(" ", { isComposing: true }))).toBeNull();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) expect(paletteShortcut(key(" ", mod))).toBeNull();
    expect(paletteShortcut(key("y", { metaKey: true }))).toBeNull();
    expect(INTERACTIVE_SELECTOR).toContain("[contenteditable]");
  });
});

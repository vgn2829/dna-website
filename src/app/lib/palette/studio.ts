import { paletteReducer, type Editor, type EditorAction } from "./editor";
import type { Mood } from "./engine";

// Palette Studio session state above the existing editor: the mood palette's
// reproducible settings, an undo/redo history over both, and the keyboard
// shortcut policy. The editor and its storage key are unchanged; mood settings
// use their own versioned key so existing saved palettes keep loading.

export const MOODS: Mood[] = ["visual", "minimal", "poster", "luxury", "cyberpunk", "exploratory"];
export type MoodState = { mode: Mood; variation: string; locks: Record<string, string> };
export const createMood = (): MoodState => ({ mode: "visual", variation: "mood-1", locks: {} });

const MOOD_KEY = "dna.studio.palette.mood.v1";
export function parseMood(text: string): MoodState {
  if (text.length > 2000) throw new Error("Mood recipe exceeds size limit");
  const value = JSON.parse(text);
  if (value?.version !== 1 || !MOODS.includes(value.mode) || typeof value.variation !== "string" || value.variation.length > 128) throw new Error("Invalid mood recipe");
  const locks = value.locks ?? {};
  if (typeof locks !== "object" || Array.isArray(locks) || !Object.entries(locks).every(([k, v]) => /^[0-4]$/.test(k) && typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v))) throw new Error("Invalid mood locks");
  return { mode: value.mode, variation: value.variation, locks: { ...locks } };
}
export const serializeMood = (mood: MoodState) => JSON.stringify({ version: 1, ...mood });
/** Shared link (`?mood=`) first, then same-tab memory, then storage, then defaults. Never throws. */
export function loadMood(memory?: MoodState): { mood: MoodState; shared?: boolean; error?: string } {
  try { const shared = new URLSearchParams(window.location.search).get("mood"); if (shared) return { mood: parseMood(shared), shared: true }; }
  catch (error) { return { mood: memory || createMood(), error: error instanceof Error ? error.message : "Invalid shared mood" }; }
  if (memory) return { mood: memory };
  try { const saved = localStorage.getItem(MOOD_KEY); if (saved) return { mood: parseMood(saved) }; } catch { /* Defaults remain available. */ }
  return { mood: createMood() };
}
export function persistMood(mood: MoodState) { try { localStorage.setItem(MOOD_KEY, serializeMood(mood)); return true; } catch { return false; } }

/** A short reproducible variation token, e.g. `v-k3x9q2`. */
export function newVariation() {
  const bytes = new Uint8Array(6);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return "v-" + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

export type StudioState = { editor: Editor; mood: MoodState };
export type StudioAction =
  | { type: "editor"; action: EditorAction }
  | { type: "mood"; patch: Partial<MoodState> }
  /** Several changes recorded as one undo step (e.g. Generate rerolls roles and mood together). */
  | { type: "batch"; actions: StudioAction[] };
export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  if (action.type === "batch") return action.actions.reduce(studioReducer, state);
  if (action.type === "editor") {
    const editor = paletteReducer(state.editor, action.action);
    return editor === state.editor ? state : { ...state, editor };
  }
  return { ...state, mood: { ...state.mood, ...action.patch } };
}

// ── History ────────────────────────────────────────────────────────────────
export const HISTORY_LIMIT = 25;
export type History<T> = { past: T[]; present: T; future: T[] };
export const createHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] });
/** Records a state, keeping at most `limit` in total; `replace` overwrites the present (coalesced gesture). */
export function commitHistory<T>(h: History<T>, next: T, { replace = false, limit = HISTORY_LIMIT } = {}): History<T> {
  if (replace) return { past: h.past, present: next, future: [] };
  return { past: [...h.past, h.present].slice(-(limit - 1)), present: next, future: [] };
}
export function undoHistory<T>(h: History<T>): History<T> {
  return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h;
}
export function redoHistory<T>(h: History<T>): History<T> {
  return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
}

/** Same-target edits within this window (a dragged colour picker) form one undo step. */
export const COALESCE_MS = 800;
export type UndoableStudio = { history: History<StudioState>; lastKey: string; lastAt: number };
export type UndoableAction =
  | { type: "apply"; action: StudioAction; coalesce?: string; at: number }
  | { type: "undo" }
  | { type: "redo" };
export const createUndoable = (state: StudioState): UndoableStudio => ({ history: createHistory(state), lastKey: "", lastAt: 0 });
export function undoableReducer(state: UndoableStudio, action: UndoableAction): UndoableStudio {
  if (action.type === "undo" || action.type === "redo") {
    const history = action.type === "undo" ? undoHistory(state.history) : redoHistory(state.history);
    return history === state.history ? state : { history, lastKey: "", lastAt: 0 };
  }
  const next = studioReducer(state.history.present, action.action);
  if (next === state.history.present) return state;
  const key = action.coalesce || "";
  const replace = !!key && key === state.lastKey && action.at - state.lastAt < COALESCE_MS;
  return { history: commitHistory(state.history, next, { replace }), lastKey: key, lastAt: action.at };
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
type ShortcutTarget = { closest?: (selector: string) => unknown } | null;
export type ShortcutEvent = {
  key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean;
  repeat?: boolean; defaultPrevented?: boolean; isComposing?: boolean; target: ShortcutTarget | EventTarget | null;
};
/** Anything that already gives Space or Ctrl/Cmd+Z a meaning of its own. */
export const INTERACTIVE_SELECTOR = [
  "input", "textarea", "select", "button", "a[href]", "summary", "label", "audio", "video", "iframe",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]', '[role="checkbox"]', '[role="menuitem"]', '[role="option"]', '[role="radio"]', '[role="slider"]',
  '[role="switch"]', '[role="tab"]', '[role="textbox"]', '[role="combobox"]', '[role="dialog"]', '[aria-modal="true"]',
].join(",");
/**
 * Space → generate, Ctrl/Cmd+Z → undo, Ctrl/Cmd+Shift+Z or Ctrl+Y → redo.
 * A held Space returns "suppress" (no scroll, no repeat). Null whenever the key
 * belongs to a focused control, dialog, IME composition or another handler.
 */
export function paletteShortcut(e: ShortcutEvent): "generate" | "undo" | "redo" | "suppress" | null {
  if (e.defaultPrevented || e.isComposing) return null;
  const target = e.target as ShortcutTarget;
  if (target && typeof target.closest === "function" && target.closest(INTERACTIVE_SELECTOR)) return null;
  const key = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if ((e.key === " " || e.code === "Space") && !mod && !e.altKey && !e.shiftKey) return e.repeat ? "suppress" : "generate";
  if (!mod || e.altKey) return null;
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && e.ctrlKey && !e.shiftKey) return "redo";
  return null;
}

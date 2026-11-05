import {repairRoles} from "../palette-engine";
import {
  derivePalette,
  checkedPalette,
  normalizeHex,
  type Harmony,
  type Palette,
  type Role,
} from "./engine";
export type Theme = "light" | "dark";
export interface Editor {
  variation: string;
  seed: string;
  harmony: Harmony;
  variants: Record<Theme, Palette>;
  locks: Partial<Palette>;
}
export type EditorAction =
  | { type: "generate"; seed: string; harmony: Harmony; variation?: string }
  | { type: "edit"; theme: Theme; role: Role; value: string }
  | { type: "lock"; theme: Theme; role: Role }
  | { type: "unlockAll" };
export function createEditor(
  seed = "#6366F1",
  harmony: Harmony = "complementary",
  locks: Partial<Palette> = {},
  variation = seed,
): Editor {
  seed = normalizeHex(seed);
  return {
    seed,
    variation,
    harmony,
    locks,
    variants: {
      light: derivePalette(seed, false, harmony, locks, variation),
      dark: derivePalette(seed, true, harmony, locks, variation),
    },
  };
}
export function paletteReducer(state: Editor, action: EditorAction): Editor {
  if (action.type === "generate")
    return createEditor(action.seed, action.harmony, state.locks, action.variation ?? state.variation);
  if (action.type === "unlockAll") return { ...state, locks: {} };
  if (action.type === "lock") {
    const locks = { ...state.locks };
    if (locks[action.role]) delete locks[action.role];
    else locks[action.role] = state.variants[action.theme][action.role];
    return {
      ...state,
      locks,
      variants: locks[action.role]
        ? {
            light: {
              ...state.variants.light,
              [action.role]: locks[action.role],
            },
            dark: { ...state.variants.dark, [action.role]: locks[action.role] },
          }
        : state.variants,
    };
  }
  const value = normalizeHex(action.value);
  const locks = state.locks[action.role] ? {...state.locks,[action.role]:value} : state.locks;
  const repair = (palette: Palette) => checkedPalette(repairRoles({...palette,[action.role]:value},{...locks,[action.role]:value}));
  return {...state,locks,variants:state.locks[action.role] ? {light:repair(state.variants.light),dark:repair(state.variants.dark)} : {...state.variants,[action.theme]:repair(state.variants[action.theme])}};

}
export function paletteCSS(editor: Editor): string {
  const block = (p: Palette) =>
    Object.entries(p)
      .map(
        ([k, v]) =>
          `  --color-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${normalizeHex(v)};`,
      )
      .join("\n");
  return `/* DNA palette v1; seed ${editor.seed}; harmony ${editor.harmony}. Set data-palette-theme on your root. */\n:root, [data-palette-theme="light"] {\n${block(editor.variants.light)}\n}\n[data-palette-theme="dark"] {\n${block(editor.variants.dark)}\n}\n`;
}

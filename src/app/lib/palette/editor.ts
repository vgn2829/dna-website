import {
  derivePalette,
  normalizeHex,
  type Harmony,
  type Palette,
  type Role,
} from "./engine";
export type Theme = "light" | "dark";
export interface Editor {
  seed: string;
  harmony: Harmony;
  variants: Record<Theme, Palette>;
  locks: Partial<Palette>;
}
export type EditorAction =
  | { type: "generate"; seed: string; harmony: Harmony }
  | { type: "edit"; theme: Theme; role: Role; value: string }
  | { type: "lock"; theme: Theme; role: Role }
  | { type: "unlockAll" };
export function createEditor(
  seed = "#6366F1",
  harmony: Harmony = "complementary",
  locks: Partial<Palette> = {},
): Editor {
  seed = normalizeHex(seed);
  return {
    seed,
    harmony,
    locks,
    variants: {
      light: derivePalette(seed, false, harmony, locks),
      dark: derivePalette(seed, true, harmony, locks),
    },
  };
}
export function paletteReducer(state: Editor, action: EditorAction): Editor {
  if (action.type === "generate")
    return createEditor(action.seed, action.harmony, state.locks);
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
  return {
    ...state,
    variants: state.locks[action.role]
      ? {
          light: { ...state.variants.light, [action.role]: value },
          dark: { ...state.variants.dark, [action.role]: value },
        }
      : {
          ...state.variants,
          [action.theme]: {
            ...state.variants[action.theme],
            [action.role]: value,
          },
        },
    locks: state.locks[action.role]
      ? { ...state.locks, [action.role]: value }
      : state.locks,
  };
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

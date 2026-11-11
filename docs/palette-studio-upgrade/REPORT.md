# Palette Studio professional upgrade — port onto main

Date: 12 November 2026. Branch: `feature/palette-studio-professional-upgrade`, based on `origin/main` @ `071cce4`.

The upgrade was first built on an older local Palette Studio. Main has since gained its own architecture (PRs #82, #86): `lib/palette/{engine,editor,persistence,simulation}.ts`, the role editor with both themes, `studio/ContrastChecker.tsx`, `StudioUI` and `studio.css`. This change ports the validated features onto that architecture. Main's modules, editor model, saved-palette format, routes and styling are preserved; nothing was replaced wholesale.

## What main already had (kept)

- Role editor with light **and** dark variants, exact role locks and edits with contrast repair (`editor.ts`), shared links and saved editor (`persistence.ts`, key `dna.studio.palette.editor.v1`, unchanged).
- Fixed-L/H chroma-reduction gamut mapping in `engine.ts`, frozen by independent ColorAide fixtures.
- Brettel 1997 colour-vision simulation (libDaltonLens coefficients, linear light) in `simulation.ts`.
- WCAG ratio in Contrast Checker via the engine; Compare themes; CSS export for both themes; Mood tab.

## What was ported or fixed

| Area | Change | Where |
| --- | --- | --- |
| Single conversion policy | Conversion, gamut mapping and WCAG maths moved verbatim from `engine.ts` into `color.ts` (re-exported, API unchanged). The generation module `palette-engine.ts` now uses it instead of Color.js `toGamut('oklch.c')`, whose final clip moved hue. | `lib/palette/color.ts`, `lib/palette-engine.ts` |
| Grey/achromatic seeds | **Confirmed on main:** seed `#808080` gave grey primary, secondary *and* accent, and neutrals tinted toward hue 0 (`bg #FDF6F8`). Now secondary/accent use the harmony angles around a variation-chosen hue (chroma .12), primary stays neutral, neutrals are exactly grey. | `palette-engine.ts` `derivePalette` |
| Mood palettes | Five modes with role names, tonal/chroma profiles and chroma floors; reproducible variation strings (were `Math.random`); per-swatch locks (byte-identical; locking one never moves others); vivid slots shift lightness — never hue — when sRGB cannot hold the chroma. Visual keeps the exact seed as Anchor. | `palette-engine.ts` `deriveVisualPalette`; facade signature extended in `engine.ts` (old random-source form still accepted) |
| Colour names | Deterministic OKLCH names ("Deep Indigo", "Dusty Teal"); replaces the unused private `simpleColorName`. | `lib/palette/naming.ts` |
| Tonal scales | 100–900 at constant hue, source exact on its nearest step, linear L to .97/.24, chroma taper, shared gamut mapping. | `lib/palette/scales.ts` |
| Contrast | `contrastGrade` (AA/AAA normal and large, non-text), OKLCH suggestions; Contrast Checker's separate HSL algorithm and dead helpers removed, `generateSuggestions` keeps its name and shape (+`ratio`). | `lib/palette/contrast.ts`, `studio/ContrastChecker.tsx` |
| Border contrast | **Confirmed:** generated `border` is 2.02–2.22:1 on `bg` in 16/16 palettes. Generation is unchanged (it is a subtle separator by design); the Accessibility view now reports Border/BG and Border/Surface against the WCAG 1.4.11 3:1 threshold and says when it is usable for control outlines. | `contrast.ts` `nonTextChecks`, `RoleChecks` |
| Semantic collisions | **Confirmed:** brand↔status OKLab distance < .08 in 15/960 pairs; status colours converge under simulated deuteranopia/tritanopia in 80/80 palettes. The Accessibility view lists close pairs (brand↔status, and status↔status under each Brettel simulation). Heuristic threshold, documented in the UI. | `contrast.ts` `semanticCollisions` |
| Undo/redo | One history (25 states) over editor and mood; picker drags coalesced; drafts (seed/harmony/variation) follow the restored state. | `lib/palette/studio.ts`, `PaletteStudio.tsx` |
| Keyboard | Space = new mood variation (Mood view only); Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Ignored in inputs, buttons, ARIA widgets, dialogs, IME and modified combos; held Space neither scrolls nor repeats. | `studio.ts` `paletteShortcut` |
| Exports | New Export view: CSS (unchanged role CSS + optional `--palette-*` mood block), Tailwind config, W3C DTCG 2025.10 tokens (palette, scales, `ui.light`/`ui.dark`), self-contained escaped SVG card. Copy CSS / Download CSS / mood JSON unchanged. | `lib/palette/export.ts`, `ExportPanel` |
| Previews | Compare themes now shows light and dark side by side (stacked on narrow screens). Mood swatches gain names, OKLCH, copy, lock, edit, use-as-seed, tonal scales and pairwise contrast. | `PaletteStudio.tsx`, `studio.css` |
| Persistence | Mood settings saved under a new versioned key `dna.studio.palette.mood.v1` and in share links (`?mood=`); the editor format and key are untouched, so existing saved palettes load unchanged. | `studio.ts` |

### Colour-vision deficiency decision

Main's Brettel 1997 model is kept. Machado 2009 was evaluated against it on primaries and UI colours: maximum OKLab difference 0.059 (protanopia), 0.049 (deuteranopia), 0.089 (tritanopia). Brettel is the established model for full dichromacy, main already validates it against independently compiled libDaltonLens output, and Machado's tritanopia matrix is its acknowledged weak case; Machado's main advantage (variable severity for anomalous trichromacy) is not used here. The generation module's legacy gamma-space matrices were removed and now delegate to Brettel, so one model serves every path.

## Gemini findings

| Finding | On main | Outcome |
| --- | --- | --- |
| Static reroll seed | Mood used `Math.random` (not reproducible) | Fixed: reproducible variation tokens |
| Gamut clipping | Editor path correct; generation path used Color.js clip | Fixed: one shared policy |
| Grey seeds collapse | Confirmed, plus rose-tinted neutrals | Fixed |
| CVD in gamma space | Editor already Brettel/linear; legacy module gamma | Fixed by delegation |
| Duplicated contrast logic | Ratio shared; suggestions HSL | Fixed |
| Locks/editing/naming/seed promotion | Roles had locks/edit; mood had none | Added for mood |
| Tonal scales; Tailwind/DTCG/SVG | Missing | Added |
| Saved collections | Missing | Not added (product decision; see limitations) |
| Semantic collisions | Missing | Added as reported checks |
| Preview buried | Compare existed, stacked | Side-by-side |
| Repair cost | 1001-candidate scan unchanged; measured ~1 ms typical | Not changed |
| Border contrast | Confirmed | Reported (not silently changed) |

## Verification

Automated (this branch): `pnpm vitest run` **42 files, 520 tests** (main baseline 37/483; +37 tests: generation, naming, scales, contrast/collisions, exports incl. evaluated Tailwind module and DTCG structure, history/persistence/shortcuts, and jsdom UI flows). `pnpm run typecheck:studio`: no diagnostics. `pnpm vite build`: OK; `scripts/check-route-collisions.mjs`: no collisions. `git diff --check`: clean. No lint script exists in the repository. Main's existing gamut, Brettel, editor, persistence and 130-check legacy suites pass unchanged.

Browser (headless Chromium 1254, production build via `vite preview`, API requests aborted) — `evidence/browser.json`:
- 375/768/1024/1440 px × dark/light × Palette, Mood, Accessibility, Export: no horizontal overflow (32 checks).
- Space generates (no scroll), ignored in the seed field; lock holds across three generations; Ctrl+Z / Ctrl+Shift+Z; editing locks the swatch; copy writes the clipboard; use-as-seed regenerates both themes; 45 scale steps; 10 pair cards.
- Grey seed `#808080`: `bg #F8F8F8`, `surface #EEEEEE`, `border #B1B1B1`, secondary `#995962`; undo restores the previous seed; Compare themes side by side.
- Export: all four downloads fire and CSS/Tailwind/tokens files equal their previews; tokens contain `ui.light` and `ui.dark`; SVG preview renders 936×376.
- Reload keeps mood mode, locks and swatches; Contrast Checker suggestions pass AA with grades; `/palette` route renders; 375 px touch + reduced motion: tap generates, locks visible without hover. No console errors.

Bundle: `PaletteStudio` route chunk 22.2 → 49.2 kB (7.1 → 15.9 kB gzip); route-split, so other pages are unaffected. No dependencies added.

Not verified: Safari/Firefox, real devices, screen readers, signed-in production flows (none involved).

## Limitations

- Saved palette collections are not implemented; history is per session.
- Collision threshold (OKLab 0.08) and the border check are heuristics/reporting only; generation does not auto-correct semantic hues or borders.
- Colour names are descriptive, not a curated dictionary; `getSeedSymbolism` keeps its own editorial hue bands.
- Tailwind output uses the v3 config shape (usable via `@config` in v4); DTCG uses the 2025.10 object colour value.
- Role colour pickers keep main's 40×28 px size.

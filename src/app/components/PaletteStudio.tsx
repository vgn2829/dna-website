import { useState, useCallback, useEffect, useMemo, useReducer, useRef, useId, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, Copy, Crosshair, Dices, Download, Lock, LockOpen, Pipette, Redo2, Undo2 } from "lucide-react";
import { loadEditor, persistEditor, serializeEditor } from "../lib/palette/persistence";
import { paletteCSS, type Editor, type EditorAction, type Theme } from "../lib/palette/editor";
import {
  deriveVisualPalette,
  scorePalette,
  analyzeCB,
  HARMONY_MODES,
  hexToRgb,
  rgbToHex,
  rgbToOKLCH,
  contrastRatio,
  simulateCB,
  getSeedSymbolism,
  type Harmony,
  type Palette,
  type Role,
} from "../lib/palette/engine";
import { CREATIVE_MODES, foreground, paletteWarnings, randomSeedColour } from "../lib/palette-engine";
import { createUndoable, loadMood, newVariation, paletteShortcut, persistMood, serializeMood, undoableReducer, undoHistory, redoHistory, HISTORY_LIMIT, MOODS, type MoodState, type StudioAction } from "../lib/palette/studio";
import { colourName } from "../lib/palette/naming";
import { tonalScale } from "../lib/palette/scales";
import { contrastGrade, nonTextChecks, semanticCollisions, COLLISION_DISTANCE } from "../lib/palette/contrast";
import { EXPORT_FORMATS, exportPalette, moodCss, type ExportFormat } from "../lib/palette/export";
import { studioDrafts, useStudioDraft } from "./studio/drafts";
import { copyText, saveBlob } from "./StudioUI";
import { LibraryDialog } from "./assets/LibraryDialog";
export {
  derivePalette,
  deriveVisualPalette,
  scorePalette,
  analyzeCB,
  HARMONY_MODES,
} from "../lib/palette/engine";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED LABELS
// ─────────────────────────────────────────────────────────────────────────────

/** WCAG grade chip. Colour is supportive; the AA/AAA/Fail label carries meaning. */
function GradeChip({ ratio }: { ratio: number }) {
  const g = contrastGrade(ratio);
  return <span className="palette-grade" data-level={g.level === "AA Large" ? "large" : g.level.toLowerCase()}>{g.level}</span>;
}

const ROLES: { key: Role; label: string; group: "base" | "brand" | "semantic" }[] = [
  { key: "bg",             label: "Background",        group: "base"     },
  { key: "surface",        label: "Surface",           group: "base"     },
  { key: "surfaceElevated",label: "Surface Elevated",  group: "base"     },
  { key: "text",           label: "Text",              group: "base"     },
  { key: "textMuted",      label: "Text Muted",        group: "base"     },
  { key: "border",         label: "Border",            group: "base"     },
  { key: "primary",        label: "Primary",           group: "brand"    },
  { key: "primaryFg",      label: "Primary Fg",        group: "brand"    },
  { key: "secondary",      label: "Secondary",         group: "brand"    },
  { key: "accent",         label: "Accent",            group: "brand"    },
  { key: "success",        label: "Success",           group: "semantic" },
  { key: "successBg",      label: "Success BG",        group: "semantic" },
  { key: "warning",        label: "Warning",           group: "semantic" },
  { key: "warningBg",      label: "Warning BG",        group: "semantic" },
  { key: "error",          label: "Error",             group: "semantic" },
  { key: "errorBg",        label: "Error BG",          group: "semantic" },
  { key: "info",           label: "Info",              group: "semantic" },
  { key: "infoBg",         label: "Info BG",           group: "semantic" },
];

const GROUP_LABELS: Record<string, string> = {
  base:     "Neutrals & Structure",
  brand:    "Brand Colors",
  semantic: "Semantic States",
};

const UI_TABS = [
  { id: "palette",       label: "Roles"         },
  { id: "accessibility", label: "Accessibility" },
  { id: "colorblind",    label: "Colour blind"  },
];

/** "OKLCH hue offsets +120° / +240°" — derived from the engine's own harmony angles. */
const harmonyOffsets = (key: Harmony) => {
  const { secondary, accent } = HARMONY_MODES[key].getHues(0);
  return `OKLCH hue offsets +${Math.round(secondary)}° / +${Math.round(accent)}°`;
};
const isSixDigitHex = (value: string) => /^#?[0-9a-f]{6}$/i.test(value);
const toHex = (value: string) => (value.startsWith("#") ? value : `#${value}`).toUpperCase();

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// State, history, persistence and exports are the shared lib/palette modules:
// the role editor (both themes, exact locks) and the mood palette share one
// undo history; this component only presents them.
// ─────────────────────────────────────────────────────────────────────────────

export default function PaletteStudio() {
  const [initial] = useState(() => loadEditor(studioDrafts.get("palette.editor") as Editor | undefined));
  const [initialMood] = useState(() => loadMood(studioDrafts.get("palette.mood") as MoodState | undefined));
  const [studio, dispatchStudio] = useReducer(undoableReducer, undefined, () => createUndoable({ editor: initial.editor, mood: initialMood.mood }));
  const { editor, mood } = studio.history.present;
  const apply = useCallback((action: StudioAction, coalesce = "") => dispatchStudio({ type: "apply", action, coalesce, at: Date.now() }), []);
  const editRoles = (action: EditorAction, coalesce = "") => apply({ type: "editor", action }, coalesce);

  const [theme, setTheme] = useStudioDraft<Theme>("palette.theme", "light");
  const [savedTab, setTab] = useStudioDraft("palette.tab", "palette");
  const tab = UI_TABS.some((t) => t.id === savedTab) ? savedTab : "palette";
  const [compare, setCompare] = useState(false);
  const [seedInput, setSeedInput] = useState(editor.seed);
  const [message, setMessage] = useState(initial.error || initialMood.error || (initial.shared || initialMood.shared ? "Shared palette recipe loaded." : ""));
  const [copied, setCopied] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => { studioDrafts.set("palette.editor", editor); persistEditor(editor); }, [editor]);
  useEffect(() => { studioDrafts.set("palette.mood", mood); persistMood(mood); }, [mood]);
  // The seed field follows the committed seed (generation, use-as-seed, undo).
  useEffect(() => setSeedInput(editor.seed), [editor.seed]);
  useEffect(() => {
    if (!initial.shared && !initialMood.shared) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("palette");
    url.searchParams.delete("mood");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [initial.shared, initialMood.shared]);

  const palette = editor.variants[theme];
  const creative = useMemo(
    () => deriveVisualPalette(editor.seed, editor.harmony, mood.mode, mood.variation, mood.locks),
    [editor.seed, editor.harmony, mood],
  );

  /** Regenerates both theme variants (locks preserved) and optionally patches the mood, as one undo step. */
  const regenerate = useCallback((next: { seed?: string; harmony?: Harmony; variation?: string }, moodPatch: Partial<MoodState> = {}, note = "", coalesce = "") => {
    const actions: StudioAction[] = [{ type: "editor", action: { type: "generate", seed: next.seed ?? editor.seed, harmony: next.harmony ?? editor.harmony, variation: next.variation ?? editor.variation } }];
    if (Object.keys(moodPatch).length) actions.push({ type: "mood", patch: moodPatch });
    apply({ type: "batch", actions }, coalesce);
    setMessage(note);
  }, [apply, editor.seed, editor.harmony, editor.variation]);

  const generate = useCallback(() => {
    const variation = newVariation();
    regenerate({ variation }, { variation }, "New variation generated. Locked colours were kept.");
  }, [regenerate]);
  const randomSeed = () => {
    const variation = newVariation();
    regenerate({ seed: randomSeedColour(variation), variation }, { variation }, "Random seed generated.");
  };
  const travel = useCallback((direction: "undo" | "redo") => {
    const history = direction === "undo" ? undoHistory(studio.history) : redoHistory(studio.history);
    if (history === studio.history) return;
    dispatchStudio({ type: direction });
    setMessage(direction === "undo" ? "Undone." : "Redone.");
  }, [studio.history]);

  // Space / Ctrl+Z / Ctrl+Shift+Z — only when focus is not on a control (see paletteShortcut).
  const keyHandlers = useRef({ generate, travel, exportOpen });
  keyHandlers.current = { generate, travel, exportOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyHandlers.current.exportOpen) return;
      const action = paletteShortcut(e);
      if (!action) return;
      e.preventDefault();
      if (action === "generate") keyHandlers.current.generate();
      else if (action !== "suppress") keyHandlers.current.travel(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shareRecipe = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "palette");
      url.searchParams.set("palette", serializeEditor(editor));
      url.searchParams.set("mood", serializeMood(mood));
      await copyText(url.toString());
      setMessage("Reproducible palette link copied.");
      return true;
    } catch { setMessage("Link copy failed. Check clipboard permission."); return false; }
  };

  const copyColor = async (hex: string, id = hex) => {
    try { await copyText(hex); } catch { setMessage("Clipboard unavailable. Select and copy the hex value manually."); return; }
    setCopied(id); setMessage(`Copied ${hex}.`);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(""), 1500);
  };

  const toggleCreativeLock = (index: number, hex: string, name: string) => {
    const locks = { ...mood.locks };
    if (locks[index]) delete locks[index]; else locks[index] = hex;
    apply({ type: "mood", patch: { locks } });
    setMessage(`${name} ${locks[index] ? "locked" : "unlocked"}.`);
  };
  const editCreative = (index: number, hex: string, name: string) => {
    apply({ type: "mood", patch: { locks: { ...mood.locks, [index]: hex.toUpperCase() } } }, `mood-${index}`);
    setMessage(`${name} set to ${hex.toUpperCase()} and locked.`);
  };

  const symbolism = getSeedSymbolism(editor.seed);
  const warnings = paletteWarnings(palette);
  const lockedCount = Object.keys(mood.locks).length;
  const roleLockCount = Object.keys(editor.locks).length;
  const fitness = useMemo(() => scorePalette(palette), [palette]);
  const cbData = useMemo(() => analyzeCB(palette), [palette]);
  const pairs = Object.values(fitness.pairs);
  const passRate = Math.round((pairs.filter((p) => p.cr >= 4.5).length / pairs.length) * 100);
  const ids = useId();
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = UI_TABS[(index + (e.key === "ArrowRight" ? 1 : UI_TABS.length - 1)) % UI_TABS.length];
    setTab(next.id);
    document.getElementById(`${ids}-tab-${next.id}`)?.focus();
  };

  return (
    <div className="palette-tool palette-studio">
      {/* ── Generation controls ─────────────────────────────────────────── */}
      <div className="palette-toolbar">
        <div className="palette-toolbar-group">
          <label className="palette-seed">
            <span className="palette-seed-label">Seed</span>
            {/* Swatch painted on the wrapper with a transparent native picker over it. */}
            <span className="palette-seed-chip" style={{ background: editor.seed }}>
              <input type="color" value={editor.seed.toLowerCase()} onChange={(e) => regenerate({ seed: e.target.value.toUpperCase() }, {}, "", "seed")} className="palette-color-overlay" aria-label="Pick seed colour" />
            </span>
            <span className="palette-seed-divider" aria-hidden="true" />
            <input
              type="text" value={seedInput} spellCheck={false} maxLength={7}
              className="palette-seed-input" aria-label="Seed hex"
              onChange={(e) => {
                const value = e.target.value.trim();
                if (!/^#?[0-9A-Fa-f]{0,6}$/.test(value)) return;
                setSeedInput(value.startsWith("#") || !value ? value : `#${value}`);
                if (isSixDigitHex(value) && toHex(value) !== editor.seed) regenerate({ seed: toHex(value) }, {}, "", "seed");
              }}
              onBlur={() => setSeedInput(editor.seed)}
            />
          </label>
          <button type="button" className="btn-icon" onClick={randomSeed} aria-label="Random seed colour" title="Random seed colour"><Dices size={18} aria-hidden="true" /></button>
        </div>
        <div className="palette-toolbar-group palette-toolbar-actions">
          <button type="button" className="btn-icon" onClick={() => travel("undo")} disabled={!studio.history.past.length} aria-label="Undo" title={`Undo (${isMac ? "⌘Z" : "Ctrl+Z"})`}><Undo2 size={18} aria-hidden="true" /></button>
          <button type="button" className="btn-icon" onClick={() => travel("redo")} disabled={!studio.history.future.length} aria-label="Redo" title={`Redo (${isMac ? "⇧⌘Z" : "Ctrl+Shift+Z"})`}><Redo2 size={18} aria-hidden="true" /></button>
          <button type="button" className="btn-secondary" onClick={() => setExportOpen(true)}><Download size={16} aria-hidden="true" />Export</button>
          <button type="button" className="btn-primary" onClick={generate}>Generate</button>
        </div>
      </div>

      {/* ── Harmony and creative mode ──────────────────────────────────── */}
      <div className="palette-config">
        <div className="palette-config-group">
          <span className="palette-control-label" id={`${ids}-harmony`}>Harmony</span>
          <div className="segmented studio-choice" role="group" aria-labelledby={`${ids}-harmony`}>
            {Object.entries(HARMONY_MODES).map(([key, m]) => (
              <button type="button" key={key} className="segmented-item" aria-pressed={editor.harmony === key} onClick={() => regenerate({ harmony: key as Harmony })}>{m.label}</button>
            ))}
          </div>
          <p className="palette-hint">{harmonyOffsets(editor.harmony)}</p>
        </div>
        <div className="palette-config-group">
          <span className="palette-control-label" id={`${ids}-mode`}>Creative mode</span>
          <div className="segmented studio-choice" role="group" aria-labelledby={`${ids}-mode`}>
            {MOODS.map((key) => (
              <button type="button" key={key} className="segmented-item" aria-pressed={mood.mode === key} onClick={() => apply({ type: "mood", patch: { mode: key } })}>{CREATIVE_MODES[key].label}</button>
            ))}
          </div>
          <p className="palette-hint">{CREATIVE_MODES[mood.mode].description}</p>
        </div>
      </div>

      {/* ── Main palette workspace ─────────────────────────────────────── */}
      <section aria-label="Palette" className="palette-workspace">
        <div className="palette-columns">
          {creative.map((swatch) => {
            const locked = !!mood.locks[swatch.index];
            const name = colourName(swatch.hex), { L, C, H } = rgbToOKLCH(hexToRgb(swatch.hex));
            const id = `col-${swatch.index}`;
            return (
              <div key={swatch.index} className="palette-column" role="group" aria-label={`${swatch.name}: ${name}, ${swatch.hex}${locked ? ", locked" : ""}`} style={{ background: swatch.hex, color: foreground(swatch.hex) }}>
                <div className="palette-column-actions">
                  <button type="button" className="btn-icon btn-sm touch-target" aria-pressed={locked} onClick={() => toggleCreativeLock(swatch.index, swatch.hex, swatch.name)} aria-label={`${locked ? "Unlock" : "Lock"} ${swatch.name} swatch`} title={locked ? "Unlock" : "Lock"}>
                    {locked ? <Lock size={15} aria-hidden="true" /> : <LockOpen size={15} aria-hidden="true" />}
                  </button>
                  <label className="btn-icon btn-sm touch-target palette-edit" title="Edit colour">
                    <Pipette size={15} aria-hidden="true" />
                    <input type="color" className="palette-color-overlay" value={swatch.hex.toLowerCase()} onChange={(e) => editCreative(swatch.index, e.target.value, swatch.name)} aria-label={`Edit ${swatch.name} swatch`} />
                  </label>
                  <button type="button" className="btn-icon btn-sm touch-target" onClick={() => regenerate({ seed: swatch.hex }, {}, `${swatch.hex} is now the seed.`)} aria-label={`Use ${swatch.name} swatch as seed`} title="Use as seed" disabled={swatch.hex === editor.seed}>
                    <Crosshair size={15} aria-hidden="true" />
                  </button>
                </div>
                <div className="palette-column-info">
                  <span className="palette-column-role">{swatch.name}{locked && <span className="sr-only"> (locked)</span>}</span>
                  <button type="button" className="palette-column-hex" onClick={() => copyColor(swatch.hex, id)} aria-label={`Copy ${swatch.name} ${swatch.hex}`}>
                    {copied === id ? <><Check size={16} aria-hidden="true" />Copied</> : <>{swatch.hex}<Copy size={14} aria-hidden="true" className="palette-copy-icon" /></>}
                  </button>
                  <span className="palette-column-name">{name}</span>
                  <span className="palette-column-oklch" title={`oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`}>
                    <span>L {(L * 100).toFixed(1)}</span><span>C {C.toFixed(3)}</span><span>H {C < 1e-4 ? "—" : H.toFixed(0)}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-meta">
          <p className="palette-hint">
            <kbd>Space</kbd> generates · <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>+<kbd>Z</kbd> undo · Locked colours stay exact{lockedCount > 0 && <> · {lockedCount} locked <button type="button" className="btn-secondary btn-sm" onClick={() => apply({ type: "mood", patch: { locks: {} } })}>Unlock all</button></>}
          </p>
          <p className="palette-status" role="status">{message}</p>
        </div>
        {symbolism && (
          <p className="palette-hint palette-symbolism">
            <span className="palette-dot" style={{ background: editor.seed }} aria-hidden="true" />
            <strong>{symbolism.label}</strong> · {symbolism.keywords.join(", ")} — {symbolism.mood}
          </p>
        )}
        <details className="palette-disclosure">
          <summary>Reproducible variation: <code>{mood.variation}</code></summary>
          <label className="palette-variation">
            The same seed, harmony, mode, locks and variation always reproduce this palette.
            <input className="input-base" maxLength={128} value={mood.variation} onChange={(e) => regenerate({ variation: e.target.value }, { variation: e.target.value }, "", "variation")} aria-label="Palette variation" />
          </label>
          <p className="palette-hint">History keeps the last {HISTORY_LIMIT} states for this session.</p>
        </details>
      </section>

      {/* ── Tonal scales ───────────────────────────────────────────────── */}
      <section className="palette-section" aria-labelledby={`${ids}-scales`}>
        <h2 className="type-headline palette-section-title" id={`${ids}-scales`}>Tonal scales</h2>
        <p className="palette-hint">100–900 at constant OKLCH hue. The marked step is the swatch itself; select any step to copy it.</p>
        <div className="palette-scales">
          {creative.map((swatch) => (
            <div key={swatch.index} className="palette-scale-row" role="group" aria-label={`${swatch.name} tonal scale`}>
              <div className="palette-scale-label"><strong>{swatch.name}</strong><span>{colourName(swatch.hex)}</span></div>
              <div className="palette-scale-steps">
                {tonalScale(swatch.hex).map((step) => {
                  const id = `scale-${swatch.index}-${step.step}`;
                  return (
                    <button type="button" key={step.step} className="palette-scale-step" style={{ background: step.hex, color: foreground(step.hex) }} onClick={() => copyColor(step.hex, id)} aria-label={`Copy ${swatch.name} ${step.step} ${step.hex}${step.source ? " (source colour)" : ""}`}>
                      <span>{step.step}{step.source && <span aria-hidden="true"> ●</span>}</span>
                      <span className="palette-scale-hex">{copied === id ? "Copied" : step.hex}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Accessibility of the creative palette ──────────────────────── */}
      <details className="palette-section palette-disclosure">
        <summary>Colour details and contrast pairs</summary>
        <PaletteContrast swatches={creative} />
      </details>

      {/* ── UI system ──────────────────────────────────────────────────── */}
      <section className="palette-section" aria-labelledby={`${ids}-ui`}>
        <div className="palette-section-head">
          <div>
            <h2 className="type-headline palette-section-title" id={`${ids}-ui`}>UI system</h2>
            <p className="palette-hint">18 interface roles from the same seed and harmony, repaired to WCAG AA (4.5:1) unless a lock prevents it.</p>
          </div>
          <div className="segmented" role="group" aria-label="UI system theme">
            <button type="button" className="segmented-item" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Light</button>
            <button type="button" className="segmented-item" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Dark</button>
          </div>
        </div>
        {warnings.length > 0 && <p role="alert" className="palette-warning">{warnings.join(" ")}</p>}
        <div className="segmented palette-result-tabs" role="tablist" aria-label="UI system views">
          {UI_TABS.map((t2, index) => (
            <button type="button" key={t2.id} id={`${ids}-tab-${t2.id}`} role="tab" aria-selected={tab === t2.id} aria-controls={`${ids}-panel`} tabIndex={tab === t2.id ? 0 : -1} onKeyDown={(e) => onTabKey(e, index)} onClick={() => setTab(t2.id)} className="segmented-item">{t2.label}</button>
          ))}
        </div>
        <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`} className="palette-tabpanel">
          {tab === "palette" && (
            <>
              <div className="palette-score">
                <div><span className="palette-score-label">Role pass rate</span><span className="palette-score-value">{passRate}<small>/100</small></span></div>
                <div><span className="palette-score-label">Colour separation (heuristic)</span><span className="palette-score-value is-secondary">{fitness.dScore}%</span></div>
              </div>
              {(["base", "brand", "semantic"] as const).map((group) => (
                <section key={group} className="palette-role-group">
                  <h3 className="palette-group-title">{GROUP_LABELS[group]}</h3>
                  <div className="palette-role-grid">
                    {ROLES.filter((r) => r.group === group).map((role) => {
                      const hex = palette[role.key], isLocked = !!editor.locks[role.key], id = `role-${role.key}`;
                      return (
                        <div key={role.key} className="palette-role" data-locked={isLocked || undefined}>
                          <button type="button" className="palette-role-colour" data-role={role.key} onClick={() => copyColor(hex, id)} aria-label={`Copy ${role.label} ${hex}`} style={{ background: hex, color: foreground(hex) }}>
                            {copied === id ? "Copied" : hex}
                          </button>
                          <div className="palette-role-foot">
                            <span>{role.label}</span>
                            <input className="palette-role-picker" type="color" aria-label={`Edit ${role.label}`} value={hex.toLowerCase()} onChange={(e) => editRoles({ type: "edit", theme, role: role.key, value: e.target.value }, `edit-${theme}-${role.key}`)} />
                            <button type="button" onClick={() => editRoles({ type: "lock", theme, role: role.key })} aria-label={`${isLocked ? "Unlock" : "Lock"} ${role.label}`} className="btn-icon btn-sm touch-target" aria-pressed={isLocked}>
                              {isLocked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              {roleLockCount > 0 && (
                <p className="palette-hint">
                  {roleLockCount} role{roleLockCount > 1 ? "s" : ""} locked — regenerating preserves them.{" "}
                  <button type="button" className="btn-secondary btn-sm" onClick={() => editRoles({ type: "unlockAll" })}>Clear all</button>
                </p>
              )}
              <div className="palette-preview-head">
                <h3 className="palette-group-title">Preview</h3>
                <button type="button" className="btn-secondary btn-sm" aria-pressed={compare} onClick={() => setCompare((v) => !v)}>Compare light and dark</button>
              </div>
              {compare ? (
                <div className="palette-compare">
                  {(["light", "dark"] as const).map((t) => (
                    <section key={t} aria-label={`${t} preview`}>
                      <h4 className="palette-hint">{t === "light" ? "Light" : "Dark"}</h4>
                      <Preview palette={editor.variants[t]} />
                    </section>
                  ))}
                </div>
              ) : (
                <Preview palette={palette} />
              )}
            </>
          )}
          {tab === "accessibility" && (
            <>
              <AccessibilityTab palette={palette} fitness={fitness} />
              <RoleChecks palette={palette} theme={theme} />
            </>
          )}
          {tab === "colorblind" && <ColorBlindTab palette={palette} cbData={cbData} />}
        </div>
      </section>

      {exportOpen && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          editor={editor}
          swatches={creative}
          title={`${CREATIVE_MODES[mood.mode].label} · ${HARMONY_MODES[editor.harmony].label} · seed ${editor.seed}`}
          onShare={shareRecipe}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

type Swatch = ReturnType<typeof deriveVisualPalette>[number];

/** Pairwise WCAG contrast for the creative palette: harmony is not accessibility. */
function PaletteContrast({ swatches }: { swatches: Swatch[] }) {
  const pairs: { a: Swatch; b: Swatch; ratio: number }[] = [];
  for (let i = 0; i < swatches.length; i++) for (let j = i + 1; j < swatches.length; j++) {
    const [a, b] = [swatches[i], swatches[j]];
    // Show the lighter colour as background so the pair reads as text-on-surface.
    const ordered = rgbToOKLCH(hexToRgb(a.hex)).L >= rgbToOKLCH(hexToRgb(b.hex)).L ? { a: b, b: a } : { a, b };
    pairs.push({ ...ordered, ratio: contrastRatio(hexToRgb(a.hex), hexToRgb(b.hex)) });
  }
  pairs.sort((x, y) => y.ratio - x.ratio);
  return (
    <div className="palette-details">
      <div className="palette-table-wrap" tabIndex={0} role="region" aria-label="Colour values (scrolls horizontally on small screens)">
        <table className="palette-table">
          <caption className="sr-only">Colour values for each swatch</caption>
          <thead><tr><th scope="col">Role</th><th scope="col">Name</th><th scope="col">HEX</th><th scope="col">RGB</th><th scope="col">OKLCH</th><th scope="col">Best text</th></tr></thead>
          <tbody>
            {swatches.map((s) => {
              const { r, g, b } = hexToRgb(s.hex), { L, C, H } = rgbToOKLCH(hexToRgb(s.hex)), fg = foreground(s.hex), ratio = contrastRatio(hexToRgb(fg), hexToRgb(s.hex));
              return (
                <tr key={s.index}>
                  <th scope="row"><span className="palette-dot" style={{ background: s.hex }} aria-hidden="true" />{s.name}</th>
                  <td>{colourName(s.hex)}</td>
                  <td className="is-mono">{s.hex}</td>
                  <td className="is-mono">{[r, g, b].map((v) => Math.round(v * 255)).join(", ")}</td>
                  <td className="is-mono">{(L * 100).toFixed(1)}% {C.toFixed(3)} {C < 1e-4 ? 0 : H.toFixed(1)}</td>
                  <td><span className="is-mono">{fg === "#FFFFFF" ? "White" : "Black"} {ratio.toFixed(2)}:1</span> <GradeChip ratio={ratio} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="palette-hint">Harmonious colours are not automatically readable together. AA needs 4.5:1 for body text (3:1 for large text and UI parts); AAA needs 7:1.</p>
      <div className="palette-pairs">
        {pairs.map(({ a, b, ratio }) => {
          const g = contrastGrade(ratio);
          return (
            <div key={`${a.index}-${b.index}`} className="palette-pair">
              {/* Only the sample uses the pair's own colours; its label stays readable on the card. */}
              <div className="palette-pair-sample" style={{ background: b.hex, color: a.hex }} aria-hidden="true">Aa</div>
              <div className="palette-pair-meta">
                <span className="palette-pair-name">{a.name} on {b.name}</span>
                <span className="is-mono">{ratio.toFixed(2)}:1</span>
                <GradeChip ratio={ratio} />
                <span className="palette-pair-uses">{g.normalAAA ? "Any text" : g.normalAA ? "Body text (AA)" : g.largeAA ? "Large text / UI only" : "Decorative only"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExportDialog({ onClose, editor, swatches, title, onShare }: { onClose: () => void; editor: Editor; swatches: Swatch[]; title: string; onShare: () => Promise<boolean> }) {
  type Format = "css" | ExportFormat | "json";
  const formats: { id: Format; label: string; filename: string; mime: string }[] = [
    { id: "css", label: "CSS variables", filename: "dna-palette.css", mime: "text/css" },
    ...EXPORT_FORMATS,
    { id: "json", label: "Mood JSON", filename: "dna-mood.json", mime: "application/json" },
  ];
  const [format, setFormat] = useState<Format>("css");
  const [includeScales, setIncludeScales] = useState(true);
  const [includeRoles, setIncludeRoles] = useState(true);
  const [status, setStatus] = useState("");
  const meta = formats.find((f) => f.id === format)!;
  const input = { swatches: swatches.map((s) => ({ role: s.name, hex: s.hex })), themes: includeRoles ? editor.variants : undefined, includeScales, title };
  let output = "", error = "";
  try {
    output =
      format === "css" ? (includeRoles ? paletteCSS(editor) : "") + moodCss(input)
      : format === "json" ? JSON.stringify(swatches, null, 2) + "\n"
      : exportPalette(format, input);
  } catch (e) { error = e instanceof Error ? e.message : "Export failed"; }
  const copy = async () => {
    try { await copyText(output); setStatus(`${meta.label} copied.`); }
    catch { setStatus("Copy failed. Select the code and copy it manually, or download the file."); }
  };
  const download = () => { saveBlob(new Blob([output], { type: meta.mime }), meta.filename); setStatus(`Downloaded ${meta.filename}.`); };
  const svgOnly = format === "svg", jsonOnly = format === "json";
  return (
    <LibraryDialog
      title="Export palette"
      subtitle={title}
      onClose={onClose}
      maxWidth={760}
      footer={<>
        <button type="button" className="btn-secondary" onClick={async () => setStatus(await onShare() ? "Reproducible palette link copied." : "Link copy failed. Check clipboard permission.")}>Copy share link</button>
        <button type="button" className="btn-secondary" onClick={copy} disabled={!!error}><Copy size={16} aria-hidden="true" />Copy</button>
        <button type="button" className="btn-primary" onClick={download} disabled={!!error}><Download size={16} aria-hidden="true" />Download {meta.filename.split(".").pop()?.toUpperCase()}</button>
      </>}
    >
      <div className="palette-export">
        <div className="segmented studio-choice" role="group" aria-label="Export format">
          {formats.map((f) => <button type="button" key={f.id} className="segmented-item" aria-pressed={format === f.id} onClick={() => { setFormat(f.id); setStatus(""); }}>{f.label}</button>)}
        </div>
        <div className="palette-export-options">
          <label className="studio-check"><input type="checkbox" checked={includeScales} disabled={svgOnly || jsonOnly} onChange={(e) => setIncludeScales(e.target.checked)} />Include 100–900 tonal scales</label>
          <label className="studio-check"><input type="checkbox" checked={includeRoles} disabled={svgOnly || jsonOnly} onChange={(e) => setIncludeRoles(e.target.checked)} />Include UI system roles (light and dark)</label>
        </div>
        {error ? <p role="alert" className="palette-warning">{error}</p> : svgOnly ? (
          <img className="palette-export-preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(output)}`} alt="SVG swatch card preview" />
        ) : (
          <pre className="palette-export-code" tabIndex={0} aria-label={`${meta.label} output`}><code>{output}</code></pre>
        )}
        <p className="palette-status" role="status">{status}</p>
      </div>
    </LibraryDialog>
  );
}

const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));
/** Checks that pair-wise text contrast does not cover: non-text borders and semantic-role confusion. */
function RoleChecks({ palette, theme }: { palette: Palette; theme: Theme }) {
  const borders = nonTextChecks(palette);
  const collisions = semanticCollisions(palette);
  return (
    <div className="palette-role-checks">
      <h3 className="palette-group-title">Non-text contrast · {theme}</h3>
      <p className="palette-hint">WCAG 1.4.11 asks for 3:1 when a border is what identifies a control, such as an input outline. Decorative separators between surfaces are exempt.</p>
      <div className="palette-pairs">
        {borders.map((check) => (
          <div key={check.name} className="palette-pair">
            <div className="palette-pair-sample" style={{ background: palette[check.bg as Role] }} aria-hidden="true">
              <span className="palette-border-sample" style={{ borderColor: palette[check.fg as Role] }} />
            </div>
            <div className="palette-pair-meta">
              <span className="palette-pair-name">{check.name}</span>
              <span className="is-mono">{check.ratio.toFixed(2)}:1</span>
              <span className="palette-grade" data-level={check.pass ? "aa" : "large"}>{check.pass ? "3:1 pass" : "Below 3:1"}</span>
              <span className="palette-pair-uses">{check.pass ? "Usable for control outlines" : "Decorative separators only"}</span>
            </div>
          </div>
        ))}
      </div>
      <h3 className="palette-group-title">Semantic colour distinctness · {theme}</h3>
      <p className="palette-hint">Brand colours that resemble a status colour, and status colours that converge under simulated colour-vision deficiency (Brettel 1997), measured as OKLab distance below {COLLISION_DISTANCE}. A heuristic: pair status colours with icons or text either way.</p>
      {collisions.length === 0 ? (
        <p className="palette-hint"><strong>No close pairs found.</strong> Brand and status colours stay apart, including under the three simulations.</p>
      ) : (
        <ul className="palette-checklist">
          {collisions.map((c) => (
            <li key={`${c.a}-${c.b}-${c.condition}`}>
              <span className="palette-checklist-swatches" aria-hidden="true">
                <span style={{ background: palette[c.a as Role] }} />
                <span style={{ background: palette[c.b as Role] }} />
              </span>
              <span><strong>{ROLE_LABEL[c.a]}</strong> and <strong>{ROLE_LABEL[c.b]}</strong> are close {c.condition === "typical vision" ? "for typical colour vision" : `under ${c.condition}`}</span>
              <span className="is-mono">ΔOK {c.distance.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Preview({ palette: p }: { palette: Palette }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {/* Dashboard card */}
      <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: "var(--radius-lg)", padding: 22, flex: "1 1 320px", maxWidth: 440, minWidth: 0, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ color: p.textMuted, fontSize: 9, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 2 }}>Overview</div>
            <div style={{ color: p.text, fontSize: 16, fontWeight: 800, letterSpacing: "-.02em" }}>Dashboard</div>
          </div>
          <div style={{ background: p.primary, color: p.primaryFg, padding: "6px 12px", borderRadius: 7, fontSize: 10, fontWeight: 700 }}>+ New</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginBottom: 13 }}>
          {[
            { label: "Active",  val: "12", col: p.primary },
            { label: "Done",    val: "48", col: p.success },
            { label: "Pending", val: "6",  col: p.warning },
            { label: "Issues",  val: "2",  col: p.error   },
          ].map((stat) => (
            <div key={stat.label} style={{ background: p.surface, border: `1px solid ${p.border}`, borderRadius: "var(--radius-sm)", padding: "9px 11px" }}>
              <div style={{ color: p.textMuted, fontSize: 8, textTransform: "uppercase", letterSpacing: ".1em", opacity: .5, marginBottom: 2 }}>{stat.label}</div>
              <div style={{ color: stat.col, fontSize: 18, fontWeight: 800 }}>{stat.val}</div>
            </div>
          ))}
        </div>
        <div style={{ background: p.surfaceElevated, border: `1px solid ${p.border}`, borderRadius: "var(--radius-sm)", padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ color: p.text, fontSize: 11, fontWeight: 600, marginBottom: 7 }}>Recent Activity</div>
          {[
            { msg: "Deploy to production succeeded", type: "success" },
            { msg: "PR #42 awaiting review",         type: "warning" },
            { msg: "2 tests failing on main",        type: "error"   },
          ].map((a, i) => {
            const dotColor = a.type === "success" ? p.success : a.type === "warning" ? p.warning : p.error;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 0", borderTop: i > 0 ? `1px solid ${p.border}` : "none" }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                <span style={{ color: p.text, fontSize: 10 }}>{a.msg}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          {[
            { bg: p.primary,   fg: p.primaryFg, label: "Primary"   },
            { bg: p.secondary, fg: foreground(p.secondary), label: "Secondary" },
            { bg: p.accent,    fg: foreground(p.accent), label: "Accent"    },
          ].map((b) => (
            <div key={b.label} style={{ flex: 1, background: b.bg, color: b.fg, padding: 8, borderRadius: 7, fontSize: 10, fontWeight: 700, textAlign: "center" }}>
              {b.label}
            </div>
          ))}
        </div>
      </div>

      {/* Typography + semantic cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: "var(--radius-lg)", padding: 22 }}>
          <div style={{ color: p.textMuted, fontSize: 9, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 10 }}>Typography</div>
          <div style={{ color: p.primary, fontSize: 22, fontWeight: 900, letterSpacing: "-.025em", lineHeight: 1.1, marginBottom: 4 }}>Display Heading</div>
          <div style={{ color: p.text, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Section Title</div>
          <div style={{ color: p.text, fontSize: 11, lineHeight: 1.75, marginBottom: 6 }}>Body text renders cleanly with sufficient contrast for extended reading.</div>
          <div style={{ color: p.textMuted, fontSize: 10, lineHeight: 1.65 }}>Muted helper text for metadata and secondary content.</div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {[
              { bg: p.primary,   fg: p.primaryFg, label: "Primary"   },
              { bg: p.secondary, fg: foreground(p.secondary), label: "Secondary" },
              { bg: p.accent,    fg: foreground(p.accent), label: "Accent"    },
            ].map((t) => (
              <div key={t.label} style={{ background: t.bg, color: t.fg, padding: "3px 10px", borderRadius: "var(--radius-xl)", fontSize: 9, fontWeight: 700 }}>{t.label}</div>
            ))}
          </div>
        </div>
        <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: "var(--radius-lg)", padding: 22 }}>
          <div style={{ color: p.textMuted, fontSize: 9, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 10 }}>Semantic States</div>
          {[
            { label: "Success", color: p.success, bg: p.successBg, msg: "Deploy completed"     },
            { label: "Warning", color: p.warning, bg: p.warningBg, msg: "Session expires soon"  },
            { label: "Error",   color: p.error,   bg: p.errorBg,   msg: "Connection failed"     },
            { label: "Info",    color: p.info,    bg: p.infoBg,    msg: "New version available" },
          ].map((sem) => (
            <div key={sem.label} style={{ background: sem.bg, border: `1px solid ${sem.color}40`, borderRadius: 7, padding: "8px 10px", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: sem.color, flexShrink: 0 }} />
              <span style={{ color: sem.color, fontSize: 9, fontWeight: 700, marginRight: 5 }}>{sem.label}</span>
              <span style={{ color: p.text, fontSize: 10 }}>{sem.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccessibilityTab({ palette, fitness }: { palette: Palette; fitness: ReturnType<typeof scorePalette> }) {
  const keyMap: Record<string, Role> = {
    Text: "text", TextMuted: "textMuted", Primary: "primary", PrimaryFg: "primaryFg",
    Secondary: "secondary", Accent: "accent", Success: "success", Error: "error",
    Warning: "warning", BG: "bg", Surface: "surface", SuccessBg: "successBg",
    ErrorBg: "errorBg", WarningBg: "warningBg", Info: "info", InfoBg: "infoBg",
    SurfaceElevated: "surfaceElevated",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))", gap: 10 }}>
      {Object.entries(fitness.pairs).map(([name, data]) => {
        const parts  = name.split(" / ");
        const fgHex  = palette[keyMap[parts[0]]] || palette.text;
        const bgHex  = palette[keyMap[parts[1]]] || palette.bg;

        return (
          <div
            key={name}
            style={{
              background: "var(--color-surface-1)",
              border: "1px solid var(--color-hairline)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}
          >
            {/* Live text preview on actual palette background */}
            <div style={{ background: bgHex, padding: "14px 16px", minHeight: 56, display: "flex", alignItems: "center" }}>
              <span style={{ color: fgHex, fontSize: 13, fontWeight: 500, fontFamily: "var(--font-body)" }}>
                The quick brown fox jumps
              </span>
            </div>
            {/* Metadata row */}
            <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-ink)", marginBottom: 3 }}>{name}</div>
                <div style={{ fontSize: 10, color: "var(--color-ink-muted)" }}>
                  Normal AA needs 4.5:1; large AA 3:1; AAA 7:1
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <GradeChip ratio={data.cr} />
                <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--color-ink-muted)" }}>
                  {data.cr.toFixed(2)}:1
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColorBlindTab({ palette, cbData }: { palette: Palette; cbData: ReturnType<typeof analyzeCB> }) {
  const names: Record<string, string> = {
    protanopia:   "Protanopia (Red-blind)",
    deuteranopia: "Deuteranopia (Green-blind)",
    tritanopia:   "Tritanopia (Blue-blind)",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
      {Object.entries(cbData).map(([type, data]) => (
        <div
          key={type}
          style={{
            background: "var(--color-surface-1)",
            border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
          }}
        >
          {/* Card header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-hairline)" }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-ink-muted)", marginBottom: 3 }}>
              Approximate simulation (Brettel 1997)
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>
              {names[type]}
            </div>
          </div>
          {/* Simulated color strip */}
          <div style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", height: 36, borderRadius: "var(--radius-sm)", overflow: "hidden", marginBottom: 12 }}>
              {(["bg", "surface", "primary", "secondary", "accent", "text"] as const).map((k) => {
                const sim = simulateCB(hexToRgb(palette[k]), type as "protanopia" | "deuteranopia" | "tritanopia");
                return <div key={k} style={{ flex: 1, background: rgbToHex(sim) }} />;
              })}
            </div>
            {/* Contrast rows */}
            {[
              { label: "Text on BG",    ratio: data.textBgCR    },
              { label: "Primary on BG", ratio: data.primaryBgCR },
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--color-ink-muted)" }}>{row.label}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--color-ink-muted)" }}>
                    {row.ratio.toFixed(2)}:1
                  </span>
                  <GradeChip ratio={row.ratio} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

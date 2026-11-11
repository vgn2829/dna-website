import {loadEditor,persistEditor,serializeEditor} from "../lib/palette/persistence";
import { studioDrafts } from "./studio/drafts";
import { createUndoable, loadMood, newVariation, paletteShortcut, persistMood, serializeMood, undoableReducer, undoHistory, redoHistory, HISTORY_LIMIT, type MoodState, type StudioAction } from "../lib/palette/studio";
import { colourName } from "../lib/palette/naming";
import { tonalScale } from "../lib/palette/scales";
import { contrastGrade, nonTextChecks, semanticCollisions, COLLISION_DISTANCE } from "../lib/palette/contrast";
import { EXPORT_FORMATS, exportPalette, moodCss, type ExportFormat } from "../lib/palette/export";
/**
 * PaletteStudio
 * Self-contained palette generator.
 * Colour generation uses the verified Color.js-backed domain; the existing
 * editor retains both themes, exact locks, comparison and mood exploration.
 *
 * Tabler Icons (outline) loaded dynamically by PalettePage on mount.
 */

import {
  useState,
  useMemo,
  useReducer,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Copy, Crosshair, Download, Lock, LockOpen, Redo2, RefreshCw, Undo2 } from "lucide-react";
import {
  createEditor,
  paletteCSS,
  type EditorAction,
  type Theme,
} from "../lib/palette/editor";
import {
  normalizeHex,
  type Palette,
  type Harmony,
  type Role,
  type Mood,
} from "../lib/palette/engine";
import { copyText, saveBlob, Status } from "./StudioUI";

// ─────────────────────────────────────────────────────────────────────────────
// COLOR SCIENCE — OKLCH, gamut mapping, sRGB conversions
// ─────────────────────────────────────────────────────────────────────────────

import {
  derivePalette,
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
} from "../lib/palette/engine";
export {
  derivePalette,
  deriveVisualPalette,
  scorePalette,
  analyzeCB,
  HARMONY_MODES,
} from "../lib/palette/engine";
// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const GRADE = (n: number) => {
  if (n >= 7.0) return { label: "AAA", tone: "is-pass" };
  if (n >= 4.5) return { label: "AA", tone: "is-pass" };
  if (n >= 3.0) return { label: "Large AA only", tone: "is-warn" };
  return { label: "Fail", tone: "is-fail" };
};

const SCORE_COLOR = (s: number) =>
  s >= 85
    ? "var(--color-success)"
    : s >= 70
      ? "#84cc16"
      : s >= 55
        ? "#eab308"
        : "var(--color-error)";

const ROLES: {
  key: Role;
  label: string;
  group: "base" | "brand" | "semantic";
}[] = [
  { key: "bg", label: "Background", group: "base" },
  { key: "surface", label: "Surface", group: "base" },
  { key: "surfaceElevated", label: "Surface Elevated", group: "base" },
  { key: "text", label: "Text", group: "base" },
  { key: "textMuted", label: "Text Muted", group: "base" },
  { key: "border", label: "Border", group: "base" },
  { key: "primary", label: "Primary", group: "brand" },
  { key: "primaryFg", label: "Primary Fg", group: "brand" },
  { key: "secondary", label: "Secondary", group: "brand" },
  { key: "accent", label: "Accent", group: "brand" },
  { key: "success", label: "Success", group: "semantic" },
  { key: "successBg", label: "Success BG", group: "semantic" },
  { key: "warning", label: "Warning", group: "semantic" },
  { key: "warningBg", label: "Warning BG", group: "semantic" },
  { key: "error", label: "Error", group: "semantic" },
  { key: "errorBg", label: "Error BG", group: "semantic" },
  { key: "info", label: "Info", group: "semantic" },
  { key: "infoBg", label: "Info BG", group: "semantic" },
];

const GROUP_LABELS = {
  base: "Neutrals & Structure",
  brand: "Brand Colors",
  semantic: "Semantic States",
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function PaletteStudio() {
  const [initial] = useState(()=>loadEditor(studioDrafts.get("palette.editor") as ReturnType<typeof createEditor> | undefined));
  const [initialMood] = useState(()=>loadMood(studioDrafts.get("palette.mood") as MoodState | undefined));
  // One undo/redo history over the editor (both themes, locks) and the mood settings.
  const [studio, dispatchStudio] = useReducer(undoableReducer, undefined, () => createUndoable({ editor: initial.editor, mood: initialMood.mood }));
  const { editor, mood } = studio.history.present;
  const apply = useCallback((action: StudioAction, coalesce = "") => dispatchStudio({ type: "apply", action, coalesce, at: Date.now() }), []);
  const dispatch = useCallback((action: EditorAction, coalesce = "") => apply({ type: "editor", action }, coalesce), [apply]);
  const [variation,setVariation]=useState(editor.variation);
  useEffect(() => {
    studioDrafts.set("palette.editor", editor);
    persistEditor(editor);
  }, [editor]);
  useEffect(() => {
    studioDrafts.set("palette.mood", mood);
    persistMood(mood);
  }, [mood]);
  useEffect(() => {
    if (!initial.shared && !initialMood.shared) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("palette");
    url.searchParams.delete("mood");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [initial.shared, initialMood.shared]);
  const [seed, setSeed] = useState(editor.seed),
    [harmony, setHarmony] = useState<Harmony>(editor.harmony);
  const [theme, setTheme] = useState<Theme>("light"),
    [tab, setTab] = useState("palette");
  const [error, setError] = useState<string | null>(initial.error || initialMood.error || null),
    [message, setMessage] = useState(initial.shared ? "Shared palette recipe loaded." : "");
  const [compare, setCompare] = useState(false);
  const visualPalette = useMemo(
    () => deriveVisualPalette(editor.seed, editor.harmony, mood.mode, mood.variation, mood.locks),
    [editor.seed, editor.harmony, mood],
  );
  const palette = editor.variants[theme];
  const fitness = useMemo(() => scorePalette(palette), [palette]),
    cbData = useMemo(() => analyzeCB(palette), [palette]);
  const symbolism = getSeedSymbolism(editor.seed);
  const dirty =
    seed.toUpperCase() !== editor.seed || harmony !== editor.harmony || variation !== editor.variation;
  const failed = Object.values(fitness.pairs).filter((p) => p.cr < 4.5).length;
  const generate = () => {
    try {
      const valid = normalizeHex(seed);
      if(variation.length>128)throw new Error("Variation seed exceeds 128 characters");
      dispatch({ type: "generate", seed: valid, harmony, variation });
      setSeed(valid);
      setError(null);
      setMessage(
        "Generated both theme variants. Locked values were preserved.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async (value: string, note = "Copied to clipboard.") => {
    try {
      await copyText(value);
      setMessage(note);
      setError(null);
    } catch {
      setError("Copy failed. Select the displayed value or download the CSS.");
    }
  };
  const reroll = useCallback(() => {
    apply({ type: "mood", patch: { variation: newVariation() } });
    setMessage("New mood variation. Locked swatches were kept.");
  }, [apply]);
  // Undo/redo restore the whole studio state; the seed/harmony/variation drafts
  // follow the restored committed editor so nothing reads as "changed".
  const travel = useCallback((direction: "undo" | "redo") => {
    const history = direction === "undo" ? undoHistory(studio.history) : redoHistory(studio.history);
    if (history === studio.history) return;
    const restored = history.present.editor;
    setSeed(restored.seed); setHarmony(restored.harmony); setVariation(restored.variation);
    dispatchStudio({ type: direction });
    setError(null);
    setMessage(direction === "undo" ? "Undone." : "Redone.");
  }, [studio.history]);
  const keyHandlers = useRef({ reroll, travel, tab });
  keyHandlers.current = { reroll, travel, tab };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = paletteShortcut(e);
      if (!action) return;
      // Space belongs to the Mood view; undo/redo work across the studio.
      if ((action === "generate" || action === "suppress") && keyHandlers.current.tab !== "mood") return;
      e.preventDefault();
      if (action === "generate") keyHandlers.current.reroll();
      else if (action !== "suppress") keyHandlers.current.travel(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const useAsSeed = (hex: string) => {
    dispatch({ type: "generate", seed: hex, harmony: editor.harmony, variation: editor.variation });
    setSeed(hex); setHarmony(editor.harmony); setVariation(editor.variation);
    setError(null);
    setMessage(`${hex} is now the seed. Both theme variants were regenerated; locked values were preserved.`);
  };
  return (
    <div className="palette-editor">
      <div className="studio-toolbar">
        <label className="studio-field">
          Seed colour
          <div className="studio-inline">
            <input
              aria-label="Pick seed colour"
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(seed) ? seed : editor.seed}
              onChange={(e) => setSeed(e.target.value)}
            />
            <input
              aria-label="Seed hex"
              className="input-base"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") generate();
              }}
              spellCheck={false}
            />
          </div>
        </label>
        <label className="studio-field">
          Harmony
          <select
            className="input-base"
            value={harmony}
            onChange={(e) => setHarmony(e.target.value as Harmony)}
          >
            {Object.entries(HARMONY_MODES).map(([id, m]) => (
              <option key={id} value={id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="studio-field">Variation seed<input aria-label="Palette variation seed" className="input-base" maxLength={128} value={variation} onChange={e=>setVariation(e.target.value)}/></label>
        <button className="btn-primary" onClick={generate}>
          Generate
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setSeed(
              rgbToHex({
                r: Math.random(),
                g: Math.random(),
                b: Math.random(),
              }),
            );
            setMessage("New seed selected. Generate to apply it.");
          }}
        >
          Random seed
        </button>
      </div>
      <p className="studio-help">
        {HARMONY_MODES[harmony].description}.{" "}
        {dirty
          ? "Settings changed; preview and exports still use the last generated palette."
          : `Generated from ${editor.seed}.`}
      </p>
      {symbolism && (
        <details>
          <summary>Colour associations · {symbolism.label}</summary>
          <p className="studio-help">
            {symbolism.keywords.join(", ")}. Editorial associations vary by
            context and culture.
          </p>
        </details>
      )}
      <Status error={error}>{message}</Status>
      <div className="studio-toolbar">
        <div className="studio-inline" role="group" aria-label="History">
          <button className="btn-icon" onClick={() => travel("undo")} disabled={!studio.history.past.length} aria-label="Undo" title={`Undo (${isMac ? "⌘Z" : "Ctrl+Z"})`}><Undo2 size={16} aria-hidden="true" /></button>
          <button className="btn-icon" onClick={() => travel("redo")} disabled={!studio.history.future.length} aria-label="Redo" title={`Redo (${isMac ? "⇧⌘Z" : "Ctrl+Shift+Z"})`}><Redo2 size={16} aria-hidden="true" /></button>
        </div>
        <div className="segmented" role="group" aria-label="Palette theme">
          {(["light", "dark"] as const).map((t) => (
            <button
              className="segmented-item"
              aria-pressed={theme === t}
              key={t}
              onClick={() => setTheme(t)}
            >
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <button
          className="btn-secondary"
          aria-pressed={compare}
          onClick={() => setCompare((v) => !v)}
        >
          Compare themes
        </button>
        <button
          className="btn-secondary"
          onClick={() => copy(paletteCSS(editor))}
        >
          Copy CSS
        </button>
        <button
          className="btn-secondary"
          onClick={() =>
            saveBlob(
              new Blob([paletteCSS(editor)], { type: "text/css" }),
              "dna-palette.css",
            )
          }
        >
          Download CSS
        </button>
        <button className="btn-secondary" onClick={async()=>{try{normalizeHex(seed);if(dirty)throw new Error("Generate the changed settings before sharing");const url=new URL(window.location.href);url.searchParams.set("tab","palette");url.searchParams.set("palette",serializeEditor(editor));url.searchParams.set("mood",serializeMood(mood));await copy(url.toString());}catch(error){setError(error instanceof Error?error.message:"Sharing failed");}}}>Copy palette link</button>
      </div>
      <div className="segmented studio-choice" role="group" aria-label="Palette views">
        {["palette", "accessibility", "colorblind", "mood", "export"].map((t) => (
          <button
            key={t}
            className="segmented-item"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {
              {
                palette: "Palette",
                accessibility: "Accessibility",
                colorblind: "Colour vision",
                mood: "Mood",
                export: "Export",
              }[t]
            }
          </button>
        ))}
      </div>
      {tab === "palette" && (
        <>
          <div className="studio-notice">
            <strong>
              {failed} of {Object.keys(fitness.pairs).length} evaluated pairs in
              the {theme} variant fail normal-text AA.
            </strong>{" "}
            Check individual pairs for their intended usage. Locks and edits can
            prevent contrast or harmony targets.
          </div>
          <details>
            <summary>Exploration heuristic: {fitness.score}/100</summary>
            <p>
              Weighted contrast bins and role diversity ({fitness.dScore}%).
              This is an editorial heuristic, not an accessibility pass or a
              validated quality measurement. Colour distance uses native
              Euclidean OKLab.
            </p>
          </details>
          {(["base", "brand", "semantic"] as const).map((group) => (
            <section key={group}>
              <h2 className="studio-section-title">{GROUP_LABELS[group]}</h2>
              <div className="studio-swatches">
                {ROLES.filter((r) => r.group === group).map((role) => (
                  <div className="studio-swatch" key={role.key}>
                    <button
                      className="studio-swatch-colour"
                      style={{ background: palette[role.key] }}
                      onClick={() => copy(palette[role.key])}
                      aria-label={`Copy ${role.label} ${palette[role.key]}`}
                    />
                    <div className="studio-swatch-controls">
                      <label>
                        {role.label}
                        <input
                          aria-label={`Edit ${role.label}`}
                          type="color"
                          value={palette[role.key]}
                          onChange={(e) =>
                            dispatch({
                              type: "edit",
                              theme,
                              role: role.key,
                              value: e.target.value,
                            }, `edit-${theme}-${role.key}`)
                          }
                        />
                      </label>
                      <button
                        className="btn-icon"
                        aria-label={`${editor.locks[role.key] ? "Unlock" : "Lock"} ${role.label}`}
                        aria-pressed={!!editor.locks[role.key]}
                        onClick={() =>
                          dispatch({ type: "lock", theme, role: role.key })
                        }
                      >
                        {editor.locks[role.key] ? (
                          <Lock size={16} />
                        ) : (
                          <LockOpen size={16} />
                        )}
                      </button>
                    </div>
                    <input
                      className="studio-hex"
                      readOnly
                      aria-label={`${role.label} hex value`}
                      value={palette[role.key]}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {Object.keys(editor.locks).length > 0 && (
            <button
              className="btn-secondary"
              onClick={() => dispatch({ type: "unlockAll" })}
            >
              Clear all {Object.keys(editor.locks).length} locks
            </button>
          )}
          {compare ? (
            <div className="studio-theme-compare">
              {(["light", "dark"] as const).map((t) => (
                <section key={t}>
                  <h2 className="studio-section-title">UI preview · {t}</h2>
                  <Preview palette={editor.variants[t]} />
                </section>
              ))}
            </div>
          ) : (
            <>
              <h2 className="studio-section-title">UI preview · {theme}</h2>
              <Preview palette={palette} />
            </>
          )}
        </>
      )}
      {tab === "accessibility" && (
        <>
          <p className="studio-help">
            Normal AA ≥4.5:1; large AA ≥3:1 (24px regular or about 19px bold).
            Results use unrounded WCAG ratios. Inspect the criteria for each intended foreground/background usage.
          </p>
          <AccessibilityTab palette={palette} fitness={fitness} />
          <RoleChecks palette={palette} theme={theme} />
        </>
      )}
      {tab === "colorblind" && (
        <>
          <p className="studio-help">
            Approximate Brettel 1997 simulation at full dichromacy,
            Smith/Pokorny model. These previews do not certify accessibility for
            colour vision deficiencies. Use labels and shape as well as colour.
          </p>
          <ColorBlindTab palette={palette} cbData={cbData} />
        </>
      )}
      {tab === "mood" && (
        <>
          <p className="studio-help">
            Independent mood exploration from committed seed {editor.seed}. Mood
            changes do not change semantic roles, their analysis, or role CSS.
            <kbd className="studio-kbd">Space</kbd> generates a new variation;
            locked swatches stay exact; <kbd className="studio-kbd">{isMac ? "⌘" : "Ctrl"}</kbd>+<kbd className="studio-kbd">Z</kbd> undoes
            (history keeps {HISTORY_LIMIT} states this session).
          </p>
          <MoodTab
            palette={visualPalette}
            mood={mood}
            seed={editor.seed}
            onChangeMode={(mode) => apply({ type: "mood", patch: { mode } })}
            onReroll={reroll}
            onToggleLock={(index, hex) => {
              const locks = { ...mood.locks };
              if (locks[index]) delete locks[index]; else locks[index] = hex;
              apply({ type: "mood", patch: { locks } });
            }}
            onEdit={(index, hex) => apply({ type: "mood", patch: { locks: { ...mood.locks, [index]: normalizeHex(hex) } } }, `mood-${index}`)}
            onUnlockAll={() => apply({ type: "mood", patch: { locks: {} } })}
            onUseAsSeed={useAsSeed}
            onCopy={(hex) => copy(hex, `Copied ${hex}.`)}
          />
          <button
            className="btn-secondary"
            onClick={() =>
              saveBlob(
                new Blob([JSON.stringify(visualPalette, null, 2)], {
                  type: "application/json",
                }),
                "dna-mood.json",
              )
            }
          >
            Download mood JSON
          </button>
        </>
      )}
      {tab === "export" && (
        <ExportPanel editor={editor} swatches={visualPalette} moodLabel={VISUAL_MODES.find((m) => m.id === mood.mode)?.label || mood.mode} onCopy={copy} />
      )}
    </div>
  );
}

function Preview({ palette: p }: { palette: Palette }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {/* Dashboard card */}
      <div
        style={{
          background: p.bg,
          border: `1px solid ${p.border}`,
          borderRadius: "var(--radius-lg)",
          padding: 22,
          width: "100%",
          maxWidth: 500,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 16,
          }}
        >
          <div>
            <div
              style={{
                color: p.textMuted,
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: ".12em",
                marginBottom: 2,
              }}
            >
              Overview
            </div>
            <div
              style={{
                color: p.text,
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "-.02em",
              }}
            >
              Dashboard
            </div>
          </div>
          <div
            style={{
              background: p.primary,
              color: p.primaryFg,
              padding: "6px 12px",
              borderRadius: 7,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            + New
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 7,
            marginBottom: 13,
          }}
        >
          {[
            { label: "Active", val: "12", col: p.primary },
            { label: "Done", val: "48", col: p.success },
            { label: "Pending", val: "6", col: p.warning },
            { label: "Issues", val: "2", col: p.error },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: p.surface,
                border: `1px solid ${p.border}`,
                borderRadius: "var(--radius-sm)",
                padding: "9px 11px",
              }}
            >
              <div
                style={{
                  color: p.textMuted,
                  fontSize: 8,
                  textTransform: "uppercase",
                  letterSpacing: ".1em",
                  marginBottom: 2,
                }}
              >
                {stat.label}
              </div>
              <div style={{ color: stat.col, fontSize: 18, fontWeight: 800 }}>
                {stat.val}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            background: p.surfaceElevated,
            border: `1px solid ${p.border}`,
            borderRadius: "var(--radius-sm)",
            padding: "10px 12px",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              color: p.text,
              fontSize: 11,
              fontWeight: 600,
              marginBottom: 7,
            }}
          >
            Recent Activity
          </div>
          {[
            { msg: "Deploy to production succeeded", type: "success" },
            { msg: "PR #42 awaiting review", type: "warning" },
            { msg: "2 tests failing on main", type: "error" },
          ].map((a, i) => {
            const dotColor =
              a.type === "success"
                ? p.success
                : a.type === "warning"
                  ? p.warning
                  : p.error;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "3px 0",
                  borderTop: i > 0 ? `1px solid ${p.border}` : "none",
                }}
              >
                <div
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: p.text, fontSize: 10 }}>{a.msg}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          {[
            { bg: p.primary, fg: p.primaryFg, label: "Primary" },
            { bg: p.secondary, fg: p.bg, label: "Secondary" },
            { bg: p.accent, fg: p.bg, label: "Accent" },
          ].map((b) => (
            <div
              key={b.label}
              style={{
                flex: 1,
                background: b.bg,
                color: b.fg,
                padding: 8,
                borderRadius: 7,
                fontSize: 10,
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              {b.label}
            </div>
          ))}
        </div>
      </div>

      {/* Typography + semantic cards */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            background: p.bg,
            border: `1px solid ${p.border}`,
            borderRadius: "var(--radius-lg)",
            padding: 22,
          }}
        >
          <div
            style={{
              color: p.textMuted,
              fontSize: 9,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Typography
          </div>
          <div
            style={{
              color: p.primary,
              fontSize: 22,
              fontWeight: 900,
              letterSpacing: "-.025em",
              lineHeight: 1.1,
              marginBottom: 4,
            }}
          >
            Display Heading
          </div>
          <div
            style={{
              color: p.text,
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Section Title
          </div>
          <div
            style={{
              color: p.text,
              fontSize: 11,
              lineHeight: 1.75,
              marginBottom: 6,
            }}
          >
            Sample body text. Check this foreground/background pair before use.
          </div>
          <div style={{ color: p.textMuted, fontSize: 10, lineHeight: 1.65 }}>
            Muted helper text for metadata and secondary content.
          </div>
          <div
            style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}
          >
            {[
              { bg: p.primary, fg: p.primaryFg, label: "Primary" },
              { bg: p.secondary, fg: p.bg, label: "Secondary" },
              { bg: p.accent, fg: p.bg, label: "Accent" },
            ].map((t) => (
              <div
                key={t.label}
                style={{
                  background: t.bg,
                  color: t.fg,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-xl)",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {t.label}
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            background: p.bg,
            border: `1px solid ${p.border}`,
            borderRadius: "var(--radius-lg)",
            padding: 22,
          }}
        >
          <div
            style={{
              color: p.textMuted,
              fontSize: 9,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Semantic States
          </div>
          {[
            {
              label: "Success",
              color: p.success,
              bg: p.successBg,
              msg: "Deploy completed",
            },
            {
              label: "Warning",
              color: p.warning,
              bg: p.warningBg,
              msg: "Session expires soon",
            },
            {
              label: "Error",
              color: p.error,
              bg: p.errorBg,
              msg: "Connection failed",
            },
            {
              label: "Info",
              color: p.info,
              bg: p.infoBg,
              msg: "New version available",
            },
          ].map((sem) => (
            <div
              key={sem.label}
              style={{
                background: sem.bg,
                border: `1px solid ${sem.color}40`,
                borderRadius: 7,
                padding: "8px 10px",
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: sem.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: sem.color,
                  fontSize: 9,
                  fontWeight: 700,
                  marginRight: 5,
                }}
              >
                {sem.label}
              </span>
              <span style={{ color: p.text, fontSize: 10 }}>{sem.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccessibilityTab({
  palette,
  fitness,
}: {
  palette: Palette;
  fitness: ReturnType<typeof scorePalette>;
}) {
  const keyMap: Record<string, Role> = {
    Text: "text",
    TextMuted: "textMuted",
    Primary: "primary",
    PrimaryFg: "primaryFg",
    Secondary: "secondary",
    Accent: "accent",
    Success: "success",
    Error: "error",
    Warning: "warning",
    BG: "bg",
    Surface: "surface",
    SuccessBg: "successBg",
    ErrorBg: "errorBg",
    WarningBg: "warningBg",
    Info: "info",
    InfoBg: "infoBg",
    SurfaceElevated: "surfaceElevated",
  };
  return (
    <div className="studio-pairs">
      {Object.entries(fitness.pairs).map(([name, data]) => {
        const parts = name.split(" / ");
        const fgHex = palette[keyMap[parts[0]]] || palette.text;
        const bgHex = palette[keyMap[parts[1]]] || palette.bg;
        const g = GRADE(data.cr);
        return (
          <div key={name} className="studio-pair">
            {/* Live text preview on actual palette background */}
            <div
              style={{
                background: bgHex,
                padding: "14px 16px",
                minHeight: 56,
                display: "flex",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: fgHex,
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "var(--font-body)",
                }}
              >
                The quick brown fox jumps
              </span>
            </div>
            {/* Metadata row */}
            <div className="studio-pair-meta">
              <span style={{ fontWeight: 500 }}>{name}</span>
              <span className="studio-inline" style={{ gap: 8 }}>
                <span className="studio-value">{data.cr.toFixed(2)}:1</span>
                <span className={`studio-badge studio-tone ${g.tone}`}>
                  {g.label}
                </span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColorBlindTab({
  palette,
  cbData,
}: {
  palette: Palette;
  cbData: ReturnType<typeof analyzeCB>;
}) {
  const names: Record<string, string> = {
    protanopia: "Protanopia (Red-blind)",
    deuteranopia: "Deuteranopia (Green-blind)",
    tritanopia: "Tritanopia (Blue-blind)",
  };
  return (
    <div className="studio-pairs">
      {Object.entries(cbData).map(([type, data]) => {
        const tCR = data.textBgCR,
          pCR = data.primaryBgCR;
        const tG = GRADE(tCR),
          pG = GRADE(pCR);
        return (
          <div key={type} className="studio-pair">
            {/* Card header */}
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--color-hairline)",
              }}
            >
              <div className="studio-help" style={{ fontSize: 12 }}>
                Simulation
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{names[type]}</div>
            </div>
            {/* Simulated color strip */}
            <div style={{ padding: "12px 14px" }}>
              <div
                style={{
                  display: "flex",
                  height: 36,
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                  marginBottom: 12,
                }}
              >
                {[
                  "bg",
                  "surface",
                  "primary",
                  "secondary",
                  "accent",
                  "text",
                ].map((k) => {
                  const sim = simulateCB(
                    hexToRgb(palette[k as Role]),
                    type as "protanopia" | "deuteranopia" | "tritanopia",
                  );
                  return (
                    <div
                      key={k}
                      style={{ flex: 1, background: rgbToHex(sim) }}
                    />
                  );
                })}
              </div>
              {/* Contrast rows */}
              {[
                { label: "Text on BG", cr: data.textBgCR, g: tG },
                { label: "Primary on BG", cr: data.primaryBgCR, g: pG },
              ].map((row) => (
                <div
                  key={row.label}
                  className="studio-pair-meta"
                  style={{ padding: "0 0 6px" }}
                >
                  <span className="studio-help" style={{ fontSize: 12 }}>
                    {row.label}
                  </span>
                  <span className="studio-inline" style={{ gap: 8 }}>
                    <span className="studio-value">{row.cr.toFixed(2)}:1</span>
                    <span className={`studio-badge studio-tone ${row.g.tone}`}>
                      {row.g.label}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const VISUAL_MODES: { id: Mood; label: string }[] = [
  { id: "visual", label: "Visual" },
  { id: "poster", label: "Poster" },
  { id: "luxury", label: "Luxury" },
  { id: "minimal", label: "Minimal" },
  { id: "cyberpunk", label: "Cyberpunk" },
];

const VISUAL_MODE_DESCRIPTIONS: Record<Mood, string> = {
  visual: "Your exact seed with a tonal range built around it",
  poster: "Saturated mid-tones carried by ink and paper",
  luxury: "Deep tinted darks, one jewel tone and warm ivory",
  minimal: "Tinted neutrals with one deliberate colour accent",
  cyberpunk: "Near-black panels lit by three neon highlights",
};

type Swatch = ReturnType<typeof deriveVisualPalette>[number];

function MoodTab({
  palette,
  mood,
  seed,
  onChangeMode,
  onReroll,
  onToggleLock,
  onEdit,
  onUnlockAll,
  onUseAsSeed,
  onCopy,
}: {
  palette: Swatch[];
  mood: MoodState;
  seed: string;
  onChangeMode: (mode: Mood) => void;
  onReroll: () => void;
  onToggleLock: (index: number, hex: string) => void;
  onEdit: (index: number, hex: string) => void;
  onUnlockAll: () => void;
  onUseAsSeed: (hex: string) => void;
  onCopy: (hex: string) => void;
}) {
  const lockCount = Object.keys(mood.locks).length;
  return (
    <div className="studio-mood">
      {/* Mode selector row */}
      <div className="studio-inline">
        <div
          className="segmented studio-choice"
          role="group"
          aria-label="Visual palette mood"
        >
          {VISUAL_MODES.map((m) => (
            <button
              key={m.id}
              className="segmented-item"
              onClick={() => onChangeMode(m.id)}
              aria-pressed={mood.mode === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="studio-help">
          {VISUAL_MODE_DESCRIPTIONS[mood.mode]}
        </span>
        <button
          onClick={onReroll}
          className="btn-secondary studio-push"
          aria-label="Generate a new mood variation"
        >
          <RefreshCw size={14} aria-hidden="true" />
          New variation
        </button>
      </div>

      {/* Swatch columns: role, name, value, OKLCH and per-swatch actions */}
      <div className="studio-mood-columns">
        {palette.map((swatch) => {
          const locked = !!mood.locks[swatch.index];
          const name = colourName(swatch.hex);
          const { L, C, H } = rgbToOKLCH(hexToRgb(swatch.hex));
          const ink = contrastRatio(hexToRgb("#000000"), hexToRgb(swatch.hex)) >= contrastRatio(hexToRgb("#FFFFFF"), hexToRgb(swatch.hex)) ? "#000000" : "#FFFFFF";
          return (
            <div key={swatch.index} className="studio-mood-column" role="group" aria-label={`${swatch.name}: ${name}, ${swatch.hex}${locked ? ", locked" : ""}`} style={{ background: swatch.hex, color: ink }}>
              <div className="studio-mood-actions">
                <button className="btn-icon" aria-pressed={locked} onClick={() => onToggleLock(swatch.index, swatch.hex)} aria-label={`${locked ? "Unlock" : "Lock"} ${swatch.name}`} title={locked ? "Unlock" : "Lock"}>
                  {locked ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
                </button>
                <label className="btn-icon studio-mood-edit" title="Edit colour">
                  <span className="studio-mood-edit-chip" style={{ background: swatch.hex }} aria-hidden="true" />
                  <input type="color" value={swatch.hex.toLowerCase()} onChange={(e) => onEdit(swatch.index, e.target.value)} aria-label={`Edit ${swatch.name}`} />
                </label>
                <button className="btn-icon" onClick={() => onUseAsSeed(swatch.hex)} disabled={swatch.hex === seed} aria-label={`Use ${swatch.name} as seed`} title="Use as seed">
                  <Crosshair size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="studio-mood-info">
                <span className="studio-mood-role">{swatch.name}{locked && <span className="sr-only"> (locked)</span>}</span>
                <button className="studio-mood-hex" onClick={() => onCopy(swatch.hex)} aria-label={`Copy ${swatch.name} ${swatch.hex}`}>
                  {swatch.hex}<Copy size={14} aria-hidden="true" />
                </button>
                <span className="studio-mood-name">{name}</span>
                <span className="studio-mood-oklch" title={`oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`}>
                  <span>L {(L * 100).toFixed(1)}</span><span>C {C.toFixed(3)}</span><span>H {C < 1e-4 ? "—" : H.toFixed(0)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {lockCount > 0 && (
        <p className="studio-help">
          {lockCount} swatch{lockCount > 1 ? "es" : ""} locked.{" "}
          <button className="btn-secondary" onClick={onUnlockAll}>Unlock all</button>
        </p>
      )}

      <h2 className="studio-section-title">Tonal scales</h2>
      <p className="studio-help">100–900 at constant OKLCH hue. The marked step is the swatch itself; select a step to copy it.</p>
      <div className="studio-scales">
        {palette.map((swatch) => (
          <div key={swatch.index} className="studio-scale-row" role="group" aria-label={`${swatch.name} tonal scale`}>
            <div className="studio-scale-label"><strong>{swatch.name}</strong><span>{colourName(swatch.hex)}</span></div>
            <div className="studio-scale-steps">
              {tonalScale(swatch.hex).map((step) => (
                <button key={step.step} className="studio-scale-step" style={{ background: step.hex, color: contrastRatio(hexToRgb("#000000"), hexToRgb(step.hex)) >= contrastRatio(hexToRgb("#FFFFFF"), hexToRgb(step.hex)) ? "#000000" : "#FFFFFF" }} onClick={() => onCopy(step.hex)} aria-label={`Copy ${swatch.name} ${step.step} ${step.hex}${step.source ? " (source colour)" : ""}`}>
                  <span>{step.step}{step.source && <span aria-hidden="true"> ●</span>}</span>
                  <span className="studio-mono">{step.hex}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <details>
        <summary>Contrast between mood swatches</summary>
        <p className="studio-help">Harmonious colours are not automatically readable together. Normal AA needs 4.5:1, large AA 3:1 and normal AAA 7:1.</p>
        <MoodContrast swatches={palette} />
      </details>
    </div>
  );
}

/** Pairwise WCAG contrast of the five mood swatches, lighter colour as background. */
function MoodContrast({ swatches }: { swatches: Swatch[] }) {
  const pairs: { fg: Swatch; bg: Swatch; ratio: number }[] = [];
  for (let i = 0; i < swatches.length; i++) for (let j = i + 1; j < swatches.length; j++) {
    const [a, b] = [swatches[i], swatches[j]];
    const aLighter = rgbToOKLCH(hexToRgb(a.hex)).L >= rgbToOKLCH(hexToRgb(b.hex)).L;
    pairs.push({ fg: aLighter ? b : a, bg: aLighter ? a : b, ratio: contrastRatio(hexToRgb(a.hex), hexToRgb(b.hex)) });
  }
  pairs.sort((x, y) => y.ratio - x.ratio);
  return (
    <div className="studio-pairs">
      {pairs.map(({ fg, bg, ratio }) => {
        const g = GRADE(ratio), grade = contrastGrade(ratio);
        return (
          <div key={`${fg.index}-${bg.index}`} className="studio-pair">
            {/* Only the sample uses the pair's own colours; the label stays readable on the card. */}
            <div className="studio-mood-pair-sample" style={{ background: bg.hex, color: fg.hex }} aria-hidden="true">Aa</div>
            <div className="studio-pair-meta">
              <span><strong>{fg.name} on {bg.name}</strong> · {grade.normalAAA ? "any text" : grade.normalAA ? "body text" : grade.largeAA ? "large text / UI parts only" : "decorative only"}</span>
              <span className="studio-inline" style={{ gap: 8 }}>
                <span className="studio-value">{ratio.toFixed(2)}:1</span>
                <span className={`studio-badge studio-tone ${g.tone}`}>{g.label}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));
/** Checks that pair-wise text contrast does not cover: non-text borders and semantic-role confusion. */
function RoleChecks({ palette, theme }: { palette: Palette; theme: Theme }) {
  const borders = nonTextChecks(palette);
  const collisions = semanticCollisions(palette);
  return (
    <>
      <h2 className="studio-section-title">Non-text contrast · {theme}</h2>
      <p className="studio-help">
        WCAG 1.4.11 asks for 3:1 when a border is what identifies a control, such as an input outline. Decorative separators between surfaces are exempt.
      </p>
      <div className="studio-pairs">
        {borders.map((check) => (
          <div key={check.name} className="studio-pair">
            <div className="studio-mood-pair-sample" style={{ background: palette[check.bg as Role] }}>
              <span className="studio-border-sample" style={{ borderColor: palette[check.fg as Role] }} aria-hidden="true" />
              <span style={{ color: palette.text }}>{check.name}</span>
            </div>
            <div className="studio-pair-meta">
              <span>{check.pass ? "Usable for control outlines" : "Decorative separators only"}</span>
              <span className="studio-inline" style={{ gap: 8 }}>
                <span className="studio-value">{check.ratio.toFixed(2)}:1</span>
                <span className={`studio-badge studio-tone ${check.pass ? "is-pass" : "is-warn"}`}>{check.pass ? "3:1 pass" : "Below 3:1"}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
      <h2 className="studio-section-title">Semantic colour distinctness · {theme}</h2>
      <p className="studio-help">
        Brand colours that resemble a status colour, and status colours that converge under simulated colour-vision deficiency (Brettel 1997), measured as OKLab distance below {COLLISION_DISTANCE}. This is a heuristic: pair status colours with icons or text either way.
      </p>
      {collisions.length === 0 ? (
        <div className="studio-notice"><strong>No close pairs found.</strong> Brand and status colours stay apart, including under the three simulations.</div>
      ) : (
        <ul className="studio-checklist">
          {collisions.map((c) => (
            <li key={`${c.a}-${c.b}-${c.condition}`}>
              <span className="studio-checklist-swatches" aria-hidden="true">
                <span style={{ background: palette[c.a as Role] }} />
                <span style={{ background: palette[c.b as Role] }} />
              </span>
              <span><strong>{ROLE_LABEL[c.a]}</strong> and <strong>{ROLE_LABEL[c.b]}</strong> are close {c.condition === "typical vision" ? "for typical colour vision" : `under ${c.condition}`}</span>
              <span className="studio-value">ΔOK {c.distance.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ExportPanel({ editor, swatches, moodLabel, onCopy }: { editor: ReturnType<typeof createEditor>; swatches: Swatch[]; moodLabel: string; onCopy: (value: string, note?: string) => Promise<void> }) {
  const [format, setFormat] = useState<"css" | ExportFormat>("tokens");
  const [withMood, setWithMood] = useState(true);
  const [withScales, setWithScales] = useState(true);
  const [withRoles, setWithRoles] = useState(true);
  const title = `Seed ${editor.seed} · ${HARMONY_MODES[editor.harmony].label} · ${moodLabel}`;
  const input = {
    swatches: withMood ? swatches.map((s) => ({ role: s.name, hex: s.hex })) : [],
    themes: withRoles ? editor.variants : undefined,
    includeScales: withScales,
    title,
  };
  const meta = format === "css" ? { label: "CSS", filename: "dna-palette.css", mime: "text/css" } : EXPORT_FORMATS.find((f) => f.id === format)!;
  let output = "", problem = "";
  try {
    output = format === "css" ? paletteCSS(editor) + (withMood ? moodCss(input) : "") : exportPalette(format, input);
  } catch (e) { problem = e instanceof Error ? e.message : "Export failed"; }
  const svg = format === "svg";
  return (
    <section className="studio-export" aria-label="Export">
      <p className="studio-help">Every format is generated from the committed palette shown in Palette and Mood. Role CSS keeps the existing <code>--color-*</code> names for both themes.</p>
      <div className="segmented studio-choice" role="group" aria-label="Export format">
        {([{ id: "css", label: "CSS" }, ...EXPORT_FORMATS] as { id: "css" | ExportFormat; label: string }[]).map((f) => (
          <button key={f.id} className="segmented-item" aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="studio-export-options">
        <label className="studio-inline"><input type="checkbox" checked={withMood} disabled={svg} onChange={(e) => setWithMood(e.target.checked)} />Include the mood palette</label>
        <label className="studio-inline"><input type="checkbox" checked={withScales} disabled={svg || !withMood} onChange={(e) => setWithScales(e.target.checked)} />Include 100–900 tonal scales</label>
        <label className="studio-inline"><input type="checkbox" checked={format === "css" || withRoles} disabled={svg || format === "css"} onChange={(e) => setWithRoles(e.target.checked)} />Include UI roles (light and dark)</label>
      </div>
      {problem ? (
        <p className="studio-status is-error" role="alert">{problem}</p>
      ) : svg ? (
        <img className="studio-export-preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(output)}`} alt="SVG palette card preview" />
      ) : (
        <pre className="studio-export-code" tabIndex={0} aria-label={`${meta.label} output`}><code>{output}</code></pre>
      )}
      <div className="studio-inline">
        <button className="btn-secondary" disabled={!!problem} onClick={() => onCopy(output, `${meta.label} copied.`)}><Copy size={14} aria-hidden="true" />Copy {meta.label}</button>
        <button className="btn-primary" disabled={!!problem} onClick={() => saveBlob(new Blob([output], { type: meta.mime }), meta.filename)}><Download size={14} aria-hidden="true" />Download {meta.filename}</button>
      </div>
    </section>
  );
}

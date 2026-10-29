import { studioDrafts } from "./studio/drafts";
/**
 * PaletteStudio
 * Self-contained palette generator.
 * No external dependencies required (uses only React hooks).
 *
 * Tabler Icons (outline) loaded dynamically by PalettePage on mount.
 */

import {
  useState,
  useMemo,
  useReducer,
  useEffect,
  type CSSProperties,
} from "react";
import { Lock, LockOpen, RefreshCw } from "lucide-react";
import {
  createEditor,
  paletteReducer,
  paletteCSS,
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
  wcagLuminance,
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
  if (n >= 7.0) return { label: "AAA", color: "var(--color-success)" };
  if (n >= 4.5) return { label: "AA", color: "#84cc16" };
  if (n >= 3.0) return { label: "Large AA only", color: "#eab308" };
  return { label: "Fail", color: "var(--color-error)" };
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
  const [editor, dispatch] = useReducer(
    paletteReducer,
    undefined,
    () =>
      (studioDrafts.get("palette.editor") as ReturnType<typeof createEditor>) ||
      createEditor(),
  );
  useEffect(() => {
    studioDrafts.set("palette.editor", editor);
  }, [editor]);
  const [seed, setSeed] = useState(editor.seed),
    [harmony, setHarmony] = useState<Harmony>(editor.harmony);
  const [theme, setTheme] = useState<Theme>("light"),
    [tab, setTab] = useState("palette");
  const [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const [compare, setCompare] = useState(false),
    [visualMode, setVisualMode] = useState<Mood>("visual");
  const [visualPalette, setVisualPalette] = useState(() =>
    deriveVisualPalette(editor.seed, editor.harmony),
  );
  const palette = editor.variants[theme];
  const fitness = useMemo(() => scorePalette(palette), [palette]),
    cbData = useMemo(() => analyzeCB(palette), [palette]);
  const symbolism = getSeedSymbolism(editor.seed);
  const dirty =
    seed.toUpperCase() !== editor.seed || harmony !== editor.harmony;
  const failed = Object.values(fitness.pairs).filter((p) => p.cr < 4.5).length;
  const generate = () => {
    try {
      const valid = normalizeHex(seed);
      dispatch({ type: "generate", seed: valid, harmony });
      setSeed(valid);
      setVisualPalette(deriveVisualPalette(valid, harmony, visualMode));
      setError(null);
      setMessage(
        "Generated both theme variants. Locked values were preserved.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async (value: string) => {
    try {
      await copyText(value);
      setMessage("Copied to clipboard.");
      setError(null);
    } catch {
      setError("Copy failed. Select the displayed value or download the CSS.");
    }
  };
  const reroll = () =>
    setVisualPalette(
      deriveVisualPalette(editor.seed, editor.harmony, visualMode),
    );
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
      </div>
      <div className="segmented" role="group" aria-label="Palette views">
        {["palette", "accessibility", "colorblind", "mood"].map((t) => (
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
                            })
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
          <h2 className="studio-section-title">UI preview · {theme}</h2>
          <Preview palette={palette} />
          {compare && (
            <>
              <h2 className="studio-section-title">
                UI preview · {theme === "light" ? "dark" : "light"}
              </h2>
              <Preview
                palette={editor.variants[theme === "light" ? "dark" : "light"]}
              />
            </>
          )}
        </>
      )}
      {tab === "accessibility" && (
        <>
          <p className="studio-help">
            Normal AA ≥4.5:1; large AA ≥3:1 (24px regular or about 19px bold).
            Results use unrounded ratios. APCA 0.0.98G is signed, informational,
            and requires font-size/weight interpretation; it is separate from
            WCAG 2 conformance.
          </p>
          <AccessibilityTab palette={palette} fitness={fitness} />
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
            changes do not change semantic roles, their analysis, or CSS
            exports.
          </p>
          <MoodTab
            palette={visualPalette}
            visualMode={visualMode}
            onChangeMode={(mode) => {
              setVisualMode(mode);
              setVisualPalette(
                deriveVisualPalette(editor.seed, editor.harmony, mode),
              );
            }}
            onReroll={reroll}
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
        gap: 10,
      }}
    >
      {Object.entries(fitness.pairs).map(([name, data]) => {
        const parts = name.split(" / ");
        const fgHex = palette[keyMap[parts[0]]] || palette.text;
        const bgHex = palette[keyMap[parts[1]]] || palette.bg;
        const g = GRADE(data.cr);
        const ap = Math.abs(data.apca);
        const apColor =
          ap >= 75
            ? "var(--color-success)"
            : ap >= 60
              ? "#eab308"
              : "var(--color-error)";
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
            <div
              style={{
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--color-ink)",
                    marginBottom: 3,
                  }}
                >
                  {name}
                </div>
                <div style={{ fontSize: 10, color: "var(--color-ink-muted)" }}>
                  APCA{" "}
                  <span style={{ color: apColor, fontWeight: 700 }}>
                    {data.apca.toFixed(1)} Lc
                  </span>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: g.color,
                    background: "var(--color-surface-2)",
                    padding: "2px 8px",
                    borderRadius: "var(--radius-xs)",
                  }}
                >
                  {g.label}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-ink-muted)",
                  }}
                >
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
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
        gap: 12,
      }}
    >
      {Object.entries(cbData).map(([type, data]) => {
        const tCR = data.textBgCR,
          pCR = data.primaryBgCR;
        const tG = GRADE(tCR),
          pG = GRADE(pCR);
        return (
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
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--color-hairline)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--color-ink-muted)",
                  marginBottom: 3,
                }}
              >
                Simulation
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--color-ink)",
                }}
              >
                {names[type]}
              </div>
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
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingBottom: 6,
                  }}
                >
                  <span
                    style={{ fontSize: 11, color: "var(--color-ink-muted)" }}
                  >
                    {row.label}
                  </span>
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-ink-muted)",
                      }}
                    >
                      {row.cr.toFixed(2)}:1
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: row.g.color,
                        background: "var(--color-surface-2)",
                        padding: "2px 7px",
                        borderRadius: "var(--radius-xs)",
                      }}
                    >
                      {row.g.label}
                    </span>
                  </div>
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

const VISUAL_MODE_DESCRIPTIONS = {
  visual: "Tonal range built around the seed",
  poster: "High-chroma mid-tones with neutrals",
  luxury: "Restrained depth with tinted neutrals",
  minimal: "Near-achromatic — one colour accent",
  cyberpunk: "Near-black darks with neon highlights",
};

function MoodTab({
  palette,
  visualMode,
  onChangeMode,
  onReroll,
}: {
  palette: ReturnType<typeof deriveVisualPalette>;
  visualMode: Mood;
  onChangeMode: (mode: Mood) => void;
  onReroll: () => void;
}) {
  const s = styles;
  const [copied, setCopied] = useState("");
  return (
    <div>
      {/* Mode selector row */}
      <div style={s.moodBar}>
        <div
          style={s.harmonySegment}
          role="group"
          aria-label="Visual palette mood"
        >
          {VISUAL_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => onChangeMode(m.id)}
              aria-pressed={visualMode === m.id}
              style={{
                ...s.harmonyBtn,
                ...(visualMode === m.id ? s.harmonyBtnActive : {}),
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span style={s.harmonyDesc}>
          {VISUAL_MODE_DESCRIPTIONS[visualMode]}
        </span>
        <button
          onClick={onReroll}
          style={s.rerollBtn}
          aria-label="Generate visual palette"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Generate
        </button>
      </div>

      {/* Swatch strip */}
      {palette ? (
        <div style={s.moodGrid}>
          {palette.map((swatch) => {
            const lum = wcagLuminance(hexToRgb(swatch.hex));
            const onColor =
              lum > 0.28 ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.85)";
            return (
              <button
                key={swatch.index}
                onClick={() => {
                  copyText(swatch.hex)
                    .then(() => setCopied(swatch.hex))
                    .catch(() => setCopied("Copy failed; select value"));
                  setTimeout(() => setCopied(""), 1500);
                }}
                aria-label={`Copy ${swatch.name} ${swatch.hex}`}
                style={{ ...s.moodSwatch, background: swatch.hex }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-3px)";
                  e.currentTarget.style.boxShadow = "var(--shadow-level-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div style={{ ...s.moodSwatchInner, color: onColor }}>
                  <span style={s.moodSwatchName}>{swatch.name}</span>
                  <span style={s.moodSwatchHex}>
                    {copied === swatch.hex ? "✓ Copied" : swatch.hex}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={s.empty}>
          <p style={s.emptySub}>Hit Generate to build a mood palette.</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  harmonySegment: {
    display: "flex",
    overflowX: "auto",
    scrollbarWidth: "none",
    flexWrap: "nowrap",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-pill)",
    padding: 3,
    gap: 2,
  },
  harmonyBtn: {
    background: "none",
    border: "none",
    borderRadius: "var(--radius-pill)",
    padding: "5px 13px",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    color: "var(--color-ink-muted)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1,
    transition: "background .12s, color .12s",
  },
  harmonyBtnActive: {
    background: "var(--color-inverse-canvas)", // vivid active state, matching Grid/Font pills
    color: "var(--color-canvas)",
  },
  harmonyDesc: {
    fontSize: 11,
    color: "var(--color-ink-muted)",
    lineHeight: 1,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "96px 24px",
    textAlign: "center",
    gap: 10,
  },
  emptySub: {
    fontSize: 13,
    color: "var(--color-ink-muted)",
    lineHeight: 1.65,
    maxWidth: 380,
    margin: 0,
  },
  moodBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  rerollBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "var(--color-surface-1)",
    color: "var(--color-ink)",
    border: "none",
    borderRadius: "var(--radius-pill)",
    padding: "10px 18px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
    marginLeft: "auto",
  },
  moodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 8,
  },
  moodSwatch: {
    border: "1px solid var(--color-hairline)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    padding: 0,
    position: "relative",
    minHeight: 200,
    display: "block",
    transition: "transform .12s, box-shadow .12s",
  },
  moodSwatchInner: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  moodSwatchName: {
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  moodSwatchHex: {
    fontSize: 9,
    fontFamily: "var(--font-mono)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    lineHeight: 1,
    opacity: 0.85,
  },
};

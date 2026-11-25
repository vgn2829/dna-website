import { useStudioDraft } from "./drafts";
import { contrastRatio, hexToRgb } from "../../lib/palette/engine";
import { contrastGrade, suggestContrastColours } from "../../lib/palette/contrast";
import { ArrowDownUp } from "lucide-react";
export function cRatio(a: string, b: string) {
  return contrastRatio(hexToRgb(a), hexToRgb(b));
}
function isHex(h: string) {
  return /^#[0-9a-fA-F]{6}$/.test(h);
}

/**
 * Accessible foreground suggestions from the shared Palette Studio colour
 * engine (OKLCH lightness search and harmony angles), so both tools agree.
 */
export function generateSuggestions(
  fgHex: string,
  bgHex: string,
  targetRatio = 4.5,
) {
  return suggestContrastColours(fgHex, bgHex, targetRatio);
}

export function ContrastChecker() {
  const [fg, setFg] = useStudioDraft("contrast.fg", "#ffffff");
  const [bg, setBg] = useStudioDraft("contrast.bg", "#0a0a0b");
  const [fgI, setFgI] = useStudioDraft("contrast.fgI", "#ffffff");
  const [bgI, setBgI] = useStudioDraft("contrast.bgI", "#0a0a0b");

  const ratio = cRatio(isHex(fg) ? fg : "#fff", isHex(bg) ? bg : "#000");
  const rStr = ratio.toFixed(2);
  const tone = ratio >= 4.5 ? "is-pass" : "is-fail";
  const failing = ratio < 4.5;
  const suggestions = failing ? generateSuggestions(fg, bg, 4.5) : [];

  function syncFg(v: string) {
    setFgI(v);
    if (isHex(v)) setFg(v);
  }
  function syncBg(v: string) {
    setBgI(v);
    if (isHex(v)) setBg(v);
  }
  function swap() {
    setFg(isHex(bg) ? bg : fg);
    setBg(isHex(fg) ? fg : bg);
    setFgI(bgI);
    setBgI(fgI);
  }

  const levels = [
    { l: "AA Normal text", p: ratio >= 4.5, r: "4.5:1" },
    { l: "AA Large text", p: ratio >= 3, r: "3.0:1" },
    { l: "AA UI components", p: ratio >= 3, r: "3.0:1" },
    { l: "AAA Normal text", p: ratio >= 7, r: "7.0:1" },
    { l: "AAA Large text", p: ratio >= 4.5, r: "4.5:1" },
  ];

  const field = (
    which: "fg" | "bg",
    label: string,
    value: string,
    draft: string,
    pick: (v: string) => void,
    sync: (v: string) => void,
  ) => (
    <div className="studio-group">
      <label htmlFor={`contrast-${which}`} className="studio-label">
        {label}
      </label>
      <div className="studio-inline">
        <input
          aria-label={which === "fg" ? "Pick foreground" : "Pick background"}
          className="studio-color-input"
          type="color"
          value={isHex(value) ? value : which === "fg" ? "#fff" : "#000"}
          onChange={(e) => pick(e.target.value)}
        />
        <input
          id={`contrast-${which}`}
          className="input-base studio-mono"
          style={{ flex: 1, minWidth: 0 }}
          aria-invalid={!isHex(draft)}
          value={draft}
          onChange={(e) => sync(e.target.value)}
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  );

  return (
    <div className="studio-tool">
      {(!isHex(fgI) || !isHex(bgI)) && (
        <p role="alert" className="studio-status is-error">
          Enter complete six-digit hex values. Results below show the last valid
          pair.
        </p>
      )}
      <div
        className="studio-contrast-sample"
        style={{
          background: isHex(bg) ? bg : "var(--color-canvas)",
          color: isHex(fg) ? fg : "var(--color-ink)",
        }}
      >
        <div className="studio-badges">
          <span className={`studio-badge is-strong studio-tone ${tone}`}>
            {rStr}:1
          </span>
          {failing && (
            <span className="studio-badge studio-tone is-fail">
              Fails WCAG AA
            </span>
          )}
        </div>
        <div className="studio-contrast-aa" aria-hidden="true">
          Aa
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.5 }}>
          Contrast ratio: <strong>{rStr}:1</strong>
        </p>
      </div>

      <div className="studio-contrast-pair">
        {field("fg", "Foreground (text)", fg, fgI, (v) => {
          setFg(v);
          setFgI(v);
        }, syncFg)}
        <button
          className="btn-icon"
          aria-label="Swap foreground and background"
          disabled={!isHex(fgI) || !isHex(bgI)}
          onClick={swap}
          style={{ flexShrink: 0, height: 44, width: 44 }}
        >
          <ArrowDownUp size={18} aria-hidden="true" />
        </button>
        {field("bg", "Background", bg, bgI, (v) => {
          setBg(v);
          setBgI(v);
        }, syncBg)}
      </div>

      <div className="studio-card">
        <div className="studio-result-head" style={{ marginBottom: 10 }}>
          <span>Contrast ratio</span>
          <strong className={`studio-tone ${tone}`}>{rStr}:1</strong>
        </div>
        <div className={`studio-meter studio-tone ${tone}`}>
          <span
            style={{ width: `${Math.min(((ratio - 1) / 20) * 100, 100)}%` }}
          />
        </div>
        <div className="studio-scale" aria-hidden="true">
          <span>1:1</span>
          <span>3 · 4.5 · 7 · 21:1</span>
        </div>
      </div>

      <div className="studio-results">
        {levels.map((l) => (
          <div key={l.l} className={`studio-result ${l.p ? "is-pass" : "is-fail"}`}>
            <div className="studio-result-head">
              <span>{l.l}</span>
              <span aria-hidden="true">{l.p ? "✓" : "✗"}</span>
            </div>
            <strong className={`studio-tone ${l.p ? "is-pass" : "is-fail"}`}>
              {l.p ? "Pass" : "Fail"}
            </strong>
            <small>Requires {l.r}</small>
          </div>
        ))}
      </div>

      {failing && (
        <section className="studio-card">
          <h2 className="studio-label">Suggested foreground colors</h2>
          <p className="studio-help" style={{ marginBottom: 16 }}>
            Every suggestion reaches WCAG AA (4.5:1) on this background; those
            marked AAA also reach 7:1. Built with the Palette Studio OKLCH engine.
          </p>
          <div className="studio-options">
            {suggestions.map((s) => (
              <button
                key={s.hex}
                className="studio-option"
                onClick={() => {
                  setFg(s.hex);
                  setFgI(s.hex);
                }}
              >
                <span className="studio-option-head">
                  <span
                    className="studio-color-chip"
                    style={{ background: s.hex }}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="studio-mono" style={{ display: "block" }}>
                      {s.hex.toUpperCase()}
                    </span>
                    <small>{s.ratio.toFixed(2)}:1 · {contrastGrade(s.ratio).level}</small>
                  </span>
                </span>
                <strong>{s.label}</strong>
                <small>{s.theory}</small>
                <span
                  aria-hidden="true"
                  style={{
                    padding: "6px 10px",
                    borderRadius: "var(--radius-sm)",
                    background: bg,
                    color: s.hex,
                    fontWeight: 600,
                  }}
                >
                  Aa — preview
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

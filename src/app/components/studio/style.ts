export const T = {
  get canvas() {
    return "var(--color-canvas)";
  },
  get surface1() {
    return "var(--color-surface-1)";
  },
  get surface2() {
    return "var(--color-surface-2)";
  },
  get surface3() {
    return "var(--color-surface-2)";
  },
  get hairline() {
    return "var(--color-hairline)";
  },
  get hairlineSoft() {
    return "var(--color-hairline-soft)";
  },
  get ink() {
    return "var(--color-ink)";
  },
  get inkMuted() {
    return "var(--color-ink-muted)";
  },
  get inkDim() {
    return "var(--color-ink-muted)";
  },
  get accentBlue() {
    return "var(--color-accent-blue)";
  },
  get primary() {
    return "var(--color-inverse-canvas)";
  },
  get gradViolet() {
    return "var(--gradient-violet)";
  },
  get gradMagenta() {
    return "var(--gradient-magenta)";
  },
  get gradOrange() {
    return "var(--gradient-orange)";
  },
  get gradCoral() {
    return "var(--gradient-coral)";
  },
};

export const ss: any = {
  label: {
    display: "block",
    fontFamily: "var(--font-body)",
    fontSize: 11,
    color: "var(--color-ink-muted)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: 7,
  },
  input: {
    width: "100%",
    padding: "9px 13px",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-2)",
    border: "1px solid var(--color-hairline)",
    color: "var(--color-ink)",
    fontFamily: "var(--font-body)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  btnPri: {
    padding: "10px 18px",
    borderRadius: "var(--radius-pill)",
    border: "none",
    cursor: "pointer",
    background: "var(--color-inverse-canvas)",
    color: "var(--color-canvas)",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.13px",
  },
  btnSec: {
    padding: "10px 18px",
    borderRadius: "var(--radius-pill)",
    border: "none",
    cursor: "pointer",
    background: "var(--color-surface-2)",
    color: "var(--color-ink)",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.13px",
  },
};

import { Suspense, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import { usePageMeta } from "../components/hooks/use-page-meta";
import { TOOLS } from "../components/studio/tools";
import { T } from "../components/studio/style";
import "../../styles/studio.css";
// ── Shell ─────────────────────────────────────────────────────────────────────
export default function DesignStudio() {
  usePageMeta({
    title: "Design Studio | DnA Club, IIT Kanpur",
    description:
      "Free browser-based design tools — background remover, SVG vectorizer, halftone generator, and more, from DnA Club.",
    path: "/design-studio",
  });

  const heading = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const isValidTab = (id: string | null | undefined): id is string =>
    !!id && TOOLS.some((t) => t.id === id);

  // The URL query param is the source of truth for the active tab, so a refresh
  // or shared /design-studio?tab=grid link opens the right tool.
  const queryTab = searchParams.get("tab");
  const active = isValidTab(queryTab) ? queryTab : "palette";

  useEffect(() => {
    document.getElementById("root")?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [active]);

  const setActive = (id: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", id);
      return next;
    });

  // DeepLinks via navigate('/design-studio', { state: { tab } }) still work —
  // on first load, promote a valid location.state tab into the query param.
  const stateTab = (location.state as { tab?: string } | null)?.tab;
  useEffect(() => {
    if (isValidTab(stateTab) && stateTab !== queryTab) {
      setSearchParams({ tab: stateTab }, { replace: true });
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Tool = TOOLS.find((t) => t.id === active)!.comp;
  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.canvas,
        fontFamily: "var(--font-body)",
        color: T.ink,
        paddingTop: 0,
      }}
    >
      <nav
        aria-label="Design tools"
        className="studio-tool-nav"
        style={{
          display: "flex",
          gap: 4,
          alignItems: "center",
          overflowX: "auto",
          scrollbarWidth: "none",
          padding: "8px 24px",
          borderBottom: `1px solid ${T.hairline}`,
          background: "var(--color-canvas)",
          position: "sticky",
          top: 56,
          zIndex: 90,
        }}
      >
        {TOOLS.map((t) => (
          <button
            aria-current={active === t.id ? "page" : undefined}
            className="touch-target"
            key={t.id}
            onClick={() => setActive(t.id)}
            style={
              active === t.id
                ? {
                    background: "var(--color-surface-2)",
                    color: "var(--color-ink)",
                    borderRadius: "var(--radius-pill)",
                    padding: "6px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    border: "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-body)",
                    letterSpacing: "-0.1px",
                  }
                : {
                    background: "transparent",
                    color: "var(--color-ink-muted)",
                    borderRadius: "var(--radius-pill)",
                    padding: "6px 16px",
                    fontSize: 13,
                    fontWeight: 400,
                    border: "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-body)",
                  }
            }
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="studio-main">
        <div style={{ marginBottom: 40, paddingTop: 8 }}>
          <h1
            ref={heading}
            tabIndex={-1}
            className="type-display-lg"
            style={{ margin: "0 0 10px 0" }}
          >
            {TOOLS.find((t) => t.id === active)!.label}
          </h1>
          <p
            style={{
              fontSize: 16,
              fontWeight: 400,
              color: "var(--color-ink-muted)",
              lineHeight: 1.5,
              letterSpacing: "-0.01em",
              margin: 0,
              fontFamily: "var(--font-body)",
            }}
          >
            {TOOLS.find((t) => t.id === active)!.description}
          </p>
        </div>
        <Suspense
          fallback={
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: 320,
                color: "var(--color-ink-muted)",
              }}
            >
              <Loader2 size={26} className="animate-spin" />
            </div>
          }
        >
          <div className="studio-active-tool">
            <p className="studio-help">
              Palette, font and contrast drafts are retained in this tab.
              Switching tools cancels image processing and clears file inputs.
            </p>
            <Tool />
          </div>
        </Suspense>
      </main>
    </div>
  );
}

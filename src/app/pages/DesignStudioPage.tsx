import { Suspense, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import { usePageMeta } from "../components/hooks/use-page-meta";
import { TOOLS } from "../components/studio/tools";
import "../../styles/studio.css";
// Tools that decode or process user images; the session notice only applies there.
const MEDIA_TOOLS = new Set(["image", "halftone", "svg", "bg"]);
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

  // Keep the selected tool visible in the horizontally scrolling nav (deep
  // links and narrow screens), without moving the page vertically.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = nav.current;
    const item = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !item) return;
    const left = item.offsetLeft - bar.offsetLeft;
    if (left < bar.scrollLeft || left + item.offsetWidth > bar.scrollLeft + bar.clientWidth)
      bar.scrollLeft = left - 16;
  }, [active]);

  const tool = TOOLS.find((t) => t.id === active)!;
  const Tool = tool.comp;
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-canvas)",
        fontFamily: "var(--font-body)",
        color: "var(--color-ink)",
      }}
    >
      <nav ref={nav} aria-label="Design tools" className="studio-tool-nav">
        {TOOLS.map((t) => (
          <button
            aria-current={active === t.id ? "page" : undefined}
            className="studio-tool-nav-item"
            key={t.id}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="studio-main">
        <div className="studio-intro">
          <h1 ref={heading} tabIndex={-1} className="type-display-lg">
            {tool.label}
          </h1>
          <p>{tool.description}</p>
        </div>
        <Suspense
          fallback={
            <div className="studio-loading" role="status" aria-label="Loading tool">
              <Loader2 size={26} className="animate-spin" aria-hidden="true" />
            </div>
          }
        >
          <div className="studio-active-tool studio-tool">
            {MEDIA_TOOLS.has(active) && (
              <p className="studio-help">
                Switching tools cancels active image processing. Completed background and halftone images remain in this session; device image recovery is opt-in.
              </p>
            )}
            <Tool />
          </div>
        </Suspense>
      </main>
    </div>
  );
}

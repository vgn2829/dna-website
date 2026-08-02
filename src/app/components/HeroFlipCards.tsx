import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, useTransform, useSpring, useMotionValue, type MotionValue } from 'motion/react';
import { useNavigate } from 'react-router';
import { useAppData } from '../context/AppDataContext';
import type { Artwork } from '../context/AppDataContext';
import { Hero } from './Hero';

// Below this many featured artworks, the circle/arc formation reads as
// sparse rather than intentional — fall back to a static grid instead.
const MIN_FOR_ANIMATED_HERO = 6;

const IMG_WIDTH = 85;
const IMG_HEIGHT = 120;

// Virtual scroll range driving the circle→arc morph + arc shuffle, exactly
// like the reference component — wheel/touch input is captured (preventDefault)
// and accumulated into this range instead of the page actually scrolling.
const MAX_SCROLL = 3000;

type AnimationPhase = 'scatter' | 'line' | 'circle';

interface CardTarget { x: number; y: number; rotation: number; scale: number; opacity: number }

const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;

// All artworks get a generated coverUrl thumbnail at upload time (see
// backend generateThumb()); cards are tiny (85x120) so we always want the
// thumbnail, not the full-res original. mediaUrl is only a fallback for
// the rare case where thumbnail generation failed and coverUrl is null.
function artworkImage(a: Artwork): string | null {
  return a.coverUrl ?? a.mediaUrl;
}

// ─────────────────────────────────────────────────────────────────────────
// FlipCard — front shows the artwork image, back shows title/artist.
// ─────────────────────────────────────────────────────────────────────────
// target is either a fixed CardTarget (scatter/line phases — a real phase
// transition, so it's fine to let Motion's `animate` spring engine own it
// and re-render on phase change) or a single shared
// MotionValue<CardTarget[]> continuously derived from the scroll/mouse
// springs (circle phase), indexed per-card by `index`. In the MotionValue
// case we read this card's x/y/rotation/scale via useTransform and feed
// them into `style`, which Motion writes straight to the DOM on every
// spring tick — no React re-render, unlike the old
// `.on('change', setState)` path.
function FlipCard({
  artwork,
  target,
  index,
  onClick,
}: {
  artwork: Artwork;
  target: CardTarget | MotionValue<CardTarget[]>;
  index: number;
  onClick: () => void;
}) {
  const isLive = typeof target === 'object' && 'get' in target;

  // Hooks must run unconditionally — when `target` is a plain CardTarget
  // these derived values are simply unused.
  const liveTargets = isLive ? (target as MotionValue<CardTarget[]>) : undefined;
  const liveX = useTransform(() => liveTargets?.get()[index]?.x ?? 0);
  const liveY = useTransform(() => liveTargets?.get()[index]?.y ?? 0);
  const liveRotate = useTransform(() => liveTargets?.get()[index]?.rotation ?? 0);
  const liveScale = useTransform(() => liveTargets?.get()[index]?.scale ?? 1);
  const liveOpacity = useTransform(() => liveTargets?.get()[index]?.opacity ?? 1);

  const staticTarget = isLive ? undefined : (target as CardTarget);

  return (
    <motion.div
      {...(staticTarget
        ? {
            animate: {
              x: staticTarget.x,
              y: staticTarget.y,
              rotate: staticTarget.rotation,
              scale: staticTarget.scale,
              opacity: staticTarget.opacity,
            },
            transition: { type: 'spring', stiffness: 40, damping: 15 },
          }
        : {})}
      style={{
        position: 'absolute',
        width: IMG_WIDTH,
        height: IMG_HEIGHT,
        transformStyle: 'preserve-3d',
        perspective: 1000,
        cursor: 'pointer',
        ...(isLive
          ? { x: liveX, y: liveY, rotate: liveRotate, scale: liveScale, opacity: liveOpacity }
          : {}),
      }}
      className="group"
      onClick={onClick}
    >
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: 'preserve-3d' }}
        transition={{ duration: 0.6, type: 'spring', stiffness: 260, damping: 20 }}
        whileHover={{ rotateY: 180 }}
      >
        {/* Front Face */}
        <div
          className="absolute inset-0 h-full w-full overflow-hidden"
          style={{
            backfaceVisibility: 'hidden',
            boxShadow: 'var(--shadow-level-1)',
            background: 'var(--color-surface-2)',
            // Explicit px value, not the `rounded-xl` Tailwind class: this
            // project's @theme remaps rounded-xl to --radius-pill (100px)
            // for larger UI, which overlaps into faceted corners on a card
            // this small (60x85px).
            borderRadius: 12,
          }}
        >
          <img
            src={artworkImage(artwork) ?? undefined}
            alt={artwork.title}
            className="h-full w-full object-cover"
            draggable={false}
          />
          <div
            className="absolute inset-0 transition-colors group-hover:bg-transparent"
            style={{ background: 'rgba(0,0,0,0.10)' }}
          />
        </div>

        {/* Back Face */}
        <div
          className="absolute inset-0 h-full w-full overflow-hidden flex flex-col items-center justify-center p-2 text-center"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-hairline)',
            boxShadow: 'var(--shadow-level-1)',
            borderRadius: 12,
          }}
        >
          <p
            className="line-clamp-2"
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-ink)', lineHeight: 1.25 }}
          >
            {artwork.title}
          </p>
          <p style={{ fontSize: 9, color: 'var(--color-ink-muted)', marginTop: 3 }}>
            {artwork.artist}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Animated hero — ported 1:1 from the reference's scroll mechanics: wheel
// and touch input is captured (preventDefault) over this section and
// accumulated into a virtual 0–MAX_SCROLL counter, which drives the
// circle→bottom-arc morph, arc shuffle, and content fades. The page does
// not actually scroll while this section owns input; scrolling back
// (negative delta) reverses the morph at the same speed, matching the
// reference. Once the counter maxes out, wheel/touch is released so the
// page scrolls normally into Mission.
// ─────────────────────────────────────────────────────────────────────────
function AnimatedFlipHero({ artworks }: { artworks: Artwork[] }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<AnimationPhase>('scatter');
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const total = artworks.length;

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(containerRef.current);
    setContainerSize({
      width: containerRef.current.offsetWidth,
      height: containerRef.current.offsetHeight,
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('line'), 500);
    const t2 = setTimeout(() => setPhase('circle'), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const scatterPositions = useMemo<CardTarget[]>(() => {
    return artworks.map(() => ({
      x: (Math.random() - 0.5) * 1500,
      y: (Math.random() - 0.5) * 1000,
      rotation: (Math.random() - 0.5) * 180,
      scale: 0.6,
      opacity: 0,
    }));
  }, [artworks]);

  // --- Virtual scroll: wheel/touch deltas accumulate here instead of the
  // page actually scrolling. Released (page scrolls normally) once maxed out.
  const virtualScroll = useMotionValue(0);
  const scrollRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const atMax = () => scrollRef.current >= MAX_SCROLL;
    const atMin = () => scrollRef.current <= 0;

    // Native wheel/touchmove can fire far faster than the display refresh
    // rate (OS scroll acceleration in particular can emit dozens of events
    // per frame). Accumulate raw deltas as they arrive but only commit them
    // to virtualScroll.set() once per animation frame, so downstream spring
    // updates run at most at display refresh rate instead of native event
    // rate — the accumulation/clamping math itself is unchanged.
    let pendingDelta = 0;
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      if (pendingDelta === 0) return;
      const newScroll = Math.min(Math.max(scrollRef.current + pendingDelta, 0), MAX_SCROLL);
      pendingDelta = 0;
      scrollRef.current = newScroll;
      virtualScroll.set(newScroll);
    };
    const queueDelta = (deltaY: number) => {
      pendingDelta += deltaY;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    const handleWheel = (e: WheelEvent) => {
      // Let the browser scroll normally once we've maxed out the virtual
      // range and the user keeps scrolling down (or is at 0 and scrolling
      // up, back into the page above) — only capture input while actively
      // morphing between circle and arc.
      if ((atMax() && e.deltaY > 0) || (atMin() && e.deltaY < 0)) return;

      e.preventDefault();
      queueDelta(e.deltaY);
    };

    // Wheel/trackpad deltaY is frequently amplified by OS-level scroll
    // acceleration and momentum (extra synthetic events fire during
    // deceleration, well past the physical gesture), while touchmove's
    // deltaY is raw, un-amplified finger travel — it only fires while the
    // finger is actually moving, with no inertia layer feeding into it.
    // Without compensation, a full touch swipe covers a much smaller
    // fraction of MAX_SCROLL than an equivalent wheel scroll, making touch
    // feel heavy. This multiplier brings touch swipe distance back in line
    // with wheel input's effective (accelerated) scroll distance.
    const TOUCH_DELTA_MULTIPLIER = 3;

    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => { touchStartY = e.touches[0].clientY; };
    const handleTouchMove = (e: TouchEvent) => {
      const touchY = e.touches[0].clientY;
      const deltaY = (touchStartY - touchY) * TOUCH_DELTA_MULTIPLIER;
      touchStartY = touchY;

      if ((atMax() && deltaY > 0) || (atMin() && deltaY < 0)) return;

      e.preventDefault();
      queueDelta(deltaY);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [virtualScroll]);

  // 1. Morph: 0 (circle) → 1 (bottom arc), scroll 0–600.
  const morphProgress = useTransform(virtualScroll, [0, 600], [0, 1]);
  const smoothMorph = useSpring(morphProgress, { stiffness: 40, damping: 20 });

  // 2. Arc shuffle: continues after the morph, scroll 600–3000.
  const scrollRotate = useTransform(virtualScroll, [600, MAX_SCROLL], [0, 360]);
  const smoothScrollRotate = useSpring(scrollRotate, { stiffness: 40, damping: 20 });

  // --- Mouse parallax (arc cards drift slightly with cursor x-position) ---
  const mouseX = useMotionValue(0);
  const smoothMouseX = useSpring(mouseX, { stiffness: 30, damping: 20 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Cache the container's bounding rect instead of calling
    // getBoundingClientRect() on every mousemove — that forces a
    // synchronous layout read at native mousemove frequency. The rect only
    // actually changes on resize/scroll of ancestors, so re-measure there
    // instead of on every pointer move.
    let rect = container.getBoundingClientRect();
    const updateRect = () => { rect = container.getBoundingClientRect(); };
    const resizeObserver = new ResizeObserver(updateRect);
    resizeObserver.observe(container);
    window.addEventListener('scroll', updateRect, { passive: true });

    // Batch mousemove updates to at most once per animation frame, same
    // reasoning as the wheel/touch handlers above.
    let pendingClientX: number | null = null;
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      if (pendingClientX === null) return;
      const relativeX = pendingClientX - rect.left;
      const normalizedX = (relativeX / rect.width) * 2 - 1;
      pendingClientX = null;
      mouseX.set(normalizedX * 100);
    };
    const handleMouseMove = (e: MouseEvent) => {
      pendingClientX = e.clientX;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };

    container.addEventListener('mousemove', handleMouseMove);
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('scroll', updateRect);
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [mouseX]);

  // Circle-phase card positions used to be recomputed by reading morph/
  // rotate/parallax out of React state (`.on('change', setState)`), which
  // re-rendered this whole component — and every card's trig/lerp math —
  // on every spring physics tick while settling, not just once per input
  // event. Instead, derive one MotionValue<CardTarget[]> straight from the
  // source springs via useTransform: Motion recomputes this on each spring
  // tick without touching React's render cycle at all, and writes the
  // result to the DOM through each FlipCard's `style` (see below). Real
  // state transitions (phase, containerSize, artworks) still legitimately
  // re-render, since this callback re-closes over them.
  const circleTargets = useTransform(
    [smoothMorph, smoothScrollRotate, smoothMouseX],
    ([morphValue, rotateValue, parallaxValue]: [number, number, number]): CardTarget[] => {
      const isMobile = containerSize.width < 768;
      const minDimension = Math.min(containerSize.width, containerSize.height);

      const clearanceT = Math.max(0, Math.min(1, (minDimension - 400) / (900 - 400)));
      const circleRadiusMultiplier = 0.68 - clearanceT * (0.68 - 0.49);
      const circleRadius = Math.min(minDimension * circleRadiusMultiplier, 490);

      const baseRadius = Math.min(containerSize.width, containerSize.height * 1.5);
      const arcRadius = baseRadius * (isMobile ? 1.4 : 1.1) * 1.4;
      const arcApexY = containerSize.height * (isMobile ? 0.35 : 0.25);
      const arcCenterY = arcApexY + arcRadius;
      const spreadAngle = isMobile ? 100 : 130;
      const startAngle = -90 - spreadAngle / 2;
      const step = spreadAngle / (total - 1 || 1);

      const scrollProgress = Math.min(Math.max(rotateValue / 360, 0), 1);
      const maxRotation = spreadAngle * 0.8;
      const boundedRotation = -scrollProgress * maxRotation;

      return Array.from({ length: total }, (_, i) => {
        // A. Circle position (scroll progress 0)
        const circleAngle = (i / total) * 360;
        const circleRad = (circleAngle * Math.PI) / 180;
        const circlePos = {
          x: Math.cos(circleRad) * circleRadius,
          y: Math.sin(circleRad) * circleRadius,
          rotation: circleAngle + 90,
        };

        // B. Bottom-arc position (scroll progress 1) — convex "rainbow"
        // arc with the apex near the top of the viewport.
        const currentArcAngle = startAngle + i * step + boundedRotation;
        const arcRad = (currentArcAngle * Math.PI) / 180;
        const arcPos = {
          x: Math.cos(arcRad) * arcRadius + parallaxValue,
          y: Math.sin(arcRad) * arcRadius + arcCenterY,
          rotation: currentArcAngle + 90,
          scale: isMobile ? 1.4 : 1.8,
        };

        // C. Interpolate circle → arc by scroll-driven morph progress.
        return {
          x: lerp(circlePos.x, arcPos.x, morphValue),
          y: lerp(circlePos.y, arcPos.y, morphValue),
          rotation: lerp(circlePos.rotation, arcPos.rotation, morphValue),
          scale: lerp(1, arcPos.scale, morphValue),
          opacity: 1,
        };
      });
    },
  );

  // Intro/arc content visibility also used to be driven by the morphValue
  // state mirror. These derive straight from the same spring instead —
  // MotionValue<boolean>/<number> written to `style`/`animate` via the
  // opacity transforms below, so no state mirror is needed here either.
  // Gated to 0 outside the circle phase so intro content stays hidden during
  // scatter/line, matching the old `introContentVisible` behavior — but the
  // continuous fade-with-morph while in circle phase is driven by the
  // spring directly instead of a per-tick state mirror.
  const introHeadingOpacity = useTransform(smoothMorph, m =>
    phase === 'circle' ? Math.max(0, 1 - m * 2) : 0,
  );
  const introCaptionOpacity = useTransform(smoothMorph, m =>
    phase === 'circle' ? Math.max(0, 0.5 - m) : 0,
  );
  const introBlur = useTransform(smoothMorph, m =>
    phase === 'circle' && m < 0.5 ? 'blur(0px)' : 'blur(10px)',
  );
  const arcContentOpacity = useTransform(smoothMorph, m => (m > 0.8 ? 1 : 0));
  const arcContentY = useTransform(smoothMorph, m => (m > 0.8 ? 0 : 20));

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{ height: '100svh', background: 'var(--color-canvas)' }}
    >
      <div
        className="flex h-full w-full flex-col items-center justify-center"
        style={{ perspective: 1000 }}
      >
        {/* Intro content — visible only while the circle is freshly formed,
            before the scroll-driven arc morph begins. Opacity/blur now
            track the morph spring directly via `style` (no React
            re-render per tick) instead of an `animate` target recomputed
            from state on every spring change. */}
        <div className="absolute z-0 flex flex-col items-center justify-center text-center pointer-events-none top-1/2 -translate-y-1/2 px-4">
          <motion.h1
            transition={{ duration: 1 }}
            className="type-display-xl"
            // Overrides the shared .type-display-xl font-size (clamp floor
            // 40px) with a lower floor (28px) specific to this heading —
            // on narrow viewports the circle formation shrinks faster than
            // a 40px floor allows the text to, causing cards to overlap
            // the heading horizontally (see circleRadius below).
            style={{
              maxWidth: 700,
              fontSize: 'clamp(28px, 6vw, 85px)',
              opacity: introHeadingOpacity,
              filter: introBlur,
            }}
          >
            Design and Animation Club.
          </motion.h1>
          <motion.p
            transition={{ duration: 1, delay: 0.2 }}
            className="type-caption"
            style={{
              marginTop: 16,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              opacity: introCaptionOpacity,
            }}
          >
            Scroll to explore
          </motion.p>
        </div>

        {/* Arc-active content — fades in once the arc has formed. */}
        <motion.div
          transition={{ duration: 0.6 }}
          className="absolute top-[10%] z-10 flex flex-col items-center justify-center text-center pointer-events-none px-4"
          style={{ opacity: arcContentOpacity, y: arcContentY }}
        >
          <h2 className="type-display-lg" style={{ marginBottom: 16, maxWidth: 700 }}>
            Explore Our Vision
          </h2>
          <p className="type-body-lg" style={{ maxWidth: 520 }}>
            IIT Kanpur's creative community for UI/UX, motion design,
            3D artistry, and visual storytelling.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap pointer-events-auto" style={{ marginTop: 32 }}>
            <button className="btn-primary" onClick={() => navigate('/gallery')}>View Gallery</button>
          </div>
        </motion.div>

        <div className="relative flex items-center justify-center w-full h-full">
          {artworks.map((artwork, i) => {
            // Scatter/line are real phase transitions (only 2 of them,
            // total, over the component's lifetime) — a fixed CardTarget
            // here is fine, FlipCard springs to it via `animate`. Circle
            // phase's continuous scroll/mouse-driven position instead comes
            // from the shared circleTargets MotionValue computed above, so
            // FlipCard reads it directly without React re-rendering this map.
            const target: CardTarget | MotionValue<CardTarget[]> =
              phase === 'scatter'
                ? scatterPositions[i]
                : phase === 'line'
                  ? (() => {
                      const lineSpacing = 100;
                      const lineTotalWidth = total * lineSpacing;
                      return { x: i * lineSpacing - lineTotalWidth / 2, y: 0, rotation: 0, scale: 1, opacity: 1 };
                    })()
                  : circleTargets;

            return (
              <FlipCard
                key={artwork.id}
                artwork={artwork}
                target={target}
                index={i}
                onClick={() => navigate(`/gallery?art=${artwork.id}`)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Static fallback — used when there are 1-5 featured artworks: not enough
// to form a convincing circle, but we still want their artwork visible
// rather than falling all the way back to the plain original Hero.
// ─────────────────────────────────────────────────────────────────────────
function StaticFeaturedGrid({ artworks }: { artworks: Artwork[] }) {
  const navigate = useNavigate();

  return (
    <section
      id="home"
      style={{
        background: 'var(--color-canvas)',
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '112px 24px 96px',
        textAlign: 'center',
      }}
    >
      <span className="eyebrow" style={{ marginBottom: 32 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block', flexShrink: 0 }} />
        IIT Kanpur · Design &amp; Animation Club
      </span>
      <h1 className="type-display-xxl" style={{ maxWidth: 900 }}>
        Design and<br />Animation<br />
        <span style={{ color: 'var(--color-ink-muted)' }}>Club.</span>
      </h1>
      <p className="type-body-lg" style={{ maxWidth: 520, marginTop: 24 }}>
        IIT Kanpur's creative community for UI/UX, motion design,
        3D artistry, and visual storytelling.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 56,
          flexWrap: 'wrap',
          justifyContent: 'center',
          maxWidth: 900,
        }}
      >
        {artworks.map(a => (
          <div
            key={a.id}
            onClick={() => navigate(`/gallery?art=${a.id}`)}
            style={{
              width: 160,
              height: 210,
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              position: 'relative',
              cursor: 'pointer',
              background: 'var(--color-surface-2)',
              flexShrink: 0,
            }}
          >
            <img
              src={artworkImage(a) ?? undefined}
              alt={a.title}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div
              style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)',
              }}
            />
            <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, textAlign: 'left' }}>
              <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>{a.title}</p>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 }}>by {a.artist}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Loading state — shown only while the initial artworks fetch is in
// flight. Same section sizing/background as the real hero paths (no
// layout shift on swap), but deliberately shows nothing beyond the
// eyebrow — no competing hero design, so there's no visible "wrong
// design flashes then swaps" moment once data resolves.
// ─────────────────────────────────────────────────────────────────────────
function HeroLoading() {
  return (
    <section
      id="home"
      style={{
        background: 'var(--color-canvas)',
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '112px 24px 96px',
        textAlign: 'center',
      }}
    >
      <span className="eyebrow">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block', flexShrink: 0 }} />
        IIT Kanpur · Design &amp; Animation Club
      </span>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Entry point — picks animated hero / static grid / plain original Hero
// depending on how many featured artworks currently exist.
// ─────────────────────────────────────────────────────────────────────────
export function HeroFlipCards() {
  const { artworks, loading } = useAppData();
  // Only artworks with a renderable image (see artworkImage()) can appear
  // in a hero built entirely out of flip cards.
  const featured = useMemo(
    () => artworks.filter(a => a.featured && artworkImage(a) !== null),
    [artworks],
  );

  // AppDataContext's fetch effect re-runs whenever `roll` changes (e.g. a
  // student session resolving or being cleared shortly after mount for
  // re-verification), which flips `loading` back to true even though we
  // already have a good `artworks` snapshot. Only treat this as the
  // "nothing loaded yet" case the first time around — once cards have
  // rendered, a background refetch shouldn't unmount AnimatedFlipHero and
  // restart its scatter/line/circle sequence + spring physics from
  // scratch, which visibly flashes cards back to their collapsed mount
  // position before they re-scatter.
  const hasLoadedOnce = useRef(false);
  if (!loading) hasLoadedOnce.current = true;

  // Once AnimatedFlipHero has been shown, an admin's toggleFeatured
  // optimistic update (same-tab, no refetch needed) can move featured.length
  // back across MIN_FOR_ANIMATED_HERO for the rest of this session. Swapping
  // branches at that point would unmount/remount AnimatedFlipHero — the same
  // visible collapse-then-rescatter flash PR #45 fixed for the loading case,
  // just triggered by count instead of by `loading`. Latch onto the animated
  // hero once shown and keep it for the session as long as there's still at
  // least one featured artwork to display.
  //
  // This ref must be called unconditionally, before any early return below —
  // calling it after a conditional `return` (as originally written) meant
  // the loading/empty branches called fewer hooks than the animated-hero
  // branch, violating the Rules of Hooks. React only detects that mismatch
  // on the NEXT render, throwing "Rendered more hooks than during the
  // previous render" and crashing the whole page — which happened whenever
  // a loading render committed before the fetch resolved (slow network),
  // but not when the fetch was fast enough to skip the loading render
  // entirely. That's what produced an intermittent, network-timing-
  // dependent crash that looked like the hero collapsing.
  const hasShownAnimatedHero = useRef(false);
  if (featured.length >= MIN_FOR_ANIMATED_HERO) hasShownAnimatedHero.current = true;

  // While the initial fetch is in flight, show a minimal loading state —
  // not the plain Hero, which used to double as a loading placeholder and
  // then visibly swapped to a different hero design once data resolved.
  if (loading && !hasLoadedOnce.current) {
    return <HeroLoading />;
  }

  // Genuinely zero featured artworks (not a loading state) — fall back to
  // the plain original Hero, unchanged.
  if (featured.length === 0) {
    return <Hero />;
  }

  if (featured.length < MIN_FOR_ANIMATED_HERO && !hasShownAnimatedHero.current) {
    return <StaticFeaturedGrid artworks={featured} />;
  }

  return <AnimatedFlipHero artworks={featured} />;
}

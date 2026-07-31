import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { useAppData } from '../context/AppDataContext';
import type { Artwork } from '../context/AppDataContext';
import { Hero } from './Hero';

// Below this many featured artworks, the circle/arc formation reads as
// sparse rather than intentional — fall back to a static grid instead.
const MIN_FOR_ANIMATED_HERO = 6;

const IMG_WIDTH = 60;
const IMG_HEIGHT = 85;

type AnimationPhase = 'scatter' | 'line' | 'circle';

interface CardTarget { x: number; y: number; rotation: number; scale: number; opacity: number }

// Mirrors FeaturedMarquee/HeroScroll: an <img> is only safe to point at
// mediaUrl for image-type artworks. video/pdf artworks need a generated
// coverUrl thumbnail — without one, there's no valid image to show.
function artworkImage(a: Artwork): string | null {
  if (a.mediaType === 'image') return a.mediaUrl;
  return a.coverUrl;
}

// ─────────────────────────────────────────────────────────────────────────
// FlipCard — front shows the artwork image, back shows title/artist.
// ─────────────────────────────────────────────────────────────────────────
function FlipCard({ artwork, target, onClick }: { artwork: Artwork; target: CardTarget; onClick: () => void }) {
  return (
    <motion.div
      animate={{
        x: target.x,
        y: target.y,
        rotate: target.rotation,
        scale: target.scale,
        opacity: target.opacity,
      }}
      transition={{ type: 'spring', stiffness: 40, damping: 15 }}
      style={{
        position: 'absolute',
        width: IMG_WIDTH,
        height: IMG_HEIGHT,
        transformStyle: 'preserve-3d',
        perspective: 1000,
        cursor: 'pointer',
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
          className="absolute inset-0 h-full w-full overflow-hidden rounded-xl"
          style={{
            backfaceVisibility: 'hidden',
            boxShadow: 'var(--shadow-level-1)',
            background: 'var(--color-surface-2)',
          }}
        >
          <img
            src={artworkImage(artwork) ?? undefined}
            alt={artwork.title}
            className="h-full w-full object-cover"
            loading="lazy"
            draggable={false}
          />
          <div
            className="absolute inset-0 transition-colors group-hover:bg-transparent"
            style={{ background: 'rgba(0,0,0,0.10)' }}
          />
        </div>

        {/* Back Face */}
        <div
          className="absolute inset-0 h-full w-full overflow-hidden rounded-xl flex flex-col items-center justify-center p-1 text-center"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-hairline)',
            boxShadow: 'var(--shadow-level-1)',
          }}
        >
          <p
            className="line-clamp-2"
            style={{ fontSize: 8, fontWeight: 600, color: 'var(--color-ink)', lineHeight: 1.2 }}
          >
            {artwork.title}
          </p>
          <p style={{ fontSize: 7, color: 'var(--color-ink-muted)', marginTop: 2 }}>
            {artwork.artist}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Animated hero — scatter → line → circle, then idle. Time-based only;
// no scroll/wheel hijacking (this replaced a virtual-scroll version by
// design — see PR description).
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

  const contentVisible = phase === 'circle';

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" style={{ background: 'var(--color-canvas)' }}>
      <div className="flex h-full w-full flex-col items-center justify-center" style={{ perspective: 1000 }}>
        {/* Arc/circle-active content — fades in once the circle settles */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={contentVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: contentVisible ? 0.3 : 0 }}
          className="absolute top-[14%] z-10 flex flex-col items-center justify-center text-center pointer-events-none px-4"
        >
          <span className="eyebrow" style={{ marginBottom: 20 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block', flexShrink: 0 }} />
            IIT Kanpur · Design &amp; Animation Club
          </span>
          <h2 className="type-display-lg" style={{ marginBottom: 16, maxWidth: 700 }}>
            Design and Animation Club.
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
            let target: CardTarget;

            if (phase === 'scatter') {
              target = scatterPositions[i];
            } else if (phase === 'line') {
              const lineSpacing = 70;
              const lineTotalWidth = total * lineSpacing;
              target = { x: i * lineSpacing - lineTotalWidth / 2, y: 0, rotation: 0, scale: 1, opacity: 1 };
            } else {
              const isMobile = containerSize.width < 768;
              const minDimension = Math.min(containerSize.width, containerSize.height);
              const circleRadius = Math.min(minDimension * 0.35, 350);
              const circleAngle = (i / total) * 360;
              const circleRad = (circleAngle * Math.PI) / 180;
              target = {
                x: Math.cos(circleRad) * circleRadius,
                y: Math.sin(circleRad) * circleRadius,
                rotation: circleAngle + 90,
                scale: isMobile ? 1 : 1,
                opacity: 1,
              };
            }

            return (
              <FlipCard
                key={artwork.id}
                artwork={artwork}
                target={target}
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
              loading="lazy"
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

  // While the initial fetch is in flight, artworks is still [] — render the
  // plain Hero (needs no data) rather than flashing it and then swapping to
  // the animated/grid version once featured artworks arrive.
  if (loading || featured.length === 0) {
    return <Hero />;
  }

  if (featured.length < MIN_FOR_ANIMATED_HERO) {
    return <StaticFeaturedGrid artworks={featured} />;
  }

  return (
    <section style={{ minHeight: '100svh', position: 'relative' }}>
      <AnimatedFlipHero artworks={featured} />
    </section>
  );
}

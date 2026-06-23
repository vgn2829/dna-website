import { useRef, useMemo } from 'react';
import { useScroll, useTransform, motion, useSpring } from 'motion/react';
import { useAppData } from '../context/AppDataContext';
import type { Artwork } from '../context/AppDataContext';

export default function HeroScroll() {
  const { artworks } = useAppData();
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start 0.9', 'end 0.1'],
  });

  // Spring smooth the scroll progress so animation feels physical not mechanical
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  // rotateX: 20deg tilted → 0deg flat
  const rotateX = useTransform(smoothProgress, [0, 1], [20, 0]);

  // Scale up slightly as it flattens
  const scale = useTransform(smoothProgress, [0, 1], [0.9, 1]);

  // Move up slightly as it flattens
  const y = useTransform(smoothProgress, [0, 1], [60, 0]);

  const displayArtworks = useMemo(() => {
    const featured = artworks.filter(a => a.featured);
    if (featured.length >= 6) return featured.slice(0, 6);
    const nonFeatured = artworks.filter(a => !a.featured).slice(0, 6 - featured.length);
    return [...featured, ...nonFeatured].slice(0, 6);
  }, [artworks]);

  if (displayArtworks.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{
        background: 'var(--color-canvas)',
        padding: '0 24px 120px',
        // CRITICAL: perspective must be on the parent div for rotateX to work.
        // Do NOT put it on the motion.div itself.
        perspective: 1200,
        perspectiveOrigin: '50% 0%',
      }}
    >
      <motion.div
        style={{
          rotateX,
          scale,
          y,
          transformOrigin: '50% 0%',
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-hairline)',
          borderRadius: 30,
          padding: 12,
          maxWidth: 1100,
          margin: '0 auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
        }}
      >
        <div
          style={{
            borderRadius: 22,
            overflow: 'hidden',
            background: 'var(--color-canvas)',
            padding: 8,
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 8,
            }}
          >
            {displayArtworks.map((artwork, i) => (
              <ArtworkTile key={artwork.id} artwork={artwork} index={i} />
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ArtworkTile({ artwork, index }: { artwork: Artwork; index: number }) {
  const heights = [220, 260, 200, 240, 220, 260];
  const height = heights[index % heights.length];

  const imageUrl =
    (artwork.mediaType === 'video' || artwork.mediaType === 'pdf') && artwork.coverUrl
      ? artwork.coverUrl
      : artwork.mediaUrl;

  return (
    <div
      style={{
        height,
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--color-surface-2)',
      }}
    >
      <img
        src={imageUrl}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center top',
          display: 'block',
        }}
        loading="lazy"
        draggable={false}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.3) 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

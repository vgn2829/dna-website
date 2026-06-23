import { useRef, useMemo } from 'react';
import { useScroll, useTransform, motion } from 'motion/react';
import { useAppData, type Artwork } from '../context/AppDataContext';

export default function HeroScroll() {
  const { artworks } = useAppData();
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start 0.9', 'end 0.1'],
  });

  // Pick up to 6 featured artworks, fill remaining slots with non-featured
  const displayArtworks = useMemo(() => {
    const featured = artworks.filter(a => a.featured);
    if (featured.length >= 6) return featured.slice(0, 6);
    const nonFeatured = artworks.filter(a => !a.featured).slice(0, 6 - featured.length);
    return [...featured, ...nonFeatured].slice(0, 6);
  }, [artworks]);

  // Card tilts from 20deg → 0deg as user scrolls into view
  const rotateX = useTransform(scrollYProgress, [0, 0.5], [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [0.95, 1]);
  const translateY = useTransform(scrollYProgress, [0, 0.5], [40, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.15], [0, 1]);

  if (displayArtworks.length === 0) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        background: 'var(--color-canvas)',
        padding: '0 24px 80px',
        perspective: '1200px',
        perspectiveOrigin: '50% 0%',
        overflow: 'hidden',
      }}
    >
      <motion.div
        style={{
          rotateX,
          scale,
          y: translateY,
          opacity: 1,
          background: 'var(--color-surface-1)',
          border: '1px solid var(--color-hairline)',
          borderRadius: 'var(--radius-xxl)',
          padding: 12,
          maxWidth: 1100,
          margin: '0 auto',
          transformOrigin: '50% 0%',
          boxShadow: [
            '0 0 0 1px rgba(255,255,255,0.04)',
            '0 20px 40px rgba(0,0,0,0.4)',
            '0 60px 80px rgba(0,0,0,0.2)',
          ].join(', '),
          willChange: 'transform',
        }}
      >
        <div
          style={{
            borderRadius: 'calc(var(--radius-xxl) - 8px)',
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

  // Match the same URL resolution used across GalleryPreview and FeaturedMarquee
  const imageUrl =
    (artwork.mediaType === 'video' || artwork.mediaType === 'pdf') && artwork.coverUrl
      ? artwork.coverUrl
      : artwork.mediaUrl ?? null;

  if (!imageUrl) return null;

  return (
    <div
      style={{
        height,
        borderRadius: 'var(--radius-lg)',
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

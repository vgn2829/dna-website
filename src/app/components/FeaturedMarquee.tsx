import { motion } from 'motion/react';

export function FeaturedMarquee() {
  const artworks = [
    { id: 1, title: 'Abstract Motion',    artist: 'Rahul K.',  accent: '#007AFF' },
    { id: 2, title: 'Digital Portrait',   artist: 'Priya S.',  accent: '#BF5AF2' },
    { id: 3, title: '3D Landscape',       artist: 'Amit P.',   accent: '#FF375F' },
    { id: 4, title: 'UI Design',          artist: 'Sneha M.',  accent: '#00D4FF' },
    { id: 5, title: 'Typography Art',     artist: 'Karan V.',  accent: '#FF9500' },
    { id: 6, title: 'Motion Graphics',    artist: 'Anjali R.', accent: '#34C759' },
  ];
  const items = [...artworks, ...artworks, ...artworks];

  return (
    <section style={{ background: 'var(--color-canvas)', padding: '96px 0', overflow: 'hidden', position: 'relative' }}>
      {/* Section label */}
      <div style={{ textAlign: 'center', marginBottom: 48, padding: '0 24px' }}>
        <h2 className="type-display-lg" style={{ marginBottom: 12 }}>Featured Artworks</h2>
        <p className="type-body-lg">Showcasing creativity from our talented members</p>
      </div>

      {/* Marquee track */}
      <div style={{ position: 'relative' }}>
        <motion.div
          style={{ display: 'flex', gap: 16, paddingLeft: 24, width: 'max-content' }}
          animate={{ x: ['0%', '-33.33%'] }}
          transition={{ repeat: Infinity, repeatType: 'loop', duration: 38, ease: 'linear' }}
        >
          {items.map((a, i) => (
            <div
              key={`${a.id}-${i}`}
              style={{
                flexShrink: 0,
                width: 300,
                height: 380,
                borderRadius: 'var(--radius-xl)',
                background: 'var(--color-surface-1)',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                padding: 24,
              }}
            >
              {/* colour splash — very subtle, not a gradient bg */}
              <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(160deg, ${a.accent}18 0%, transparent 60%)`, pointerEvents: 'none' }} />
              <h3 className="type-display-md" style={{ position: 'relative', zIndex: 1, marginBottom: 4 }}>{a.title}</h3>
              <p className="type-caption" style={{ position: 'relative', zIndex: 1 }}>by {a.artist}</p>
            </div>
          ))}
        </motion.div>

        {/* Edge fades into canvas */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 96, background: 'linear-gradient(to right, var(--color-canvas), transparent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 96, background: 'linear-gradient(to left, var(--color-canvas), transparent)', pointerEvents: 'none' }} />
      </div>
    </section>
  );
}

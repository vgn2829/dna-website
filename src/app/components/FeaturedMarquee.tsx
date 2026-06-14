import { useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { useAppData } from '../context/AppDataContext';

export function FeaturedMarquee() {
  const navigate = useNavigate();
  const { artworks, loading } = useAppData();
  const featured = artworks.filter(a => a.featured);
  const count = featured.length;
  const cardWidth = count >= 7 ? 220 : count >= 3 ? 260 : 300;

  const useMarquee = count >= 3;
  const duration = count <= 4 ? 20 : count <= 8 ? 30 : 40;
  const items = useMarquee ? [...featured, ...featured] : featured;

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes marquee {
        0%   { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  return (
    <section style={{ background: 'var(--color-canvas)', padding: '96px 0', overflow: 'hidden', position: 'relative' }}>
      <div style={{ textAlign: 'center', marginBottom: 48, padding: '0 24px' }}>
        <h2 className="type-display-lg" style={{ marginBottom: 12 }}>Featured Artworks</h2>
        <p className="type-body-lg">Showcasing creativity from our talented members</p>
      </div>

      {loading ? (
        <p className="type-caption text-center" style={{ color: 'var(--color-ink-muted)', padding: '48px 0' }}>Loading…</p>
      ) : count === 0 ? (
        <p className="type-caption text-center" style={{ color: 'var(--color-ink-muted)', padding: '48px 24px' }}>
          No featured artworks yet — star artworks in admin to feature them here
        </p>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ overflow: 'hidden', width: '100%' }}>
            <div
              style={{
                display: 'flex',
                gap: 16,
                paddingLeft: 24,
                width: 'max-content',
                ...(useMarquee
                  ? { animation: `marquee ${duration}s linear infinite` }
                  : { justifyContent: 'center' }),
              }}
              onMouseEnter={e => { if (useMarquee) e.currentTarget.style.animationPlayState = 'paused'; }}
              onMouseLeave={e => { if (useMarquee) e.currentTarget.style.animationPlayState = 'running'; }}
            >
              {items.map((a, i) => (
                <motion.div
                  key={`${a.id}-${i}`}
                  onClick={() => navigate('/gallery')}
                  whileHover={{ y: -4 }}
                  style={{
                    flexShrink: 0,
                    width: cardWidth,
                    height: 380,
                    borderRadius: 'var(--radius-xl)',
                    background: 'var(--color-surface-1)',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    position: 'relative',
                  }}
                >
                  {a.mediaType === 'image' && a.mediaUrl && (
                    <img
                      src={a.mediaUrl}
                      alt={a.title}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-xl)' }}
                    />
                  )}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 60%)', pointerEvents: 'none' }} />
                  <span className="type-caption" style={{
                    position: 'absolute', top: 12, right: 12,
                    background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
                    padding: '3px 10px', borderRadius: 'var(--radius-pill)', color: '#fff', zIndex: 1,
                  }}>
                    {a.domain}
                  </span>
                  <div style={{ position: 'relative', zIndex: 1, padding: 24 }}>
                    <h3 className="type-display-md" style={{ color: '#fff', marginBottom: 4 }}>{a.title}</h3>
                    <p className="type-caption" style={{ color: 'rgba(255,255,255,0.65)' }}>by {a.artist}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 80, background: 'linear-gradient(to right, var(--color-canvas), transparent)', pointerEvents: 'none', zIndex: 1 }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 80, background: 'linear-gradient(to left, var(--color-canvas), transparent)', pointerEvents: 'none', zIndex: 1 }} />
        </div>
      )}
    </section>
  );
}

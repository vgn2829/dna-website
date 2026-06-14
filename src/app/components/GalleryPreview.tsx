import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAppData, type Artwork } from '../context/AppDataContext';

function ArtworkCard({ a, i }: { a: Artwork; i: number }) {
  const navigate = useNavigate();
  return (
    <motion.div
      className="card"
      style={{ overflow: 'hidden', cursor: 'pointer' }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: i * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -4 }}
      onClick={() => navigate('/gallery')}
    >
      <div style={{ height: 220, position: 'relative', background: 'var(--color-surface-2)', overflow: 'hidden' }}>
        {a.mediaType === 'image' && a.mediaUrl ? (
          <img src={a.mediaUrl} alt={a.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(145deg, #7c3aed22 0%, transparent 70%)' }} />
        )}
        <span className="type-caption" style={{ position: 'absolute', top: 12, right: 12, background: 'var(--color-surface-1)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', color: 'var(--color-ink)' }}>
          {a.domain}
        </span>
      </div>
      <div style={{ padding: '20px 20px 24px' }}>
        <h3 className="type-display-md" style={{ marginBottom: 4, fontSize: 20 }}>{a.title}</h3>
        <p className="type-caption">by {a.artist}</p>
      </div>
    </motion.div>
  );
}

export function GalleryPreview() {
  const navigate = useNavigate();
  const { artworks, loading } = useAppData();

  const featured = artworks.filter(a => a.featured);
  const count = featured.length;

  let gridStyle: CSSProperties = { display: 'grid', gap: 16 };
  if (count === 0) {
    gridStyle = {};
  } else if (count <= 2) {
    gridStyle = { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16 };
  } else if (count <= 4) {
    gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 };
  } else if (count <= 6) {
    gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 };
  } else {
    gridStyle = { display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 };
  }

  return (
    <section id="gallery" style={{ background: 'var(--color-canvas)', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        <motion.div
          style={{ marginBottom: 64 }}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="type-display-lg" style={{ marginBottom: 12 }}>
            Artwork <span style={{ color: 'var(--color-ink-muted)' }}>Gallery</span>
          </h2>
          <p className="type-body-lg">Explore stunning creations from our talented community</p>
        </motion.div>

        <div style={{ marginBottom: 48 }}>
          {loading ? (
            <p className="type-caption text-center" style={{ color: 'var(--color-ink-muted)', padding: '48px 0' }}>Loading…</p>
          ) : count === 0 ? (
            <p className="type-caption text-center" style={{ color: 'var(--color-ink-muted)', padding: '48px 0' }}>No featured artworks yet</p>
          ) : (
            <div style={gridStyle}>
              {featured.map((a, i) => (
                <div key={a.id} style={count <= 2 ? { flex: '0 0 min(340px, 100%)' } : count >= 7 ? { flex: '0 0 280px' } : undefined}>
                  <ArtworkCard a={a} i={i} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          <button className="btn-secondary" onClick={() => navigate('/gallery')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            View Full Gallery <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

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
        {(a.mediaType === 'image' && a.mediaUrl) || ((a.mediaType === 'video' || a.mediaType === 'pdf') && a.coverUrl) ? (
          <img
            src={(a.mediaType === 'video' || a.mediaType === 'pdf') && a.coverUrl ? a.coverUrl : a.mediaUrl}
            alt={a.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
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

  const nonFeatured = artworks.filter(a => !a.featured);

  return (
    <section id="gallery" style={{ background: 'var(--color-canvas)', padding: '96px 0' }}>
      <div className="page-container">

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
          ) : nonFeatured.length === 0 ? (
            <p className="type-caption text-center" style={{ color: 'var(--color-ink-muted)', padding: '48px 0' }}>No artworks yet</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {nonFeatured.map((a, i) => <ArtworkCard key={a.id} a={a} i={i} />)}
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

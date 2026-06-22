import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAppData, type Artwork } from '../context/AppDataContext';

function ArtworkCard({ a, i }: { a: Artwork; i: number }) {
  const navigate = useNavigate();
  const forceUpper = localStorage.getItem('forceUppercase') !== 'false';
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
        <h3 className="type-display-md" style={{ marginBottom: 4, fontSize: 20, textTransform: forceUpper ? 'uppercase' : 'none' }}>{a.title}</h3>
        {a.artist?.trim() && <p className="type-caption" style={{ textTransform: forceUpper ? 'uppercase' : 'none' }}>by {a.artist}</p>}
      </div>
    </motion.div>
  );
}

export function GalleryPreview() {
  const navigate = useNavigate();
  const { artworks, loading } = useAppData();

  const shuffled = useMemo(() => {
    const nonFeatured = artworks.filter(a => !a.featured);
    const arr = [...nonFeatured];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [artworks]);

  const getCount = () => {
    if (window.innerWidth >= 1024) return 8;
    if (window.innerWidth >= 640) return 6;
    return 4;
  };

  const [count, setCount] = useState(getCount);

  useEffect(() => {
    const handleResize = () => setCount(getCount());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const displayArtworks = shuffled.slice(0, count);

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
          ) : displayArtworks.length === 0 ? (
            <p className="type-caption text-center" style={{ color: 'var(--color-ink-muted)', padding: '48px 0' }}>No artworks yet</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {displayArtworks.map((a, i) => <ArtworkCard key={a.id} a={a} i={i} />)}
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

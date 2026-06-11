import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';

const ARTWORKS = [
  { id: 1, title: 'Abstract Composition', artist: 'Rahul Kumar',  domain: 'Illustrator',    accent: '#007AFF' },
  { id: 2, title: 'Portrait Study',       artist: 'Priya Sharma', domain: 'Photoshop',       accent: '#BF5AF2' },
  { id: 3, title: '3D Character',         artist: 'Amit Patel',   domain: 'Blender',         accent: '#FF375F' },
  { id: 4, title: 'UI Dashboard',         artist: 'Sneha Mehta',  domain: 'Figma',           accent: '#00D4FF' },
  { id: 5, title: 'Motion Graphics',      artist: 'Karan Verma',  domain: 'After Effects',   accent: '#FF9500' },
  { id: 6, title: 'Brand Identity',       artist: 'Anjali Reddy', domain: 'UI/UX',           accent: '#34C759' },
];

export function GalleryPreview() {
  const navigate = useNavigate();

  return (
    <section id="gallery" style={{ background: 'var(--color-canvas)', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* Section header — canvas-mounted, no card */}
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

        {/* 3-up card grid — surface-1 tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 48 }}>
          {ARTWORKS.map((a, i) => (
            <motion.div
              key={a.id}
              className="card"
              style={{ overflow: 'hidden', cursor: 'pointer' }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4 }}
              onClick={() => navigate('/gallery')}
            >
              {/* Thumbnail area */}
              <div style={{ height: 220, position: 'relative', background: 'var(--color-surface-2)', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(145deg, ${a.accent}22 0%, transparent 70%)` }} />
                {/* Domain chip */}
                <span className="type-caption" style={{ position: 'absolute', top: 12, right: 12, background: 'var(--color-surface-1)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', color: 'var(--color-ink)' }}>
                  {a.domain}
                </span>
              </div>

              {/* Card body */}
              <div style={{ padding: '20px 20px 24px' }}>
                <h3 className="type-display-md" style={{ marginBottom: 4, fontSize: 20 }}>{a.title}</h3>
                <p className="type-caption">by {a.artist}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA — charcoal secondary pill */}
        <div style={{ textAlign: 'center' }}>
          <button className="btn-secondary" onClick={() => navigate('/gallery')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            View Full Gallery <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
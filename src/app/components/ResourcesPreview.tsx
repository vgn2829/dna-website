import { motion } from 'motion/react';
import { BookOpen, Video, Trophy, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';

const DOMAINS = [
  { name: 'UI/UX Design',   icon: '🎨', resources: 24, accent: '#007AFF', desc: 'Master user interface and experience design' },
  { name: 'Illustrator',    icon: '✏️', resources: 18, accent: '#BF5AF2', desc: 'Create stunning vector graphics' },
  { name: 'Photoshop',      icon: '🖼️', resources: 32, accent: '#FF375F', desc: 'Professional photo editing and manipulation' },
  { name: '3D Animation',   icon: '🎬', resources: 28, accent: '#00D4FF', desc: 'Bring your creations to life in 3D' },
  { name: 'After Effects',  icon: '🎞️', resources: 21, accent: '#FF9500', desc: 'Motion graphics and visual effects' },
  { name: 'Blender',        icon: '🧊', resources: 26, accent: '#34C759', desc: 'Complete 3D creation suite' },
];

export function ResourcesPreview() {
  const navigate = useNavigate();

  return (
    <section id="resources" style={{ background: 'var(--color-canvas)', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* Section header — flat on canvas */}
        <motion.div
          style={{ marginBottom: 64 }}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="type-display-lg" style={{ marginBottom: 12 }}>
            Learning <span style={{ color: 'var(--color-ink-muted)' }}>Resources</span>
          </h2>
          <p className="type-body-lg">Curated tutorials and courses to help you master design and animation</p>
        </motion.div>

        {/* 3-up surface-1 card grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 48 }}>
          {DOMAINS.map((d, i) => (
            <motion.div
              key={d.name}
              className="card"
              style={{ padding: 28, cursor: 'pointer' }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4 }}
              onClick={() => navigate('/academy')}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                <span style={{ fontSize: 28 }}>{d.icon}</span>
                <span className="type-caption" style={{ background: 'var(--color-surface-2)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', color: 'var(--color-ink)' }}>
                  {d.resources} resources
                </span>
              </div>

              <h3 className="type-display-md" style={{ fontSize: 22, marginBottom: 8 }}>{d.name}</h3>
              <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 24 }}>{d.desc}</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                {[[Video, 'Video tutorials'], [BookOpen, 'Written guides'], [Trophy, 'Practical exercises']].map(([I, label], j) => {
                  const Icon = I as React.ElementType;
                  return (
                    <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-ink-muted)' }}>
                      <Icon size={14} /> {label as string}
                    </div>
                  );
                })}
              </div>

              {/* Progress bar — accent colour, not gradient bg */}
              <div style={{ height: 3, borderRadius: 'var(--radius-full)', background: 'var(--color-surface-2)', overflow: 'hidden' }}>
                <motion.div
                  initial={{ width: 0 }}
                  whileInView={{ width: `${d.resources * 2.5}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 + 0.3, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                  style={{ height: '100%', background: d.accent, borderRadius: 'var(--radius-full)' }}
                />
              </div>
            </motion.div>
          ))}
        </div>

        <div style={{ textAlign: 'center' }}>
          <button className="btn-secondary" onClick={() => navigate('/academy')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Start Learning <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
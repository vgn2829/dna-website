import { motion } from 'motion/react';
import { Video, BookOpen, Trophy, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAppData } from '../context/AppDataContext';

export function ResourcesPreview() {
  const navigate = useNavigate();
  const { domains, loading } = useAppData();
  const domainList = Object.values(domains);
  const maxVideos = Math.max(1, ...domainList.map(d => d.videos.length));

  return (
    <section id="resources" style={{ background: 'var(--color-canvas)', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 48px' }}>

        {/* Section header */}
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

        {/* Domain cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 48 }}>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card" style={{ padding: 28, opacity: 0.35 }}>
                <div style={{ height: 24, width: 80, background: 'var(--color-surface-2)', borderRadius: 8, marginBottom: 20 }} />
                <div style={{ height: 22, width: '55%', background: 'var(--color-surface-2)', borderRadius: 6, marginBottom: 8 }} />
                <div style={{ height: 14, width: '80%', background: 'var(--color-surface-2)', borderRadius: 6, marginBottom: 4 }} />
                <div style={{ height: 14, width: '65%', background: 'var(--color-surface-2)', borderRadius: 6, marginBottom: 28 }} />
                <div style={{ height: 3, background: 'var(--color-surface-2)', borderRadius: 99 }} />
              </div>
            ))
          ) : (
            domainList.map((domain, i) => {
              const barWidth = Math.max(15, Math.round((domain.videos.length / maxVideos) * 90));
              const features: [React.ElementType, string][] = [
                [Video,     `${domain.videos.length} video tutorial${domain.videos.length !== 1 ? 's' : ''}`],
                [BookOpen,  domain.tagline || 'Learn at your own pace'],
                [Trophy,    domain.quizzes.length > 0 ? 'Knowledge quiz included' : 'More content coming soon'],
              ];
              return (
                <motion.div
                  key={domain.id}
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
                    <i className={`fa-solid ${domain.icon}`} style={{ fontSize: 24, color: domain.color }} />
                    <span className="type-caption" style={{ background: 'var(--color-surface-2)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', color: 'var(--color-ink)' }}>
                      {domain.videos.length} videos
                    </span>
                  </div>

                  <h3 className="type-display-md" style={{ fontSize: 22, marginBottom: 8 }}>{domain.title}</h3>
                  <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 24 }}>
                    {domain.description || domain.tagline}
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                    {features.map(([Icon, label], j) => (
                      <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-ink-muted)' }}>
                        <Icon size={14} /> {label}
                      </div>
                    ))}
                  </div>

                  {/* Accent bar — width proportional to video count relative to largest domain */}
                  <div style={{ height: 3, borderRadius: 'var(--radius-full)', background: 'var(--color-surface-2)', overflow: 'hidden' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${barWidth}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.05 + 0.3, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                      style={{ height: '100%', background: domain.color, borderRadius: 'var(--radius-full)' }}
                    />
                  </div>
                </motion.div>
              );
            })
          )}
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

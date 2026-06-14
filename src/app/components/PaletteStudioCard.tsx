import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';

const SWATCHES = ['#6366F1', '#EC4899', '#8B5CF6', '#06B6D4'];

export function PaletteStudioCard() {
  const navigate = useNavigate();

  return (
    <section style={{ background: 'var(--color-canvas)', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        <motion.div
          style={{ marginBottom: 40 }}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="type-display-lg">
            Design <span style={{ color: 'var(--color-ink-muted)' }}>Tools</span>
          </h2>
        </motion.div>

        <motion.div
          className="card"
          style={{
            padding: 28,
            borderLeft: '3px solid #E91E8C',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 32,
          }}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Color swatches */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            {SWATCHES.map((color, i) => (
              <motion.div
                key={color}
                initial={{ scale: 0.8, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                whileHover={{ scale: 1.1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: color,
                  flexShrink: 0,
                }}
              />
            ))}
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <p className="type-caption" style={{ color: '#E91E8C', marginBottom: 6 }}>Interactive Tool</p>
            <h3 className="type-headline" style={{ marginBottom: 6 }}>Palette Studio</h3>
            <p className="type-body" style={{ color: 'var(--color-ink-muted)' }}>
              Generate accessible color palettes with OKLCH color science, WCAG + APCA contrast scoring, and color blind simulation — built by DnA Club.
            </p>
          </div>

          {/* CTA */}
          <button
            className="btn-primary"
            onClick={() => navigate('/palette')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            Try Palette Studio <ArrowRight size={14} />
          </button>
        </motion.div>
      </div>
    </section>
  );
}

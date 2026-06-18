import { motion } from 'motion/react';
import { useNavigate } from 'react-router';

export function DesignStudioCard() {
  const navigate = useNavigate();

  const tools = [
    { icon: '',   label: 'Palette Studio' },
    { icon: 'Aa', label: 'Font Pairing' },
    { icon: '◑',  label: 'Contrast Checker' },
    { icon: '↔',  label: 'Image Converter' },
    { icon: '⊞',  label: 'Grid Calculator' },
  ];

  return (
    <section style={{ padding: '96px 0', background: 'var(--color-canvas)' }}>
      <div className="page-container">
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{
            borderLeft: '4px solid var(--color-primary)',
            padding: '40px 40px 36px',
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <p
              className="type-caption"
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                marginBottom: 8,
              }}
            >
              Built for designers
            </p>
            <h2 className="type-display-lg" style={{ marginBottom: 12 }}>
              Design Studio
            </h2>
            <p className="type-body" style={{ maxWidth: 560 }}>
              A suite of free design tools — generate accessible color palettes,
              pair fonts, check contrast ratios, convert images, and calculate
              grid systems, all in one place.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 32,
            }}
          >
            {tools.map((t) => (
              <span
                key={t.label}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-pill)',
                  background: 'var(--color-surface-1)',
                  border: '1px solid var(--color-hairline)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--color-ink-muted)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {t.icon && <span style={{ fontSize: 14 }}>{t.icon}</span>}
                {t.label}
              </span>
            ))}
          </div>

          <button
            className="btn-primary"
            onClick={() => navigate('/design-studio')}
          >
            Open Design Studio
          </button>
        </motion.div>
      </div>
    </section>
  );
}

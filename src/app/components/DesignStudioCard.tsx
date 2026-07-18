import { motion } from 'motion/react';
import { useNavigate } from 'react-router';

export function DesignStudioCard() {
  const navigate = useNavigate();

  // Keep in sync with the TOOLS registry in pages/DesignStudioPage.tsx.
  const tools = [
    { icon: '',   label: 'Palette Studio',   tab: 'palette'  },
    { icon: 'Aa', label: 'Font Pairing',     tab: 'font'     },
    { icon: '◑',  label: 'Contrast Checker', tab: 'contrast' },
    { icon: '↔',  label: 'Image Converter',  tab: 'image'    },
    { icon: '⊞',  label: 'Grid Calculator',  tab: 'grid'     },
    { icon: '∷',  label: 'Halftone',         tab: 'halftone' },
    { icon: '⬡',  label: 'SVG Tools',        tab: 'svg'      },
    { icon: '◫',  label: 'Background Remover', tab: 'bg'     },
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
              pair fonts, check contrast ratios, convert between images, PDFs
              and SVGs, calculate grid systems, and build halftone patterns,
              all in one place.
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
              <button
                key={t.label}
                onClick={() => navigate('/design-studio', { state: { tab: t.tab } })}
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
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.color = 'var(--color-ink)';
                  (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.color = 'var(--color-ink-muted)';
                  (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-1)';
                }}
              >
                {t.icon && <span style={{ fontSize: 14 }}>{t.icon}</span>}
                {t.label}
              </button>
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

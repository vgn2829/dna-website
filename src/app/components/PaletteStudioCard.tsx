import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';

const SWATCHES = ['#6366F1', '#EC4899', '#8B5CF6', '#06B6D4'];

export function PaletteStudioCard() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      style={{
        background: 'linear-gradient(135deg, #E91E8C12 0%, #9C27B008 50%, var(--color-surface-1) 100%)',
        border: '1px solid #E91E8C30',
        borderRadius: 'var(--radius-xl)',
        padding: '28px 32px',
        display: 'flex',
        alignItems: isMobile ? 'flex-start' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        gap: 32,
      }}
    >
      {/* Animated color swatches */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        {SWATCHES.map((color, i) => (
          <motion.div
            key={color}
            initial={{ scale: 0.8, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            whileHover={{ scale: 1.15 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: color,
              boxShadow: `0 0 16px ${color}60`,
              flexShrink: 0,
            }}
          />
        ))}
      </div>

      {/* Text content */}
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#E91E8C', marginBottom: 6 }}>
          Tool
        </p>
        <h3 className="type-headline" style={{ marginBottom: 6 }}>
          Palette Studio
        </h3>
        <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
          Generate accessible color palettes with OKLCH color science, WCAG + APCA contrast scoring, and color blind simulation.
        </p>
      </div>

      {/* CTA button */}
      <motion.button
        whileHover={{ scale: 1.04 }}
        onClick={() => navigate('/palette')}
        style={{
          background: '#E91E8C',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          padding: '10px 22px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          ...(isMobile ? { width: '100%', justifyContent: 'center' } : {}),
        }}
      >
        Try it <ArrowRight size={14} />
      </motion.button>
    </motion.div>
  );
}

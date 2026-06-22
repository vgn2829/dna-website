import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';

interface WelcomeOverlayProps {
  name: string;
  onDone: () => void;
}

const FEATURES = [
  {
    symbol: '◆',
    title: 'Gallery',
    desc: 'Explore artwork, illustrations, and animations from DnA Club members.',
  },
  {
    symbol: '◆',
    title: 'Like & Comment',
    desc: 'React to posts and share your thoughts directly on any artwork.',
  },
  {
    symbol: '◆',
    title: 'Design Studio',
    desc: 'A set of creative tools — generate palettes, pair fonts, build mood boards, and more.',
  },
  {
    symbol: '◆',
    title: 'Academy',
    desc: 'Watch curated videos and track your learning progress across design domains.',
  },
];

export default function WelcomeOverlay({ name, onDone }: WelcomeOverlayProps) {
  const navigate = useNavigate();

  const handleExplore = () => {
    onDone();
    navigate('/gallery');
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          style={{
            width: '100%',
            maxWidth: 480,
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 'var(--radius-xl)',
            padding: '40px 36px',
            display: 'flex',
            flexDirection: 'column',
            gap: 28,
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--color-brand)',
              fontFamily: 'var(--font-body)',
            }}>
              Welcome to DnA Club
            </p>
            <h2 style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: '-0.5px',
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-display)',
              lineHeight: 1.2,
            }}>
              You're in, {name.split(' ')[0]}.
            </h2>
            <p style={{
              margin: 0,
              fontSize: 14,
              color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)',
              lineHeight: 1.6,
            }}>
              Here's what you can explore on the website.
            </p>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--color-hairline)' }} />

          {/* Feature list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08, duration: 0.35, ease: 'easeOut' }}
                style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}
              >
                <span style={{
                  color: 'var(--color-brand)',
                  fontSize: 10,
                  marginTop: 4,
                  flexShrink: 0,
                  fontFamily: 'var(--font-body)',
                }}>
                  {f.symbol}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <p style={{
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--color-ink)',
                    fontFamily: 'var(--font-body)',
                  }}>
                    {f.title}
                  </p>
                  <p style={{
                    margin: 0,
                    fontSize: 13,
                    color: 'var(--color-ink-muted)',
                    fontFamily: 'var(--font-body)',
                    lineHeight: 1.5,
                  }}>
                    {f.desc}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--color-hairline)' }} />

          {/* CTA */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleExplore}
              style={{
                width: '100%',
                padding: '14px 24px',
                background: 'var(--color-brand)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-pill)',
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
                letterSpacing: '0.02em',
              }}
            >
              Explore Gallery
            </motion.button>
            <button
              onClick={onDone}
              style={{
                width: '100%',
                padding: '12px 24px',
                background: 'none',
                color: 'var(--color-ink-muted)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-pill)',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
              }}
            >
              Browse on my own
            </button>
          </div>

        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

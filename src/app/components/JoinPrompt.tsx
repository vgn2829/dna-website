import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStudent } from '../context/StudentContext';

const GUEST_KEY = 'iitk_dna_guest_dismissed';
const GUEST_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function shouldShowJoinPrompt(): boolean {
  const raw = localStorage.getItem(GUEST_KEY);
  if (!raw) return true;
  try {
    const { dismissedAt } = JSON.parse(raw) as { dismissedAt: number };
    return Date.now() - dismissedAt > GUEST_EXPIRY_MS;
  } catch {
    return true;
  }
}

export function markGuestDismissed(): void {
  localStorage.setItem(GUEST_KEY, JSON.stringify({ dismissedAt: Date.now() }));
}

export default function JoinPrompt() {
  const { openRollModal } = useStudent();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (shouldShowJoinPrompt()) setVisible(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    markGuestDismissed();
    setVisible(false);
  };

  const handleRegister = () => {
    setVisible(false);
    openRollModal();
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '0 16px 32px',
            pointerEvents: 'none',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-xl)',
              padding: '28px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              pointerEvents: 'all',
            }}
          >
            {/* Top row — label + dismiss */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{
                  margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: 'var(--color-brand)', fontFamily: 'var(--font-body)',
                }}>
                  Design & Animation Club
                </p>
                <h3 style={{
                  margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.4px',
                  color: 'var(--color-ink)', fontFamily: 'var(--font-display)', lineHeight: 1.2,
                }}>
                  Join the club to get the full experience.
                </h3>
              </div>

              <button
                onClick={handleDismiss}
                aria-label="Dismiss"
                style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
                  border: '1px solid var(--color-hairline)', background: 'none',
                  color: 'var(--color-ink-muted)', fontSize: 16, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1, marginTop: 2,
                }}
              >
                ×
              </button>
            </div>

            {/* Description */}
            <p style={{
              margin: 0, fontSize: 13, color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)', lineHeight: 1.6,
            }}>
              Register with your IITK roll number to like artwork, leave comments,
              use Design Studio tools, and track your learning progress in Academy.
            </p>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleRegister}
                style={{
                  flex: 1, padding: '12px 20px', background: 'var(--color-brand)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600,
                  fontFamily: 'var(--font-body)', cursor: 'pointer', letterSpacing: '0.02em',
                }}
              >
                Register with IITK ID
              </motion.button>
              <button
                onClick={handleDismiss}
                style={{
                  flex: 1, padding: '12px 20px', background: 'none',
                  color: 'var(--color-ink-muted)', border: '1px solid var(--color-hairline)',
                  borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500,
                  fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
              >
                Browse as guest
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

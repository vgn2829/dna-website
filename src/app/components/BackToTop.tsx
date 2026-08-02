import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronUp } from 'lucide-react';

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // #root (not window) is the actual scroll container — its overflow-x:hidden
    // (see globals.css, added for a Safari position:fixed fix on board pages)
    // forces the browser to compute overflow-y:auto on it too, so #root scrolls
    // instead of window. window.scrollY would never move past 0 here.
    const scrollEl = document.getElementById('root');
    if (!scrollEl) return;
    const onScroll = () => setVisible(scrollEl.scrollTop > 300);
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2 }}
          onClick={() => document.getElementById('root')?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          style={{
            position: 'fixed',
            bottom: 28,
            right: 24,
            zIndex: 50,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-hairline)',
            color: 'var(--color-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          <ChevronUp size={18} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

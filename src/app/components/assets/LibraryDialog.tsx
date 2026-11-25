import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import { usePortalContainer } from '../PortalContainer';

// ─────────────────────────────────────────────────────────────────────────
// Dialog chrome for the asset library (library picker, Add Asset, delete
// confirm). Same backdrop/card look as the app's existing motion.div
// modals, plus the containment rules the workspace switcher needed:
// portalled (never trapped in an ancestor's stacking context), the card is
// capped to the viewport with overflow hidden, and only the body scrolls.
// Rendered only while open — callers mount/unmount it.
// ─────────────────────────────────────────────────────────────────────────

export function LibraryDialog({
  title,
  subtitle,
  onClose,
  maxWidth = 560,
  role = 'dialog',
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  maxWidth?: number;
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useModalA11y(true, onClose);
  const container = usePortalContainer();

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <motion.div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth, maxHeight: 'min(88vh, 860px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)',
          borderRadius: 'var(--radius-xl)', outline: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 20px 0', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="type-headline" style={{ margin: 0 }}>
              {title}
            </h3>
            {subtitle && (
              <p className="type-caption" style={{ margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="btn-translucent btn-icon btn-sm touch-target"
            style={{ flexShrink: 0 }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: 20 }}>
          {children}
        </div>
        {footer && (
          <div style={{ flexShrink: 0, padding: '0 20px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {footer}
          </div>
        )}
      </motion.div>
    </motion.div>,
    container
  );
}

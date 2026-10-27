import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useIsPresent } from 'motion/react';
import type { Board } from '../lib/api';
import { useModalA11y } from './hooks/useModalA11y';
import { usePortalContainer } from './PortalContainer';

// ─────────────────────────────────────────────────────────────────────────
// "Save to Moodboard" destination picker — one board list, shared by the
// Gallery (save an artwork) and the Assets preview (add a library image).
// The caller loads the boards and performs the save; this only renders the
// choice. Everything beyond the Gallery's original picker is opt-in:
//   boards === null      → loading
//   loadError + onRetry  → "couldn't load" with a retry
//   pendingBoardId       → that row says "Adding…"; every row is disabled
//   boardNote(board)     → a secondary line (e.g. the board's workspace)
//   disabledReason(board)→ the row is disabled and says why
// No boards at all offers the Moodboards page to create one.
// ─────────────────────────────────────────────────────────────────────────

export function SaveToMoodboardDialog({
  title = 'Save to Moodboard',
  description,
  boards,
  loadError = false,
  onRetry,
  busy = false,
  pendingBoardId = null,
  boardNote,
  disabledReason,
  onSelect,
  onClose,
  zIndex = 9000,
}: {
  title?: string;
  description?: ReactNode;
  boards: Board[] | null;
  loadError?: boolean;
  onRetry?: () => void;
  busy?: boolean;
  pendingBoardId?: string | null;
  boardNote?: (board: Board) => string | null;
  disabledReason?: (board: Board) => string | null;
  onSelect: (board: Board) => void;
  onClose: () => void;
  zIndex?: number;
}) {
  // Released as soon as the exit animation starts: a closing dialog no
  // longer takes Escape/Tab, and focus goes back to the opener at once.
  const dialogRef = useModalA11y(useIsPresent(), onClose);
  const container = usePortalContainer();
  const titleId = useId();
  const saving = busy || pendingBoardId !== null;

  const muted = { margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' } as const;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={boards === null || saving}
        tabIndex={-1}
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16 }}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 360, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '80vh', overflowY: 'auto', outline: 'none' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id={titleId} className="type-headline" style={{ margin: 0 }}>
            {title}
          </h2>
          {description && <p style={muted}>{description}</p>}
        </div>

        {boards === null ? (
          <p role="status" style={muted}>Loading your boards…</p>
        ) : loadError ? (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <p style={muted}>Couldn’t load your boards.</p>
            {onRetry && <button type="button" className="btn-secondary" onClick={onRetry}>Try again</button>}
          </div>
        ) : boards.length === 0 ? (
          <div>
            <p style={{ ...muted, margin: '0 0 12px' }}>
              You don't have any boards yet.
            </p>
            <a
              href="/moodboards"
              style={{ display: 'inline-block', padding: '8px 16px', background: 'var(--color-brand)', color: '#fff', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', textDecoration: 'none' }}
            >
              Create a Board
            </a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {boards.map(board => {
              const reason = disabledReason?.(board) ?? null;
              const note = boardNote?.(board) ?? null;
              const pending = pendingBoardId === board.id;
              const disabled = saving || !!reason;
              return (
                <button
                  key={board.id}
                  type="button"
                  // A row only becomes truly disabled for a reason: while a
                  // save is in flight it stays focusable (aria-disabled) so
                  // focus doesn't fall out of the dialog.
                  onClick={() => { if (!disabled) onSelect(board); }}
                  disabled={!!reason}
                  aria-disabled={disabled}
                  aria-describedby={reason ? `${titleId}-${board.id}` : undefined}
                  style={{ width: '100%', minWidth: 0, textAlign: 'left', padding: '12px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-canvas)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: reason ? 0.6 : 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {board.name}
                    </span>
                    {(reason || note) && (
                      <span id={reason ? `${titleId}-${board.id}` : undefined} style={{ fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {reason ?? note}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
                    {pending ? 'Adding…' : `${board.item_count} items`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{ padding: '10px 20px', background: 'none', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-pill)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>,
    container
  );
}

import { memo } from 'react';
import { rollToColor } from '../lib/utils';
import type { BoardComment } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// A single comment-thread pin, positioned in VIEWPORT space (already
// converted from page coordinates by the caller via editor.pageToViewport
// — see CommentsOverlay.tsx). memo'd so that re-rendering ONE pin (e.g. its
// own hover/selected state, or its thread gaining a reply) never re-renders
// every other pin on the board — see the PERFORMANCE requirement
// ("keep pins independent... memoize where appropriate"). The comparison is
// shallow-by-reference on `comment` and the primitive props, which is
// correct because useBoardComments always replaces a comment object
// wholesale on any change to it (see applyEvent's map/filter — never a
// mutation in place), so reference equality IS content equality here.
// ─────────────────────────────────────────────────────────────────────────

interface CommentPinProps {
  comment: BoardComment;
  x: number;
  y: number;
  replyCount: number;
  isOpen: boolean;
  isUnread: boolean;
  // True when this thread is anchored to a shape that no longer exists
  // (V2.6 Phase B). The comment is still shown at its last known location
  // and stays fully interactive — it is simply marked as detached, rather
  // than silently pretending to still be attached to the deleted shape.
  isOrphaned?: boolean;
  onClick: () => void;
}

function CommentPinImpl({ comment, x, y, replyCount, isOpen, isUnread, isOrphaned = false, onClick }: CommentPinProps) {
  const color = rollToColor(comment.authorRoll);
  const initial = (comment.authorName ?? comment.authorRoll)[0]?.toUpperCase() ?? '?';

  return (
    <button
      type="button"
      onClick={onClick}
      // Keyboard accessible: a real <button>, not a styled div — reachable
      // via Tab, activatable via Enter/Space with no extra handling needed.
      aria-label={`Comment thread by ${comment.authorName ?? comment.authorRoll}${replyCount > 0 ? `, ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : ''}${comment.resolvedAt ? ', resolved' : ''}${isOrphaned ? ', detached — the shape this was attached to was deleted' : ''}`}
      title={isOrphaned ? 'The shape this comment was attached to was deleted. The comment is shown at its last known position.' : undefined}
      aria-pressed={isOpen}
      style={{
        position: 'absolute',
        left: x, top: y,
        transform: 'translate(-8px, -100%)',
        zIndex: isOpen ? 460 : 450,
        width: 32, height: 32,
        borderRadius: isOrphaned ? '50%' : '50% 50% 50% 4px',
        background: comment.resolvedAt ? 'var(--color-surface-2)' : color,
        border: isOpen
          ? '2px solid var(--color-brand)'
          : isOrphaned
            ? '2px dashed var(--color-ink-muted)'
            : '2px solid var(--color-surface-1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, color: '#fff',
        fontFamily: 'var(--font-body)', cursor: 'pointer',
        padding: 0,
        opacity: comment.resolvedAt ? 0.6 : isOrphaned ? 0.75 : 1,
        transition: 'transform 0.12s ease',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {initial}
      {isOrphaned && (
        <span
          aria-hidden="true"
          title="Detached"
          style={{
            position: 'absolute', bottom: -6, left: -6,
            width: 16, height: 16, borderRadius: '50%',
            background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)',
            fontSize: 9, fontWeight: 700, color: 'var(--color-ink-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          ⚲
        </span>
      )}
      {isUnread && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', top: -3, right: -3,
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--color-brand)',
            border: '2px solid var(--color-surface-1)',
          }}
        />
      )}
      {replyCount > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', bottom: -6, right: -6,
            minWidth: 16, height: 16, padding: '0 3px', borderRadius: 8,
            background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)',
            fontSize: 9, fontWeight: 700, color: 'var(--color-ink-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {replyCount}
        </span>
      )}
    </button>
  );
}

export const CommentPin = memo(CommentPinImpl);

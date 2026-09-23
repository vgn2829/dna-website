import type { Board } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────
// BoardCard (V2.2) — extracted, unchanged, from MoodboardsPage.tsx, where
// it was a private local component. Now shared with ProjectDetailPage.tsx
// (V2.2 Phase 6) so the two board-grid surfaces render identically rather
// than duplicating this markup — per the V2.2 brief's own "prefer reusing
// existing board-card/list components where practical" instruction.
// Behavior-identical to its pre-extraction form: same props, same visual
// output, same favorite/menu affordances gated the same way.
// ─────────────────────────────────────────────────────────────────────────

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 0 : 2}>
      <path d="M12 2.5l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9-6.3 3.9 1.7-7-5.4-4.7 7.1-.6z" strokeLinejoin="round" />
    </svg>
  );
}

export function BoardCard({ board, onClick, onMenuOpen, onToggleFavorite, ownerRoll, favoriteBusy }: {
  board: Board;
  onClick: () => void;
  onMenuOpen?: (e: React.MouseEvent, board: Board) => void;
  onToggleFavorite?: (board: Board) => void;
  ownerRoll?: string | null;
  favoriteBusy?: boolean;
}) {
  const isOwner = ownerRoll === board.owner_roll;

  return (
    <div
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Open board ${board.name}`}
      className="board-card"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--color-surface-1)',
        cursor: 'pointer',
        transition: 'background 0.15s, transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--color-surface-2)';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--color-surface-1)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Cover placeholder — real thumbnails are a follow-up phase */}
      <div style={{
        width: '100%',
        aspectRatio: '16 / 9',
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 1,
        overflow: 'hidden',
        background: 'var(--color-surface-2)',
      }}>
        {[0.04, 0.06, 0.08, 0.10].map((alpha, i) => (
          <div key={i} style={{ background: `rgba(233,30,140,${alpha})` }} />
        ))}

        {onToggleFavorite && (
          <button
            onClick={e => { e.stopPropagation(); onToggleFavorite(board); }}
            disabled={favoriteBusy}
            title={board.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={board.is_favorite ? `Remove ${board.name} from favorites` : `Add ${board.name} to favorites`}
            aria-pressed={board.is_favorite}
            className="board-card-star"
            data-favorite={board.is_favorite}
            style={{
              position: 'absolute',
              top: 8, left: 8,
              width: 28, height: 28,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: board.is_favorite ? '#ffd54a' : '#fff',
              cursor: favoriteBusy ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
              opacity: board.is_favorite ? 1 : undefined,
            }}
          >
            <StarIcon filled={board.is_favorite} />
          </button>
        )}

        {onMenuOpen && isOwner && (
          <button
            onClick={e => { e.stopPropagation(); onMenuOpen(e, board); }}
            aria-label={`More options for ${board.name}`}
            aria-haspopup="menu"
            style={{
              position: 'absolute',
              top: 8, right: 8,
              width: 28, height: 28,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              zIndex: 2,
            }}
          >
            ⋮
          </button>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <h3 style={{
            margin: 0, fontSize: 15, fontWeight: 600,
            color: 'var(--color-ink)', fontFamily: 'var(--font-body)', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
          }}>
            {board.name}
          </h3>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 'var(--radius-pill)', flexShrink: 0, fontFamily: 'var(--font-body)',
            background: board.visibility === 'shared' ? 'rgba(233,30,140,0.1)' : 'rgba(128,128,128,0.1)',
            color: board.visibility === 'shared' ? 'var(--color-brand)' : 'var(--color-ink-muted)',
          }}>
            {board.visibility}
          </span>
        </div>
        {board.owner_name && (
          <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            by {board.owner_name}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          {board.item_count} item{board.item_count !== 1 ? 's' : ''}
          {board.member_count > 0 ? ` · ${board.member_count + 1} members` : ''}
          {' · '}edited {timeAgo(board.updated_at)}
        </p>
      </div>
    </div>
  );
}

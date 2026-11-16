import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import '../../styles/academy-moodboards.css';
import type { Board } from '../lib/api';
import { PREVIEW_ROOT_MARGIN, shouldLoadPreviewImages } from '../lib/boardPreview';
import { BoardPreview } from './BoardPreview';

// Shared preview card; open, favorite and menu are sibling native controls.

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

// Nearest ancestor that actually scrolls vertically, or null (= the
// viewport). Skips ancestors that are merely overflow-clipping (e.g. the
// horizontal "Recent" strip), whose clipping should still gate cards.
function verticalScrollRoot(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function BoardCard({ board, onClick, menuItems, onToggleFavorite, ownerRoll, favoriteBusy }: {
  board: Board;
  onClick: () => void;
  menuItems?: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; opensDialog?: boolean }[];
  onToggleFavorite?: (board: Board) => void;
  ownerRoll?: string | null;
  favoriteBusy?: boolean;
}) {
  const isOwner = ownerRoll === board.owner_roll;
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const openingDialogRef = useRef(false);

  // Viewport gating (V3.2.5): the card and its preview always render, but
  // preview IMAGES only load once the cover is within PREVIEW_ROOT_MARGIN
  // of the visible area — a long Moodboards list no longer fetches every
  // card's images up front. Latches on (never unloads after scrolling
  // away). Without IntersectionObserver, images load immediately as before.
  // The observer's root is the card's scrolling ancestor (this app scrolls
  // inside #root, not the window): with the implicit viewport root, that
  // ancestor would clip the card and rootMargin's lookahead would never
  // apply.
  const coverRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const observerSupported = typeof IntersectionObserver !== 'undefined';
  useEffect(() => {
    const el = coverRef.current;
    if (!observerSupported || nearViewport || !el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setNearViewport(true); io.disconnect(); }
    }, { root: verticalScrollRoot(el), rootMargin: PREVIEW_ROOT_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [observerSupported, nearViewport]);

  return (
    <div
      className="board-card"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        background: 'var(--color-surface-1)',
        position: 'relative',
        transition: 'background 0.15s, transform 0.15s, box-shadow 0.15s',
      }}
    >
      <button className="board-card-open" onClick={onClick} aria-label={`Open board ${board.name}`} />
      {/* Cover — a real preview of the board's content (BoardPreview, from
          the server-derived canvas_preview; no board document is loaded),
          or the original placeholder for a board with nothing to show. */}
      <div ref={coverRef} style={{
        width: '100%',
        aspectRatio: '16 / 9',
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 1,
        overflow: 'hidden',
        background: board.canvas_preview ? 'var(--color-canvas)' : 'var(--color-surface-2)',
      }}>
        {board.canvas_preview ? (
          <BoardPreview
            preview={board.canvas_preview}
            label={`Preview of ${board.name}`}
            thumbnails={board.preview_thumbnails}
            loadImages={shouldLoadPreviewImages(observerSupported, nearViewport)}
          />
        ) : (
          <>
            {[0.04, 0.06, 0.08, 0.10].map((alpha, i) => (
              <div key={i} style={{ background: `rgba(233,30,140,${alpha})` }} />
            ))}
            {board.item_count === 0 && (
              <span style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 500, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)',
              }}>
                Empty board
              </span>
            )}
          </>
        )}

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
              width: 44, height: 44,
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

        {menuItems && isOwner && (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger ref={menuTriggerRef} className="board-card-menu" aria-label={`More options for ${board.name}`} title="Board options">⋮</DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="dna-menu" align="end" sideOffset={6} collisionPadding={8} style={{ zIndex: 8001 }} onCloseAutoFocus={event => {
                // Dialogs own focus after selection; the menu must not steal
                // it back after the dialog's initial-focus frame.
                if (openingDialogRef.current) {
                  event.preventDefault();
                  openingDialogRef.current = false;
                }
              }} aria-label={`Options for ${board.name}`}>
                {menuItems.map(item => <DropdownMenu.Item key={item.label} className="dna-menu-item" data-danger={item.danger || undefined} disabled={item.disabled} onSelect={() => {
                  if (item.opensDialog) {
                    openingDialogRef.current = true;
                    // Let the existing modal hook record a persistent opener,
                    // rather than a menu item that is about to unmount.
                    menuTriggerRef.current?.focus({ preventScroll: true });
                  }
                  item.onSelect();
                }}>{item.label}</DropdownMenu.Item>)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <h3 className="type-body-sm" style={{
            margin: 0, color: 'var(--color-ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {board.name}
          </h3>
          <span className="type-micro" style={{
            textTransform: 'capitalize',
            padding: '2px 8px', borderRadius: 'var(--radius-pill)', flexShrink: 0,
            background: board.visibility === 'shared' ? 'rgba(233,30,140,0.1)' : 'rgba(128,128,128,0.1)',
            color: board.visibility === 'shared' ? 'var(--color-brand-text)' : 'var(--color-ink-muted)',
          }}>
            {board.visibility}
          </span>
        </div>
        {board.owner_name && (
          <p className="type-caption" style={{ margin: '0 0 6px' }}>
            by {board.owner_name}
          </p>
        )}
        {board.project_name && (
          <p className="type-caption" style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span aria-hidden="true" style={{ opacity: 0.7 }}>📁</span> {board.project_name}
          </p>
        )}
        <p className="type-caption" style={{ margin: 0 }}>
          {board.item_count} item{board.item_count !== 1 ? 's' : ''}
          {board.member_count > 0 ? ` · ${board.member_count + 1} members` : ''}
          {' · '}edited {timeAgo(board.updated_at)}
        </p>
      </div>
    </div>
  );
}

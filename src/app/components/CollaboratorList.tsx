import { useEffect, useRef, useState } from 'react';
import { stopEventPropagation, useBreakpoint, PORTRAIT_BREAKPOINT } from 'tldraw';
import { useCollaboratorIds } from './hooks/useCollaborators';
import { CollaboratorAvatar } from './CollaboratorAvatar';
import { useFollow } from './hooks/useFollow';
import { collaboratorCountLabel } from './hooks/presenceLabels';

// ─────────────────────────────────────────────────────────────────────────
// COLLABORATOR LIST (V2.5 Phase 1) — who else is on this board right now.
//
// MOUNTED VIA tldraw's `SharePanel` COMPONENT SLOT, not as a free-floating
// absolutely-positioned overlay. This matters and was a real bug before:
// the previous version pinned itself to `position:absolute; top:12;
// right:12`, which is exactly where tldraw renders its own style panel, so
// the avatars sat UNDERNEATH it and were half-hidden whenever a shape was
// selected (confirmed in two-client QA screenshots).
//
// SharePanel is tldraw's own, purpose-built slot for this: TldrawUi.js
// renders it inside `.tlui-layout__top__right` — a flex COLUMN — directly
// ABOVE StylePanel. Occupying it means the two lay out as siblings and can
// never overlap, with no z-index fight and no hardcoded offsets to keep in
// sync with tldraw's own spacing. It is also the slot tldraw itself fills
// with collaboration UI by default (DefaultSharePanel, gated on
// showCollaborationUi), so this is the sanctioned extension point rather
// than a workaround. See TldrawCanvasSync.tsx for the `components` object.
//
// PRESENCE DATA comes entirely from tldraw's own editor state via
// useCollaboratorIds (→ editor.getCollaboratorsOnCurrentPage()). There is
// no presence table, no REST polling, no second websocket and no parallel
// store — see useCollaborators.ts's own doc comment. Identity (name/color)
// rides in on @tldraw/sync's presence records, seeded by PresenceProvider.
//
// SCOPE: this component shows who is here. Following lives in useFollow
// (pre-existing) and is intentionally left as-is.
// ─────────────────────────────────────────────────────────────────────────

const MAX_VISIBLE_AVATARS = 4;

export function CollaboratorList() {
  const collaboratorIds = useCollaboratorIds();
  const { followingUserId, toggleFollow } = useFollow();
  const breakpoint = useBreakpoint();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tablet and below get the compact count button; desktop shows the
  // stacked avatar row. Reuses tldraw's OWN breakpoint (the same value it
  // uses to decide whether to render the style panel at all) rather than a
  // second, independently-drifting media query — the canvas and the
  // collaborator UI should change shape at the same width.
  const isCompact = breakpoint < PORTRAIT_BREAKPOINT.TABLET;

  // Close the popover on outside click / Escape. Only wired up while it's
  // actually open, so there are no idle global listeners on the canvas.
  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setPopoverOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popoverOpen]);

  // Collapse the popover if everyone leaves while it's open, so it can't
  // linger as an empty floating panel.
  useEffect(() => {
    if (collaboratorIds.length === 0 && popoverOpen) setPopoverOpen(false);
  }, [collaboratorIds.length, popoverOpen]);

  // No one else here — render nothing rather than a "1 person" chip that
  // would just be noise on a board you're editing alone. The current user
  // is deliberately NOT listed: tldraw's presence records cover OTHER
  // sessions, and your own identity is already shown by the board header.
  if (collaboratorIds.length === 0) return null;

  const count = collaboratorIds.length;
  const countLabel = collaboratorCountLabel(count);

  const visible = collaboratorIds.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = count - visible.length;

  return (
    <div
      ref={containerRef}
      // Mounted inside <Tldraw>'s own DOM tree — without this, a pointer
      // event here would fall through to the canvas underneath
      // (deselecting shapes, starting a drag/pan), the same reason
      // tldraw's own Watermark overlay uses this exact utility.
      onPointerDown={stopEventPropagation}
      style={{ position: 'relative', margin: 8, pointerEvents: 'all' }}
    >
      {isCompact ? (
        // ── Tablet / mobile: a single compact avatar+count button that
        // opens a small popover. Keeps the canvas clear at narrow widths,
        // which is the whole point of the compact mode.
        <button
          type="button"
          onClick={() => setPopoverOpen(o => !o)}
          aria-label={countLabel}
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          title={countLabel}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-pill)',
            padding: '4px 10px 4px 4px', cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 24, height: 24, borderRadius: 'var(--radius-full)',
              background: 'var(--color-brand)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: '#fff',
              fontFamily: 'var(--font-body)',
            }}
          >
            {count}
          </span>
          <span
            aria-hidden="true"
            style={{
              fontSize: 12, fontWeight: 600, color: 'var(--color-ink)',
              fontFamily: 'var(--font-body)',
            }}
          >
            here
          </span>
        </button>
      ) : (
        // ── Desktop: stacked avatars plus a visible count, so presence is
        // legible without hovering. The count is real text, not only a
        // colour/among-avatars cue (see the accessibility note below).
        <div
          role="group"
          aria-label={countLabel}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-pill)',
            padding: '4px 10px 4px 4px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {visible.map((userId, i) => (
              <CollaboratorAvatar
                key={userId}
                userId={userId}
                offset={i}
                isFollowing={followingUserId === userId}
                onToggleFollow={() => toggleFollow(userId)}
              />
            ))}
            {overflow > 0 && (
              <div
                aria-hidden="true"
                title={`${overflow} more`}
                style={{
                  width: 28, height: 28, borderRadius: 'var(--radius-full)',
                  background: 'var(--color-surface-2)',
                  border: '2px solid var(--color-surface-1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, color: 'var(--color-ink-muted)',
                  fontFamily: 'var(--font-body)', marginLeft: -8,
                }}
              >
                +{overflow}
              </div>
            )}
          </div>
          {/* Redundant-by-design text label: identity/among-ness must not be
              communicated by coloured circles alone. Screen readers get the
              full sentence from the group's aria-label above; this is the
              visible equivalent. */}
          <span
            style={{
              fontSize: 12, fontWeight: 600, color: 'var(--color-ink-muted)',
              fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
            }}
          >
            {count} here
          </span>
        </div>
      )}

      {isCompact && popoverOpen && (
        <div
          role="dialog"
          aria-label={countLabel}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            minWidth: 180, maxWidth: 240, zIndex: 500,
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md, 10px)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
            padding: 6,
            display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          {collaboratorIds.map(userId => (
            <CollaboratorAvatar
              key={userId}
              userId={userId}
              offset={0}
              isFollowing={followingUserId === userId}
              onToggleFollow={() => toggleFollow(userId)}
              variant="row"
            />
          ))}
        </div>
      )}
    </div>
  );
}

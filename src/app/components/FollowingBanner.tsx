import { DefaultHelperButtons, DefaultHelperButtonsContent } from 'tldraw';
import { useCollaboratorPresence } from './hooks/useCollaborators';
import { useFollow } from './hooks/useFollow';
import { collaboratorDisplayName } from './hooks/presenceLabels';

// ─────────────────────────────────────────────────────────────────────────
// FOLLOWING BANNER (V2.5 Phase 2) — names WHO is being followed.
//
// WHAT ALREADY EXISTED, and is deliberately NOT reimplemented here:
// tldraw 2.4.4 already ships the entire follow feature. editor
// .startFollowingUser/.stopFollowingUser do the camera work (per-frame
// animation, page-change following, auto-stop when the leader's presence
// disappears, breaking follow on manual pan/zoom, refusing a follow-loop),
// useFollow.ts already wraps them reactively, CollaboratorList/
// CollaboratorAvatar already call toggleFollow, and tldraw's own
// StopFollowing helper button already renders a working "Stop following"
// control plus the green viewport border whenever followingUserId is set.
// All of that is reused untouched — there is no second camera store, no
// viewport sync, no follow API, and no persisted follow state.
//
// THE ONE GAP this fills: tldraw's native control reads exactly
// "Stop following" — verified in the DOM to carry no aria-label, no title
// and no name — so it never says WHO you are following. With several
// collaborators on a board that is genuinely ambiguous, and the phase
// requires the UI to communicate who is being followed, not to rely on a
// visual (the green border) alone.
//
// This component therefore renders tldraw's OWN helper buttons unchanged
// (DefaultHelperButtonsContent, which includes StopFollowing) and adds a
// small labelled banner beside them. It derives its text from the SAME
// reactive sources everything else uses — useFollow's followingUserId and
// the collaborator's presence record — so there is no duplicated state
// that could drift from tldraw's.
//
// role="status" (not an alert): starting to follow someone is useful to
// announce but is not an interruption, so it is delivered politely.
// ─────────────────────────────────────────────────────────────────────────

function FollowingLabel() {
  const { followingUserId } = useFollow();
  // Hooks must run unconditionally; passing '' when not following yields
  // undefined presence and the component renders nothing below.
  const presence = useCollaboratorPresence(followingUserId ?? '');

  if (!followingUserId) return null;

  const name = collaboratorDisplayName(presence?.userName, followingUserId);
  const color = presence?.color ?? 'var(--color-brand)';

  return (
    <div
      role="status"
      aria-live="polite"
      // The text is the accessible content; the colour swatch is a
      // decorative reinforcement of it, never the sole carrier (same rule
      // the collaborator avatars follow — see presenceLabels.ts).
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-pill)',
        padding: '4px 10px',
        fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
        color: 'var(--color-ink)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        pointerEvents: 'none', whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8, height: 8, borderRadius: 'var(--radius-full)',
          background: color, flexShrink: 0,
        }}
      />
      Following {name}
    </div>
  );
}

// Slots into <Tldraw components={{ HelperButtons }}>. Wrapping
// DefaultHelperButtons/DefaultHelperButtonsContent (rather than replacing
// them) keeps tldraw's own ExitPenMode / BackToContent / StopFollowing
// buttons working exactly as shipped — this only adds a label alongside.
export function FollowingBanner() {
  return (
    <DefaultHelperButtons>
      <FollowingLabel />
      <DefaultHelperButtonsContent />
    </DefaultHelperButtons>
  );
}

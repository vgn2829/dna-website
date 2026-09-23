import type { CollaboratorActivityState } from './useCollaborators';

// ─────────────────────────────────────────────────────────────────────────
// Pure presentation helpers for the collaborator UI (V2.5 Phase 1).
//
// Extracted out of CollaboratorList/CollaboratorAvatar deliberately: these
// are the only pieces of Phase 1 with real branching logic (pluralisation,
// the display-name fallback chain, and turning an activity state into words
// rather than a colour), and they are pure string functions with no React,
// no editor and no tldraw imports — so they can be unit-tested directly.
//
// Everything else in this phase is either tldraw's own behavior (cursors,
// selections, presence records) or thin JSX over it, which the repository
// has no frontend test infrastructure to test meaningfully and which is
// verified by the two-client browser QA instead.
//
// ACCESSIBILITY NOTE: activityWord exists so a collaborator's state is
// always available as TEXT. The green activity dot and the avatar's colour
// are decorative reinforcements of that text, never the sole carrier of
// the information.
// ─────────────────────────────────────────────────────────────────────────

// @tldraw/sync seeds a presence record with this placeholder before the
// client's real userInfo has propagated; showing it would render a
// meaningless "New User" avatar for a moment on every join.
export const PLACEHOLDER_USER_NAME = 'New User';

// Display name for a collaborator, falling back to their userId (the
// student's roll number — see PresenceProvider.tsx) when the presence
// record has no usable name yet. Never returns an empty string, so the
// avatar always has an initial to render.
export function collaboratorDisplayName(
  userName: string | undefined,
  userId: string
): string {
  if (userName && userName !== PLACEHOLDER_USER_NAME && userName.trim() !== '') {
    return userName;
  }
  return userId;
}

// First character of the display name, for the avatar circle.
export function collaboratorInitial(displayName: string): string {
  return displayName[0]?.toUpperCase() ?? '?';
}

// The activity state as a word. Mirrors the three states
// useCollaboratorActivity derives from tldraw's OWN configured
// idle/inactive timeouts — this is a rendering of that state, not a
// second state machine with its own thresholds.
export function activityWord(activity: CollaboratorActivityState): string {
  switch (activity) {
    case 'active': return 'active';
    case 'idle': return 'idle';
    case 'inactive': return 'away';
  }
}

// Full accessible label for one collaborator's button.
export function collaboratorAriaLabel(
  displayName: string,
  activity: CollaboratorActivityState,
  isFollowing: boolean
): string {
  const state = activityWord(activity);
  return isFollowing
    ? `${displayName}, ${state}. Following — activate to stop following.`
    : `${displayName}, ${state}. Activate to follow.`;
}

// Accessible label for the list as a whole. Counts OTHER people: tldraw's
// presence records describe other sessions, and the current user is
// already identified elsewhere in the board chrome.
export function collaboratorCountLabel(count: number): string {
  return `${count} other ${count === 1 ? 'person' : 'people'} on this board`;
}

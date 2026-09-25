import { useCollaboratorActivity, useCollaboratorPresence } from './hooks/useCollaborators';
import {
  activityWord,
  collaboratorAriaLabel,
  collaboratorDisplayName,
  collaboratorInitial,
} from './hooks/presenceLabels';

// One collaborator's avatar in CollaboratorList — split into its own
// component (rather than inlined in the list's .map) specifically so each
// avatar's frequent presence updates (idle-state ticks, activity timestamp
// changes) only re-render THIS avatar, not the whole list or its siblings.
//
// Two shapes, same data and same accessible semantics:
//   'stack' (default) — a round avatar in the overlapping desktop row.
//   'row'             — avatar + name as a full-width item, used inside
//                       the compact popover where there is room to spell
//                       the name out rather than hide it behind a tooltip.
//
// ACCESSIBILITY: the button always carries an explicit aria-label naming
// the person and their state, because a coloured circle with one initial
// is not, by itself, an identification — the brief's "do not rely solely
// on colored dots or avatars" requirement. The activity dot is likewise
// mirrored in that label ("active"/"idle"/"away") rather than being a
// colour-only signal, and is aria-hidden so it isn't announced twice.
export function CollaboratorAvatar({
  userId,
  offset,
  isFollowing,
  onToggleFollow,
  variant = 'stack',
}: {
  userId: string;
  offset: number;
  isFollowing: boolean;
  onToggleFollow: () => void;
  variant?: 'stack' | 'row';
}) {
  const presence = useCollaboratorPresence(userId);
  const activity = useCollaboratorActivity(presence);

  // Membership (useCollaboratorIds) can be a tick ahead of presence detail
  // populating for a just-joined user — fall back to the userId rather than
  // rendering nothing, so the avatar slot doesn't flash empty/pop in.
  // See presenceLabels.ts for these (pure, unit-tested) helpers.
  const name = collaboratorDisplayName(presence?.userName, userId);
  const color = presence?.color ?? 'var(--color-ink-muted)';
  const initial = collaboratorInitial(name);
  const label = collaboratorAriaLabel(name, activity, isFollowing);

  const dot = activity === 'active' && (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute', bottom: -1, right: -1,
        width: 8, height: 8, borderRadius: 'var(--radius-full)',
        background: 'var(--color-success)',
        border: '1.5px solid var(--color-surface-1)',
      }}
    />
  );

  const circle = (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        width: 28, height: 28, borderRadius: 'var(--radius-full)',
        background: color,
        border: isFollowing ? '2px solid var(--color-brand)' : '2px solid var(--color-surface-1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: '#fff',
        fontFamily: 'var(--font-body)',
        flexShrink: 0,
      }}
    >
      {initial}
      {dot}
    </span>
  );

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={onToggleFollow}
        aria-label={label}
        aria-pressed={isFollowing}
        title={label}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '4px 6px',
          background: isFollowing ? 'var(--color-surface-2)' : 'transparent',
          border: 'none', borderRadius: 'var(--radius-sm, 6px)',
          cursor: 'pointer', textAlign: 'left',
          opacity: activity === 'inactive' ? 0.5 : 1,
        }}
      >
        {circle}
        <span
          style={{
            display: 'flex', flexDirection: 'column', minWidth: 0,
            fontFamily: 'var(--font-body)',
          }}
        >
          <span
            style={{
              fontSize: 12, fontWeight: 600, color: 'var(--color-ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          {/* The popover has room to spell the state out, so it does —
              the activity dot on the avatar is a reinforcement of this
              text, not the only way to read it. The follow affordance is
              named here too ("Follow" / "Following — tap to stop") rather
              than left implicit in the row's click handler, so the action
              is discoverable without hovering for a tooltip. */}
          <span style={{ fontSize: 10, color: 'var(--color-ink-muted)' }}>
            {isFollowing
              ? `${activityWord(activity)} · Following — tap to stop`
              : `${activityWord(activity)} · Follow`}
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggleFollow}
      aria-label={label}
      aria-pressed={isFollowing}
      title={label}
      style={{
        // The overlap that makes this read as a stacked avatar row. The
        // button itself is the hit target, so keyboard focus lands on a
        // real, visible element (no icon-only div with a click handler).
        marginLeft: offset === 0 ? 0 : -8,
        position: 'relative', zIndex: 10 - offset,
        display: 'flex', padding: 0, border: 'none', background: 'none',
        borderRadius: 'var(--radius-full)',
        cursor: 'pointer',
        opacity: activity === 'inactive' ? 0.4 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {circle}
    </button>
  );
}

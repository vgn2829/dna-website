import { useCollaboratorActivity, useCollaboratorPresence } from './hooks/useCollaborators';

// One collaborator's avatar in CollaboratorList — split into its own
// component (rather than inlined in the list's .map) specifically so each
// avatar's frequent presence updates (idle-state ticks, activity timestamp
// changes) only re-render THIS avatar, not the whole list or its siblings.
export function CollaboratorAvatar({
  userId,
  offset,
  isFollowing,
  onToggleFollow,
}: {
  userId: string;
  offset: number;
  isFollowing: boolean;
  onToggleFollow: () => void;
}) {
  const presence = useCollaboratorPresence(userId);
  const activity = useCollaboratorActivity(presence);

  // Membership (useCollaboratorIds) can be a tick ahead of presence detail
  // populating for a just-joined user — render a neutral placeholder rather
  // than nothing, so the avatar slot doesn't flash empty/pop in.
  const name = presence?.userName && presence.userName !== 'New User' ? presence.userName : userId;
  const color = presence?.color ?? 'var(--color-ink-muted)';
  const initial = name[0]?.toUpperCase() ?? '?';

  return (
    <button
      onClick={onToggleFollow}
      title={isFollowing ? `Following ${name} — click to stop` : `Follow ${name}`}
      style={{
        width: 28, height: 28, borderRadius: 'var(--radius-full)',
        background: color,
        border: isFollowing ? '2px solid var(--color-brand)' : '2px solid var(--color-surface-1)',
        marginLeft: offset === 0 ? 0 : -8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: '#fff',
        fontFamily: 'var(--font-body)',
        position: 'relative', zIndex: 10 - offset,
        cursor: 'pointer', padding: 0,
        opacity: activity === 'inactive' ? 0.4 : 1,
        transition: 'opacity 0.2s ease, border-color 0.15s ease',
      }}
    >
      {initial}
      {activity === 'active' && (
        <span style={{
          position: 'absolute', bottom: -1, right: -1,
          width: 8, height: 8, borderRadius: 'var(--radius-full)',
          background: 'var(--color-success)',
          border: '1.5px solid var(--color-surface-1)',
        }} />
      )}
    </button>
  );
}

import { stopEventPropagation } from 'tldraw';
import { useCollaboratorIds } from './hooks/useCollaborators';
import { CollaboratorAvatar } from './CollaboratorAvatar';
import { useFollow } from './hooks/useFollow';

// Mounted as a CHILD of <Tldraw> (see TldrawCanvasSync.tsx), the same way
// ClipboardOverride already is — both need useEditor(), which requires an
// EditorContext ancestor that only exists inside <Tldraw>. Visually it's
// still an overlay (position: absolute, top-right corner) rather than part
// of the document canvas itself. Reads live collaborator state via
// useCollaboratorIds (see that hook's own doc comment for why membership
// and per-user detail are split into separate, separately-reactive hooks).
export function CollaboratorList() {
  const collaboratorIds = useCollaboratorIds();
  const { followingUserId, toggleFollow } = useFollow();

  if (collaboratorIds.length === 0) return null;

  return (
    <div
      onPointerDown={stopEventPropagation}
      // Mounted inside <Tldraw>'s own DOM tree — without this, a click
      // here would fall through to the canvas underneath (deselecting
      // shapes, starting a drag/pan), the same reason tldraw's own
      // Watermark overlay uses this exact utility on its own click target.
      style={{
        position: 'absolute', top: 12, right: 12, zIndex: 400,
        display: 'flex', alignItems: 'center',
        background: 'var(--color-surface-1)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-pill)', padding: 4,
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      }}
    >
      {collaboratorIds.slice(0, 6).map((userId, i) => (
        <CollaboratorAvatar
          key={userId}
          userId={userId}
          offset={i}
          isFollowing={followingUserId === userId}
          onToggleFollow={() => toggleFollow(userId)}
        />
      ))}
      {collaboratorIds.length > 6 && (
        <div style={{
          width: 28, height: 28, borderRadius: 'var(--radius-full)',
          background: 'var(--color-surface-2)', border: '2px solid var(--color-surface-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: 'var(--color-ink-muted)',
          fontFamily: 'var(--font-body)', marginLeft: -8,
        }}>
          +{collaboratorIds.length - 6}
        </div>
      )}
    </div>
  );
}

import { useCallback } from 'react';
import { useEditor, useValue } from 'tldraw';

// Thin wrapper over editor.startFollowingUser/stopFollowingUser +
// editor.getInstanceState().followingUserId — tldraw already implements
// the actual viewport-following behavior (camera lock, breaking follow on
// manual pan/zoom, etc.) internally; this hook only exposes it as a
// reactive value + a single toggle callable from UI (see CollaboratorList).
export function useFollow(): {
  followingUserId: string | null;
  toggleFollow: (userId: string) => void;
} {
  const editor = useEditor();

  const followingUserId = useValue(
    'following-user-id',
    () => editor.getInstanceState().followingUserId,
    [editor]
  );

  const toggleFollow = useCallback((userId: string) => {
    if (editor.getInstanceState().followingUserId === userId) {
      editor.stopFollowingUser();
    } else {
      editor.startFollowingUser(userId);
    }
  }, [editor]);

  return { followingUserId, toggleFollow };
}

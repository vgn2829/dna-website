import { useEffect, useRef, useState } from 'react';
import { useComputed, useEditor, useValue, type Editor, type TLInstancePresence } from 'tldraw';

// Thin reactive wrapper over editor.getCollaborators() — the underlying
// data (cursor position, selection, color, name, idle state, per-page
// presence) is entirely provided by @tldraw/sync already; this hook exists
// only to subscribe a React component to it, since tldraw's own equivalent
// (usePeerIds) is marked @internal and not part of the public API surface.
//
// Mirrors usePeerIds's own approach deliberately: derive a coarse, rarely-
// changing list of userIds (with an isEqual check so the returned array
// reference is stable when membership hasn't actually changed) rather than
// returning the raw TLInstancePresence[] directly, which includes cursor
// coordinates that change on every mouse move — a naive "just subscribe to
// getCollaboratorsOnCurrentPage()" would re-render every consumer (e.g. a
// collaborator list showing names/colors) dozens of times a second for
// data it doesn't even display.
export function useCollaboratorIds(): string[] {
  const editor = useEditor();
  const $userIds = useComputed(
    'board-collaborator-ids',
    () => [...new Set(editor.getCollaboratorsOnCurrentPage().map(p => p.userId))].sort(),
    { isEqual: (a, b) => a.join(',') === b.join(',') },
    [editor]
  );
  return useValue($userIds);
}

// A single collaborator's live presence record, re-rendering only the
// component that actually asked for THIS user's data when it changes —
// not every consumer of useCollaboratorIds. Returns undefined if the user
// has disconnected (their presence record no longer exists) between the
// id list updating and this being read — callers should treat that as
// "no longer present" the same as the id simply not being in the list yet.
export function useCollaboratorPresence(userId: string): TLInstancePresence | undefined {
  const editor = useEditor();
  return useValue(
    `board-collaborator-presence-${userId}`,
    () => editor.getCollaboratorsOnCurrentPage().find(p => p.userId === userId),
    [editor, userId]
  );
}

export type CollaboratorActivityState = 'active' | 'idle' | 'inactive';

function getActivityState(editor: Editor, lastActivityTimestamp: number): CollaboratorActivityState {
  const elapsed = Date.now() - lastActivityTimestamp;
  if (elapsed > editor.options.collaboratorInactiveTimeoutMs) return 'inactive';
  if (elapsed > editor.options.collaboratorIdleTimeoutMs) return 'idle';
  return 'active';
}

// Deliberately mirrors tldraw's own internal useCollaboratorState (in
// LiveCollaborators.tsx, not exported) rather than inventing separate idle
// thresholds — a collaborator the list shows as "active" should be exactly
// the same set of users whose cursors tldraw is currently rendering, using
// editor.options' real configured values instead of guessed constants.
// Polls on editor.timers.setInterval (tldraw's own timer, coordinated with
// its render loop) rather than a raw setInterval, for the same reason
// TldrawCanvasSync avoids adding its own reconnect listeners elsewhere —
// reuse the platform's own scheduling instead of a parallel one.
export function useCollaboratorActivity(presence: TLInstancePresence | undefined): CollaboratorActivityState {
  const editor = useEditor();
  const lastActivityRef = useRef(presence?.lastActivityTimestamp ?? 0);
  const [state, setState] = useState<CollaboratorActivityState>(() =>
    getActivityState(editor, lastActivityRef.current)
  );

  if (presence) lastActivityRef.current = presence.lastActivityTimestamp;

  useEffect(() => {
    const interval = editor.timers.setInterval(() => {
      setState(getActivityState(editor, lastActivityRef.current));
    }, editor.options.collaboratorCheckIntervalMs);
    return () => clearInterval(interval);
  }, [editor]);

  return state;
}

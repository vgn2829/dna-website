import React, { createContext, useContext, useMemo } from 'react';
import type { TLSyncUserInfo } from '@tldraw/sync';
import { useStudent } from './StudentContext';
import { rollToColor } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────
// PresenceProvider — the ONLY thing this provider does is derive the
// TLSyncUserInfo (id/name/color) that identifies the current student to
// @tldraw/sync's presence system. It does not touch cursors, selections,
// collaborator lists, or following — those are either fully automatic
// (see TldrawCanvasSync.tsx's own doc comment on what useSync/<Tldraw>
// already do for free) or live in useCollaborators/useFollow, which need
// to run inside the mounted <Tldraw> editor's own context and so cannot be
// part of this provider.
//
// Deliberately a thin identity mapper, not a presence "system": userId is
// the student's roll number (stable across devices/sessions, matching
// TLSyncUserInfo.id's own contract — "should be the same across all
// devices and sessions"), name is their display name, and color reuses the
// exact same roll-number-hash formula BoardPage's member/owner avatars
// already use (rollToColor, extracted to lib/utils.ts specifically so this
// doesn't drift from those avatars — a student's cursor color should match
// their avatar color everywhere in the app).
//
// Anonymous/logged-out users get no presence identity — TldrawCanvasSync
// only renders the realtime path for boards a student can already access
// via a valid JWT (see BoardPage.tsx's useRealtimeSync gate and
// backend/src/realtime/roomAccess.ts's auth check), so an anonymous
// collaborator session is not a case this needs to support.
// ─────────────────────────────────────────────────────────────────────────

const PresenceContext = createContext<TLSyncUserInfo | null>(null);

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { studentSession } = useStudent();

  const userInfo = useMemo<TLSyncUserInfo | null>(() => {
    if (!studentSession) return null;
    return {
      id: studentSession.rollNumber,
      name: studentSession.name,
      color: rollToColor(studentSession.rollNumber),
    };
  }, [studentSession]);

  return (
    <PresenceContext.Provider value={userInfo}>
      {children}
    </PresenceContext.Provider>
  );
}

// Returns null when there's no signed-in student — callers (TldrawCanvasSync)
// only render the realtime path when a student session exists, so this is a
// defensive null rather than a case expected to occur in practice.
export function usePresenceUserInfo(): TLSyncUserInfo | null {
  return useContext(PresenceContext);
}

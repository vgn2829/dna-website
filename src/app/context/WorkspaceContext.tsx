import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, type Workspace } from '../lib/api';
import { useStudent } from './StudentContext';

// ─────────────────────────────────────────────────────────────────────────
// WorkspaceContext (V2.0 Phase 1) — the shell-global home for "which
// workspace is currently active," lifted out of MoodboardsPage.tsx's own
// local activeWorkspaceId/workspaces state (see that page's now-removed
// comment block on why it used to live there: it predates the shell and
// was the only page that needed workspace scoping). Every V2 page under
// the workspace shell (Home, Moodboards, Assets, Projects, Templates)
// reads/writes this instead of re-deriving its own copy.
//
// Deliberately narrow scope: this context owns workspace IDENTITY and
// NAVIGATION state only (which workspace is active, the list of
// workspaces the caller belongs to, switching, loading, refresh). It does
// NOT own board/asset/project data — those stay fetched per-page exactly
// as MoodboardsPage.tsx already does, now simply reading
// activeWorkspaceId from here instead of local state. Mixing data
// ownership in here would turn one page's workspace-switch into a
// forced refetch of every other page's data, which nothing about V2.0
// requires.
//
// Persistence: sessionStorage, NOT the URL and NOT localStorage.
//   - Not the URL: the pre-existing MoodboardsPage switcher never put
//     activeWorkspaceId in the URL (no ?workspace_id= query param, no
//     route segment) — switching workspaces was always in-memory-only
//     navigation. Introducing a URL dependency now would be a UX change
//     nothing in this phase asks for, and would complicate every
//     existing board-share-link/deep-link path for no benefit this
//     phase needs.
//   - Not localStorage: this codebase already has a real precedent for
//     "how long should a workspace-scoped selection last" —
//     MoodboardsPage's own board-list caching (dna_boards_mine:* etc.)
//     uses sessionStorage with a 5-minute TTL, not localStorage. A
//     workspace selection is the same kind of "current session's
//     browsing context," not a durable cross-device preference — a
//     stale selection from weeks ago silently reappearing on a shared
//     computer (localStorage) is worse than just defaulting back to
//     personal each new session.
//   - sessionStorage: survives a same-tab refresh (Phase requirement:
//     "do not break refresh behavior") but naturally resets on a new
//     tab/session, which matches the existing board-cache convention
//     exactly.
// ─────────────────────────────────────────────────────────────────────────

const ACTIVE_WORKSPACE_STORAGE_KEY = 'dna_active_workspace_id';

function readStoredWorkspaceId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredWorkspaceId(id: string | null): void {
  try {
    if (id === null) {
      sessionStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    } else {
      sessionStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id);
    }
  } catch {
    // sessionStorage full/unavailable — selection just won't survive a
    // refresh this session; not fatal, matches the existing board-cache
    // convention's own silent-fail behavior.
  }
}

interface WorkspaceContextValue {
  // null = "All Workspaces" (the pre-existing unscoped-across-my-own-
  // workspaces default) — a first-class selection, not a loading state.
  activeWorkspaceId: string | null;
  workspaces: Workspace[];
  loading: boolean;
  // The caller's personal workspace, if loaded — convenience accessor for
  // "Assets needs a concrete workspace even in All-Workspaces view" style
  // call sites (mirrors MoodboardsPage's pre-existing assetsWorkspaceId
  // fallback logic, now centralized here instead of recomputed per page).
  personalWorkspace: Workspace | null;
  switchWorkspace: (workspaceId: string | null) => void;
  refresh: () => Promise<void>;
  // Local, optimistic list mutations — mirrors the exact calls
  // MoodboardsPage's WorkspacesPanel/WorkspaceSettingsModal callbacks
  // already made against its own local `workspaces` state, now against
  // this shared copy instead.
  addWorkspaceLocal: (workspace: Workspace) => void;
  renameWorkspaceLocal: (workspaceId: string, name: string) => void;
  removeWorkspaceLocal: (workspaceId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { studentSession } = useStudent();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(() => readStoredWorkspaceId());

  // Guards against a stale response landing after the roll number has
  // already changed (logout/login as someone else mid-request) — same
  // cancelled-flag pattern StudentContext/AppDataContext already use.
  const requestIdRef = useRef(0);

  const fetchWorkspaces = useCallback(async () => {
    if (!studentSession?.rollNumber) {
      setWorkspaces([]);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const list = await api.workspaces.list(studentSession.rollNumber);
      if (requestIdRef.current !== requestId) return; // superseded by a newer call
      setWorkspaces(list);
    } catch {
      if (requestIdRef.current !== requestId) return;
      setWorkspaces([]);
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [studentSession?.rollNumber]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Graceful fallback: once the workspace list has loaded (or reloaded —
  // e.g. after leaving/deleting a workspace elsewhere), if the currently
  // selected activeWorkspaceId no longer appears in it — deleted, left,
  // access revoked, or simply a stale id left over from a previous
  // session's sessionStorage entry — fall back to the personal workspace
  // rather than continue holding an id whose content the caller may no
  // longer be authorized to see. Never falls back to "show everything
  // unscoped" as a way of dodging the stale id; personal workspace is
  // always a safe, always-owned destination. Skipped while the list is
  // still loading/empty on first mount, so a fresh page load doesn't
  // momentarily flash-reset a validly restored selection before the
  // fetch has even returned.
  useEffect(() => {
    if (loading) return;
    if (activeWorkspaceId === null) return;
    if (workspaces.length === 0) return; // nothing loaded yet (or signed out) — don't decide yet
    const stillValid = workspaces.some(w => w.id === activeWorkspaceId);
    if (stillValid) return;

    const personal = workspaces.find(w => w.is_personal) ?? null;
    setActiveWorkspaceIdState(personal?.id ?? null);
    writeStoredWorkspaceId(personal?.id ?? null);
  }, [loading, workspaces, activeWorkspaceId]);

  // Signing out (or switching students) must never leave a previous
  // session's workspace selection active for whoever's signed in next —
  // same reasoning as the fallback effect above, just for the "no
  // session at all" case, which the membership-check effect can't catch
  // on its own since `workspaces` simply goes empty rather than
  // "contains stale entries."
  useEffect(() => {
    if (!studentSession?.rollNumber) {
      setActiveWorkspaceIdState(null);
      writeStoredWorkspaceId(null);
    }
  }, [studentSession?.rollNumber]);

  const switchWorkspace = useCallback((workspaceId: string | null) => {
    setActiveWorkspaceIdState(workspaceId);
    writeStoredWorkspaceId(workspaceId);
  }, []);

  const refresh = useCallback(async () => {
    await fetchWorkspaces();
  }, [fetchWorkspaces]);

  const addWorkspaceLocal = useCallback((workspace: Workspace) => {
    setWorkspaces(prev => [...prev, workspace]);
  }, []);

  const renameWorkspaceLocal = useCallback((workspaceId: string, name: string) => {
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, name } : w));
  }, []);

  const removeWorkspaceLocal = useCallback((workspaceId: string) => {
    setWorkspaces(prev => prev.filter(w => w.id !== workspaceId));
    setActiveWorkspaceIdState(current => {
      if (current !== workspaceId) return current;
      writeStoredWorkspaceId(null);
      return null;
    });
  }, []);

  const personalWorkspace = workspaces.find(w => w.is_personal) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        activeWorkspaceId,
        workspaces,
        loading,
        personalWorkspace,
        switchWorkspace,
        refresh,
        addWorkspaceLocal,
        renameWorkspaceLocal,
        removeWorkspaceLocal,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}

import { useEffect, useSyncExternalStore } from 'react';
import { api, getStudentToken } from './api';

// ─────────────────────────────────────────────────────────────────────────
// The signed-in student's designer-profile IDENTITY (name + avatar), shared
// by the navbar account menu and anything else that wants to show "me".
//
// One module-level store rather than a provider: the navbar sits outside the
// workspace providers, and this is read-mostly data. ProfilePage publishes
// every change it makes (`publishMyProfile`), so the navbar updates the
// instant a photo or name is saved — no reload, no refetch.
//
// Only fields the owner already sees on /profile are kept. No roll, no email.
// ─────────────────────────────────────────────────────────────────────────

export interface MyProfileIdentity {
  /** 'idle' before the first fetch, 'none' when the student has no profile yet. */
  status: 'idle' | 'loading' | 'ready' | 'none' | 'error';
  roll: string | null;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const EMPTY: MyProfileIdentity = { status: 'idle', roll: null, handle: null, displayName: null, avatarUrl: null };
let state: MyProfileIdentity = EMPTY;
const listeners = new Set<() => void>();
let inflight: string | null = null;

function set(next: MyProfileIdentity) {
  state = next;
  listeners.forEach(l => l());
}

export function publishMyProfile(roll: string, p: { handle: string; displayName: string; avatarUrl: string | null } | null) {
  if (!p) { set({ ...EMPTY, status: 'none', roll }); return; }
  // Skip no-op publishes so ProfilePage's effect can't cause a render loop.
  if (state.status === 'ready' && state.roll === roll && state.handle === p.handle && state.displayName === p.displayName && state.avatarUrl === p.avatarUrl) return;
  set({ status: 'ready', roll, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl });
}

export function clearMyProfile() { inflight = null; set(EMPTY); }

async function load(roll: string) {
  if (inflight === roll) return;
  inflight = roll;
  set({ ...EMPTY, status: 'loading', roll });
  try {
    const me = await api.designers.me(roll);
    if (inflight !== roll) return;
    publishMyProfile(roll, me ? { handle: me.handle, displayName: me.displayName, avatarUrl: me.avatarUrl } : null);
  } catch {
    if (inflight === roll) set({ ...EMPTY, status: 'error', roll });
  }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

/** Subscribe to the signed-in student's profile identity; fetches it once per sign-in. */
export function useMyProfile(roll: string | null | undefined): MyProfileIdentity {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!roll) { if (state.roll) clearMyProfile(); return; }
    // Sessions that predate token auth have no JWT yet; /designers/me would 401.
    if (!getStudentToken()) return;
    if (state.roll !== roll || state.status === 'idle') void load(roll);
  }, [roll]);
  // A stale identity from a previous account must never render for a new one.
  return roll && s.roll === roll ? s : EMPTY;
}

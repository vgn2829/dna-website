import { TLSocketRoom, type RoomSnapshot } from '@tldraw/sync-core';
import type { TLRecord } from '@tldraw/tlschema';
import type { WebSocket } from 'ws';
import type { RoomPersistence } from './roomPersistence';
import { createRoomSocketGate } from './roomSocketGate';

// ─────────────────────────────────────────────────────────────────────────
// ROOM MANAGER — owns the lifecycle of in-memory TLSocketRoom instances.
// This is the reusable collaboration foundation, not a Moodboard-specific
// class: it is keyed by an opaque `roomId` string and knows nothing about
// boards, students, or HTTP. Today the only caller passes board.room_id as
// that key and a BoardCanvasPersistence as the persistence implementation,
// but nothing here assumes that — a future non-board room (e.g. a
// standalone collaborative doc) would reuse this same class with a
// different roomId source and a different RoomPersistence implementation.
//
// Session metadata (SessionMeta) is intentionally generic (`{ roll: string;
// role: RoomRole }` is the concrete type used today, passed in by the
// caller) rather than hardcoded here, for the same reason: presence
// (Phase 2) will want to attach user info to a session, comments/mentions
// will want to know who's connected — this class's job is room lifecycle,
// not deciding what metadata matters.
//
// WRITE ENFORCEMENT (Commit 7) — every session now carries a mutable
// `canWriteCanvas` flag (set at join() time, re-evaluated live by
// updateSessionWriteAccess()/disconnectSession()) that gates writes at
// the transport layer via roomSocketGate.ts — see that file's own header
// comment for the full mechanism and why this is the correct extension
// point given @tldraw/sync-core 2.4.4's real, verified API surface.
// RoomManager still does no authorization ITSELF (join()'s caller —
// connectionHandler.ts — is still the only place checkRoomAccess is
// consulted for the initial connect, per the single-authorization-hook
// design); RoomManager's new job is just holding the current decision per
// session and threading it into the gate, plus exposing
// updateSessionWriteAccess()/disconnectSession()/getSessionMetas() for a
// caller (the periodic re-check in connectionHandler.ts) that wants to
// update or act on that decision after the fact without tearing down and
// reconstructing the session.
// ─────────────────────────────────────────────────────────────────────────

interface ManagedSession<SessionMeta> {
  canWriteCanvas: boolean;
  // Stored here (not read back from TLSocketRoom, which has no public
  // accessor for a session's meta) so getSessionMetas() can hand it to
  // the periodic re-validator without RoomManager needing a new
  // TLSocketRoom API that doesn't exist.
  meta: SessionMeta;
  // When canWriteCanvas was last confirmed against the database, for the
  // per-push freshness check (V2.5 Phase 3 — see WRITE_DECISION_TTL_MS).
  writeCheckedAt: number;
  // De-duplicates concurrent re-checks: a burst of pushes must not each
  // fire their own query for the same session.
  inFlightRecheck?: Promise<boolean>;
}

// How stale a write authorization may be before a push forces a fresh
// database check (V2.5 Phase 3).
//
// THE BUG THIS CLOSES: before this, a push was authorized purely against
// ManagedSession.canWriteCanvas, a cached boolean refreshed ONLY by the
// 15s background re-validator (REVALIDATION_INTERVAL_MS). Revoking a
// user's board access therefore left them able to mutate the board for up
// to 15 seconds on their already-open socket. Reproduced directly over
// the wire against a real board: the push was accepted and persisted to
// Postgres. The periodic re-validator is still what eventually
// DISCONNECTS such a session; this is the per-mutation guard that makes
// the window between ticks safe.
//
// 1s is the balance point: it bounds worst-case stale write access to ~1s
// while costing at most ONE extra query per second per actively-drawing
// session (a drag emits many pushes per second and they share a single
// check, see inFlightRecheck). Idle sessions, cursor/presence traffic and
// connect/ping cost nothing — only pushes are ever re-checked, and only
// when the cached decision has aged past this.
export const WRITE_DECISION_TTL_MS = 1000;

interface ManagedRoom<SessionMeta> {
  room: TLSocketRoom<TLRecord, SessionMeta>;
  sessions: Map<string, ManagedSession<SessionMeta>>;
}

const PERSIST_DEBOUNCE_MS = 2000;

// Fired whenever a room's document actually changed — the ONLY thing
// version history (or any future consumer) learns from RoomManager about
// content. No snapshot, no diff, no "how much changed" — just "look, if
// you care." Deliberately mirrors TLSocketRoom's own onDataChange contract
// (`() => void`, no payload) rather than inventing a richer event: the
// consumer (VersionHistoryService) already has to call getCurrentSnapshot
// itself to decide anything, so a payload here would just be a stale copy
// nobody should trust over a fresh read anyway.
export type SnapshotChangedListener = (roomId: string) => void;

export class RoomManager<SessionMeta = void> {
  private rooms = new Map<string, ManagedRoom<SessionMeta>>();
  // Per-room in-flight creation promise — prevents two concurrent
  // connections to the same not-yet-loaded room from each loading the
  // snapshot and constructing a duplicate TLSocketRoom (a real race: two
  // browser tabs opening the same board at nearly the same instant).
  private creating = new Map<string, Promise<ManagedRoom<SessionMeta>>>();
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private snapshotChangedListeners = new Set<SnapshotChangedListener>();

  // `checkWriteAccess` is OPTIONAL and injected, not imported (V2.5
  // Phase 3). RoomManager stays authorization-agnostic exactly as its
  // header comment requires — it never learns what a role is, only asks
  // the composition root "may this session still write?" and caches the
  // answer for WRITE_DECISION_TTL_MS. Omitting it (as every existing test
  // and any non-board room does) simply disables the per-push re-check
  // and leaves the pre-existing cached-flag behaviour untouched.
  constructor(
    private persistence: RoomPersistence,
    private checkWriteAccess?: (roomId: string, meta: SessionMeta) => Promise<boolean>
  ) {}

  // Registered by the composition root (server.ts), not by RoomManager's
  // own constructor options — keeps this class usable with zero listeners
  // (every existing call site, and any future one that doesn't care about
  // history) while letting exactly one more (VersionHistoryService) attach
  // without RoomManager importing or knowing anything about versions,
  // checkpoints, or Postgres. Returns an unsubscribe function per the
  // standard listener-registration shape used elsewhere in this codebase.
  onSnapshotChanged(listener: SnapshotChangedListener): () => void {
    this.snapshotChangedListeners.add(listener);
    return () => this.snapshotChangedListeners.delete(listener);
  }

  private notifySnapshotChanged(roomId: string): void {
    for (const listener of this.snapshotChangedListeners) {
      try {
        listener(roomId);
      } catch (err) {
        // A listener throwing (e.g. VersionHistoryService's checkpoint
        // decision hitting an unexpected error) must never break the
        // room's own persistence or any other registered listener —
        // this notification is a side channel, not part of the critical
        // save path.
        console.error(`Realtime: snapshotChanged listener threw for room ${roomId}:`, err);
      }
    }
  }

  private async getOrCreateRoom(roomId: string): Promise<ManagedRoom<SessionMeta>> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const inFlight = this.creating.get(roomId);
    if (inFlight) return inFlight;

    const createPromise = (async (): Promise<ManagedRoom<SessionMeta>> => {
      const initialSnapshot = await this.persistence.load(roomId);
      const managed: ManagedRoom<SessionMeta> = {
        sessions: new Map(),
        room: new TLSocketRoom<TLRecord, SessionMeta>({
          initialSnapshot: initialSnapshot ?? undefined,
          onSessionRemoved: (_room, { sessionId, numSessionsRemaining }) => {
            managed.sessions.delete(sessionId);
            if (numSessionsRemaining === 0) {
              // Last participant left — persist immediately (not on the
              // debounce timer, which may not fire again for a room with no
              // one left to trigger onDataChange) and tear the room down so
              // memory doesn't accumulate for boards no one is actively
              // editing. A later connection re-creates the room fresh from
              // persistence via getOrCreateRoom above.
              void this.persistNow(roomId);
              this.teardownRoom(roomId);
            }
          },
          onDataChange: () => {
            this.schedulePersist(roomId);
            this.notifySnapshotChanged(roomId);
          },
        }),
      };
      this.rooms.set(roomId, managed);
      return managed;
    })();

    this.creating.set(roomId, createPromise);
    try {
      return await createPromise;
    } finally {
      this.creating.delete(roomId);
    }
  }

  private schedulePersist(roomId: string): void {
    const existingTimer = this.persistTimers.get(roomId);
    if (existingTimer) clearTimeout(existingTimer);
    this.persistTimers.set(roomId, setTimeout(() => {
      this.persistTimers.delete(roomId);
      void this.persistNow(roomId);
    }, PERSIST_DEBOUNCE_MS));
  }

  private async persistNow(roomId: string): Promise<void> {
    const managed = this.rooms.get(roomId);
    if (!managed) return;
    try {
      const snapshot = managed.room.getCurrentSnapshot();
      await this.persistence.save(roomId, snapshot);
    } catch (err) {
      // A failed persist must not crash the room or drop connections —
      // the in-memory room is still the live source of truth for connected
      // clients; the next onDataChange (or the next participant leaving)
      // retries the save. Matches the manual-save path's own philosophy
      // (BoardPage's save-status banner): a persistence failure is
      // recoverable, not fatal to the session.
      console.error(`Realtime: failed to persist room ${roomId}:`, err);
    }
  }

  private teardownRoom(roomId: string): void {
    const timer = this.persistTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(roomId);
    }
    const managed = this.rooms.get(roomId);
    if (managed) {
      managed.room.close();
      this.rooms.delete(roomId);
    }
  }

  // Called by the WS upgrade handler once checkRoomAccess has already
  // authorized the connection — this method does no authorization itself,
  // per the single-authorization-hook design (see roomAccess.ts). `meta` is
  // opaque session data the caller wants attached to this connection.
  //
  // `canWriteCanvas` is the initial write-permission decision for this
  // session (Commit 7) — computed by the caller from roomAccess.ts's role
  // (roleCanWriteCanvas), not derived here, so RoomManager stays
  // authorization-agnostic exactly as its own doc comment requires. Stored
  // per-session (ManagedSession) so revalidateSession() can update it
  // later without needing a new socket/connection.
  async join(roomId: string, sessionId: string, socket: WebSocket, meta: SessionMeta, canWriteCanvas: boolean): Promise<void> {
    const managed = await this.getOrCreateRoom(roomId);
    // writeCheckedAt starts at "now" because canWriteCanvas was just
    // computed from a live checkRoomAccess in connectionHandler — the
    // decision is genuinely fresh at join time.
    managed.sessions.set(sessionId, { canWriteCanvas, meta, writeCheckedAt: Date.now() });

    // TLSocketRoom tracks its own session count internally (see
    // getActiveSessionCount below) and is what drives onSessionRemoved's
    // numSessionsRemaining — a closed socket moves its session to a pending
    // "awaiting removal" state immediately, but actual removal is delayed
    // ~10s (checked by an internal 2s poll), so a session isn't torn down
    // instantly, smoothing over brief reconnects/network hiccups. No
    // separate counter needed here.
    //
    // The cast below is a type-level workaround, not a runtime one:
    // handleSocketConnect's parameter type is OmitVoid<{ meta, sessionId,
    // socket }>, which conditionally drops `meta` from the required shape
    // when SessionMeta=void (so RoomManager<void> callers don't need to
    // pass meta: undefined). TS can't resolve that void-check against an
    // unresolved generic SessionMeta inside this class body, so it
    // (incorrectly, for any concrete SessionMeta) rejects a literal
    // containing `meta`. The object we build is exactly this method's own
    // `meta: SessionMeta` parameter — never actually `void` here — so this
    // asserts the shape TLSocketRoom's own overload guarantees for a
    // non-void SessionMeta, without weakening handleSocketConnect's
    // signature or reaching for `any`.
    //
    // The socket passed to TLSocketRoom is NOT the raw `socket` param —
    // it's wrapped by createRoomSocketGate, which reads
    // managed.sessions.get(sessionId).canWriteCanvas fresh on every
    // incoming message (not just at connect time), so a later
    // revalidateSession() call takes effect immediately on the next
    // message, with no need to reconnect or reconstruct anything. See
    // roomSocketGate.ts's own header comment for the full mechanism.
    const gatedSocket = createRoomSocketGate(socket, {
      canWriteCanvas: () => managed.sessions.get(sessionId)?.canWriteCanvas ?? false,
      // Per-push freshness guard (V2.5 Phase 3) — only installed when the
      // composition root supplied a checker. See WRITE_DECISION_TTL_MS for
      // the vulnerability this closes and why 1s.
      ...(this.checkWriteAccess
        ? { revalidateWrite: () => this.revalidateWriteAccess(roomId, sessionId) }
        : {}),
      onWriteRejected: () => {
        console.warn(`Realtime: dropped an unauthorized write from session ${sessionId} in room ${roomId}`);
      },
    });

    managed.room.handleSocketConnect(
      { sessionId, socket: gatedSocket, meta } as Parameters<typeof managed.room.handleSocketConnect>[0]
    );
  }

  // Confirms a session may STILL write, re-querying current board access
  // when the cached decision has aged past WRITE_DECISION_TTL_MS (V2.5
  // Phase 3). Called from the room socket gate on a push, never on
  // cursor/presence traffic, connect or ping.
  //
  // Three things keep this cheap:
  //   - TTL: a decision younger than WRITE_DECISION_TTL_MS is reused
  //     outright, so a fast drag (many pushes/second) costs at most one
  //     query per second.
  //   - inFlightRecheck: concurrent pushes share the SAME promise rather
  //     than each firing their own query.
  //   - It only runs for sessions the cached flag already allows — a
  //     session already known to be read-only is rejected by the gate's
  //     own fast path before reaching here.
  //
  // Fails CLOSED: a throw propagates to the gate, which treats it as a
  // denial. A transient DB error must never become an implicit grant.
  private async revalidateWriteAccess(roomId: string, sessionId: string): Promise<boolean> {
    const session = this.rooms.get(roomId)?.sessions.get(sessionId);
    if (!session) return false;
    if (!this.checkWriteAccess) return session.canWriteCanvas;

    if (Date.now() - session.writeCheckedAt < WRITE_DECISION_TTL_MS) {
      return session.canWriteCanvas;
    }
    if (session.inFlightRecheck) return session.inFlightRecheck;

    const check = (async (): Promise<boolean> => {
      try {
        const allowed = await this.checkWriteAccess!(roomId, session.meta);
        // Write the result back into the same field the periodic
        // re-validator and the gate's fast path both read, so there is
        // exactly one source of truth per session, not two caches.
        session.canWriteCanvas = allowed;
        session.writeCheckedAt = Date.now();
        return allowed;
      } finally {
        session.inFlightRecheck = undefined;
      }
    })();

    session.inFlightRecheck = check;
    return check;
  }

  // Updates an already-connected session's write permission without
  // touching its socket/connection — used by connectionHandler.ts's
  // periodic re-validation (Commit 7's answer to "permission changes
  // live" / "board archived while connected" / "board deleted while
  // connected"). Returns false if the session is no longer known (already
  // disconnected), so the caller can stop tracking it.
  updateSessionWriteAccess(roomId: string, sessionId: string, canWriteCanvas: boolean): boolean {
    const session = this.rooms.get(roomId)?.sessions.get(sessionId);
    if (!session) return false;
    session.canWriteCanvas = canWriteCanvas;
    // The periodic re-validator just confirmed this against the database,
    // so it refreshes the TTL too — otherwise a push arriving moments
    // later would redundantly re-query what was just checked.
    session.writeCheckedAt = Date.now();
    return true;
  }

  // Forcibly disconnects one session — used by the same periodic
  // re-validation when access has been fully revoked (not just
  // downgraded to read-only), e.g. removed as a board member on a
  // private board, or the board was deleted. Reuses TLSocketRoom's own
  // documented public close path (the same one a client disconnect goes
  // through), not a custom teardown.
  disconnectSession(roomId: string, sessionId: string): void {
    this.rooms.get(roomId)?.room.handleSocketError(sessionId);
  }

  // All currently-known session ids for a room, paired with their
  // SessionMeta — used by the periodic re-validator to know who to
  // re-check without RoomManager itself needing to know what "re-check"
  // means (that logic stays in connectionHandler.ts / roomAccess.ts).
  // Reads from RoomManager's own tracked ManagedSession (set at join()
  // time), not from TLSocketRoom — TLSocketRoom has no public accessor
  // for a session's meta after handleSocketConnect.
  getSessionMetas(roomId: string): Array<{ sessionId: string; meta: SessionMeta }> {
    const managed = this.rooms.get(roomId);
    if (!managed) return [];
    return Array.from(managed.sessions.entries()).map(([sessionId, session]) => ({
      sessionId, meta: session.meta,
    }));
  }

  // Diagnostic/ops accessor — how many rooms are currently live in memory.
  // Not read anywhere yet; exists so a future /api/internal health check
  // can assert "no orphaned rooms" without reaching into private state.
  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  getActiveSessionCount(roomId: string): number {
    return this.rooms.get(roomId)?.room.getNumActiveSessions() ?? 0;
  }

  // Every currently-loaded room's id — used by connectionHandler.ts's
  // periodic re-validator (Commit 7) to know which rooms have sessions
  // worth re-checking, without maintaining a separate parallel list of
  // "active" rooms itself. A room with zero sessions is already torn down
  // by onSessionRemoved (see getOrCreateRoom), so every id returned here
  // genuinely has at least one connected session.
  getActiveRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  // Read-only peek at a room's CURRENT live content, for a caller (checkpoint
  // decision logic) that needs to inspect it — never mutates anything. Returns
  // null if the room isn't currently loaded in memory (no one has connected
  // to it since the last server restart/teardown); callers that need the
  // latest persisted state regardless of whether a room is live should read
  // through RoomPersistence.load(roomId) instead, which is exactly what
  // VersionHistoryService does for its non-realtime checkpoint triggers
  // (rename, archive) — see history/versionHistoryService.ts.
  getCurrentSnapshot(roomId: string): RoomSnapshot | null {
    return this.rooms.get(roomId)?.room.getCurrentSnapshot() ?? null;
  }

  // Hot-swaps a LIVE room's content — this is the one operation RestoreService
  // needs from RoomManager that isn't already exposed, and it belongs here
  // (not in RestoreService directly) because only RoomManager holds the
  // TLSocketRoom instances. Returns false (does nothing) if the room isn't
  // currently loaded — RestoreService's caller (the restore REST endpoint)
  // handles that case by writing directly through RoomPersistence instead;
  // there's no live room to disconnect in the first place, so "no reconnect
  // storm" is trivially true when nobody's connected.
  //
  // IMPORTANT, verified against @tldraw/sync-core's own source (not assumed):
  // TLSocketRoom.loadSnapshot() closes every currently-connected session's
  // socket and constructs a brand-new internal TLSyncRoom — it does not
  // hot-swap content while keeping sessions attached, because there is no
  // other API for this in the installed version. Each connected client's own
  // ReconnectManager (already verified automatic for network drops/server
  // restarts in Commit 3/4's manual QA) detects the close and reconnects
  // within seconds, re-syncing to the restored content through the exact
  // same path getOrCreateRoom uses for any other fresh connection. This is
  // one clean, coordinated reconnect cycle caused deliberately by a real
  // content change — not a "storm," and not something this method or
  // RestoreService adds custom protocol code to avoid; it reuses the
  // reconnect machinery already proven safe elsewhere in this codebase.
  //
  // loadSnapshot does NOT trigger onDataChange (confirmed by reading
  // TLSocketRoom.js — that callback only fires from the constructor's
  // initial-clock check and from handleSocketMessage, never from
  // loadSnapshot), so persistence must be triggered explicitly here rather
  // than relying on the normal onDataChange → schedulePersist path, or a
  // restored board would silently revert to its pre-restore state on the
  // next server restart.
  restoreSnapshot(roomId: string, snapshot: RoomSnapshot): boolean {
    const managed = this.rooms.get(roomId);
    if (!managed) return false;
    managed.room.loadSnapshot(snapshot);
    void this.persistNow(roomId);
    return true;
  }

  // Server-restart handling: deliberately a no-op to define, not a gap.
  // Rooms are pure in-memory projections that always rehydrate from
  // `persistence.load()` on first connection after a restart — there is no
  // separate "recover rooms on boot" step because there is no state that
  // exists only in memory and nowhere else (every onDataChange either has
  // already been persisted or is about to be, and losing an un-persisted
  // few seconds of edits on a hard crash is the same durability window the
  // manual-save path already accepts with its 3s debounce).
}

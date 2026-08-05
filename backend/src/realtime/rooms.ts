import { TLSocketRoom } from '@tldraw/sync-core';
import type { TLRecord } from '@tldraw/tlschema';
import type { WebSocket } from 'ws';
import type { RoomPersistence } from './roomPersistence';

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
// ─────────────────────────────────────────────────────────────────────────

interface ManagedRoom<SessionMeta> {
  room: TLSocketRoom<TLRecord, SessionMeta>;
}

const PERSIST_DEBOUNCE_MS = 2000;

export class RoomManager<SessionMeta = void> {
  private rooms = new Map<string, ManagedRoom<SessionMeta>>();
  // Per-room in-flight creation promise — prevents two concurrent
  // connections to the same not-yet-loaded room from each loading the
  // snapshot and constructing a duplicate TLSocketRoom (a real race: two
  // browser tabs opening the same board at nearly the same instant).
  private creating = new Map<string, Promise<ManagedRoom<SessionMeta>>>();
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private persistence: RoomPersistence) {}

  private async getOrCreateRoom(roomId: string): Promise<ManagedRoom<SessionMeta>> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const inFlight = this.creating.get(roomId);
    if (inFlight) return inFlight;

    const createPromise = (async (): Promise<ManagedRoom<SessionMeta>> => {
      const initialSnapshot = await this.persistence.load(roomId);
      const room = new TLSocketRoom<TLRecord, SessionMeta>({
        initialSnapshot: initialSnapshot ?? undefined,
        onSessionRemoved: (_room, { numSessionsRemaining }) => {
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
        },
      });
      const managed: ManagedRoom<SessionMeta> = { room };
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
  async join(roomId: string, sessionId: string, socket: WebSocket, meta: SessionMeta): Promise<void> {
    const managed = await this.getOrCreateRoom(roomId);
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
    managed.room.handleSocketConnect(
      { sessionId, socket, meta } as Parameters<typeof managed.room.handleSocketConnect>[0]
    );
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

  // Server-restart handling: deliberately a no-op to define, not a gap.
  // Rooms are pure in-memory projections that always rehydrate from
  // `persistence.load()` on first connection after a restart — there is no
  // separate "recover rooms on boot" step because there is no state that
  // exists only in memory and nowhere else (every onDataChange either has
  // already been persisted or is about to be, and losing an un-persisted
  // few seconds of edits on a hard crash is the same durability window the
  // manual-save path already accepts with its 3s debounce).
}

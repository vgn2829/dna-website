import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RoomSnapshot } from '@tldraw/sync-core';
import { RoomManager } from '../src/realtime/rooms';
import type { RoomPersistence } from '../src/realtime/roomPersistence';

// Deliberately does NOT import ../src/db/client or anything that reaches a
// real database — RoomManager depends only on the RoomPersistence
// interface, so its lifecycle (join, teardown, persistence timing) is fully
// verifiable with an in-memory fake. This is the concrete benefit of
// keeping persistence behind an interface rather than RoomManager talking
// to Postgres directly (see roomPersistence.ts's own doc comment).
class FakePersistence implements RoomPersistence {
  public snapshots = new Map<string, RoomSnapshot>();
  public loadCalls = 0;
  public saveCalls = 0;

  async load(roomId: string): Promise<RoomSnapshot | null> {
    this.loadCalls++;
    return this.snapshots.get(roomId) ?? null;
  }

  async save(roomId: string, snapshot: RoomSnapshot): Promise<void> {
    this.saveCalls++;
    this.snapshots.set(roomId, snapshot);
  }
}

// Minimal WebSocketMinimal-compatible fake — TLSocketRoom only ever calls
// send/close/addEventListener/removeEventListener on what we hand it via
// handleSocketConnect, so a real network socket isn't needed to exercise
// real TLSocketRoom (from the real, installed @tldraw/sync-core) end to end.
class FakeSocket {
  // Mirrors ws.WebSocket's readyState numbers — TLSyncRoom's pruneSessions
  // reads `socket.isOpen`, which (in the real ServerSocketAdapter) is
  // `ws.readyState === 1`. A fake that only emits a 'close' event without
  // actually flipping readyState would make pruneSessions think the socket
  // is still open forever, silently defeating any test that relies on
  // teardown-after-disconnect.
  readyState: 0 | 1 | 2 | 3 = 1; // OPEN
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: any) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3; // CLOSED
    this.emit('close', {});
  }
  addEventListener(type: string, listener: (event: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: any): void {
    this.listeners.get(type)?.forEach(l => l(event));
  }
}

describe('RoomManager', () => {
  let managers: RoomManager<{ roll: string }>[] = [];

  afterEach(() => {
    managers = [];
    vi.useRealTimers();
  });

  it('creates a room on first join and loads its initial snapshot from persistence', async () => {
    const persistence = new FakePersistence();
    const manager = new RoomManager<{ roll: string }>(persistence);
    managers.push(manager);

    expect(manager.getActiveRoomCount()).toBe(0);

    const socket = new FakeSocket();
    await manager.join('room-1', 'session-1', socket as any, { roll: 'STUDENT1' });

    expect(manager.getActiveRoomCount()).toBe(1);
    expect(persistence.loadCalls).toBe(1);
    expect(manager.getActiveSessionCount('room-1')).toBe(1);
  });

  it('does not create a second room for two concurrent joins to the same roomId (no race)', async () => {
    const persistence = new FakePersistence();
    const manager = new RoomManager<{ roll: string }>(persistence);
    managers.push(manager);

    const socketA = new FakeSocket();
    const socketB = new FakeSocket();

    // Fire both "joins" concurrently, the way two browser tabs opening the
    // same board at nearly the same instant would — this is the exact race
    // getOrCreateRoom's in-flight promise cache exists to prevent.
    await Promise.all([
      manager.join('room-2', 'session-a', socketA as any, { roll: 'STUDENT1' }),
      manager.join('room-2', 'session-b', socketB as any, { roll: 'STUDENT2' }),
    ]);

    expect(manager.getActiveRoomCount()).toBe(1);
    expect(persistence.loadCalls).toBe(1);
    expect(manager.getActiveSessionCount('room-2')).toBe(2);
  });

  it('creates independent rooms for different roomIds', async () => {
    const persistence = new FakePersistence();
    const manager = new RoomManager<{ roll: string }>(persistence);
    managers.push(manager);

    await manager.join('room-3', 'session-1', new FakeSocket() as any, { roll: 'STUDENT1' });
    await manager.join('room-4', 'session-1', new FakeSocket() as any, { roll: 'STUDENT1' });

    expect(manager.getActiveRoomCount()).toBe(2);
  });

  it('persists and tears the room down after the last session disconnects', async () => {
    vi.useFakeTimers();
    const persistence = new FakePersistence();
    const manager = new RoomManager<{ roll: string }>(persistence);
    managers.push(manager);

    const socket = new FakeSocket();
    await manager.join('room-5', 'session-1', socket as any, { roll: 'STUDENT1' });
    expect(manager.getActiveRoomCount()).toBe(1);

    // Simulate the socket disconnecting. The close event moves the session
    // to AwaitingRemoval immediately (TLSyncRoom.cancelSession), but actual
    // removal only happens once pruneSessions (polling every 2s) sees that
    // SESSION_REMOVAL_WAIT_TIME (10s) has elapsed since cancellation — this
    // grace period is what lets a brief network blip/reconnect resume the
    // same session instead of being torn down. Advancing fake timers past
    // that 10s window is what actually triggers onSessionRemoved.
    socket.close();
    await vi.advanceTimersByTimeAsync(12000); // past SESSION_REMOVAL_WAIT_TIME (10s: close -> AwaitingRemoval -> pruneSessions removes it)

    expect(manager.getActiveRoomCount()).toBe(0);
    expect(persistence.saveCalls).toBeGreaterThanOrEqual(1);
    expect(persistence.snapshots.has('room-5')).toBe(true);
  });

  it('re-creates a room from its persisted snapshot after being torn down (server-restart-equivalent recovery)', async () => {
    vi.useFakeTimers();
    const persistence = new FakePersistence();
    const manager = new RoomManager<{ roll: string }>(persistence);
    managers.push(manager);

    const socket1 = new FakeSocket();
    await manager.join('room-6', 'session-1', socket1 as any, { roll: 'STUDENT1' });
    socket1.close();
    await vi.advanceTimersByTimeAsync(12000); // past SESSION_REMOVAL_WAIT_TIME (10s: close -> AwaitingRemoval -> pruneSessions removes it)
    expect(manager.getActiveRoomCount()).toBe(0);
    expect(persistence.loadCalls).toBe(1);

    // A later connection (simulating a fresh server process, since rooms
    // are pure in-memory projections — see RoomManager's own doc comment on
    // why there's no separate "recover on boot" step) must load from
    // persistence again rather than silently starting empty.
    const socket2 = new FakeSocket();
    await manager.join('room-6', 'session-2', socket2 as any, { roll: 'STUDENT2' });
    expect(manager.getActiveRoomCount()).toBe(1);
    expect(persistence.loadCalls).toBe(2);
  });

  it('does not tear the room down immediately when one of several sessions closes', async () => {
    // NOTE on scope: this deliberately does NOT simulate a real tldraw
    // client fully reaching TLSyncRoom's "Connected" state — that requires
    // sending a real `{ type: 'connect', protocolVersion, schema,
    // lastServerClock, connectRequestId }` wire message, whose exact shape
    // is intentionally excluded from @tldraw/sync-core's public types
    // (verified: getTlsyncProtocolVersion/createTLSchema are both marked
    // "Excluded from this release type" in the installed .d.ts). Hand-
    // constructing that message here would mean depending on tldraw's
    // private wire protocol from a test — exactly the "reimplementing sync
    // internals" this architecture was chosen to avoid (see roomAccess.ts's
    // own doc comment on the same principle). A socket that never sends a
    // connect message stays in AwaitingConnectMessage and is pruned by its
    // OWN ~10s handshake timeout regardless of what other sessions do,
    // which would make a fake "second session stays alive" assertion here
    // pass for the wrong reason once time is advanced that far.
    //
    // What this test verifies instead, honestly: closing one of two
    // sessions must not tear the room down SYNCHRONOUSLY / immediately —
    // RoomManager's teardown is driven only by TLSocketRoom's own
    // onSessionRemoved callback, never by RoomManager counting sockets
    // itself, so a close() alone (before any pruning has had a chance to
    // run) must never be observed as an immediate teardown. The full
    // multi-session-survives-a-partial-disconnect guarantee is exercised
    // end-to-end in manual QA (see the Commit 2 rollout notes) against a
    // real @tldraw/sync client, which is the only thing that can correctly
    // speak this protocol.
    const persistence = new FakePersistence();
    const manager = new RoomManager<{ roll: string }>(persistence);
    managers.push(manager);

    const socketA = new FakeSocket();
    const socketB = new FakeSocket();
    await manager.join('room-7', 'session-a', socketA as any, { roll: 'STUDENT1' });
    await manager.join('room-7', 'session-b', socketB as any, { roll: 'STUDENT2' });
    expect(manager.getActiveRoomCount()).toBe(1);

    socketA.close();

    // No time advanced — pruneSessions hasn't run yet, so nothing has been
    // removed. The room must still exist immediately after a close().
    expect(manager.getActiveRoomCount()).toBe(1);
  });
});

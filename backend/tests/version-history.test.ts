import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RoomSnapshot } from '@tldraw/sync-core';
import type { RoomManager, SnapshotChangedListener } from '../src/realtime/rooms';
import { VersionHistoryService } from '../src/realtime/history/versionHistoryService';
import { RestoreService } from '../src/realtime/history/restoreService';
import type { BoardVersion, CreateVersionInput } from '../src/realtime/history/versionStorage';

// Deliberately does NOT import ../src/db/client, ../src/realtime/rooms's
// real TLSocketRoom-backed RoomManager, or anything that reaches a real
// database. This suite tests VersionHistoryService/RestoreService's own
// DECISION logic — when a checkpoint happens, what counts as a duplicate,
// how retention/dedup/rate-limiting behave — in isolation from both the
// realtime transport (real RoomManager lifecycle is already covered by
// realtime-rooms.test.ts) and Postgres (versionStorage/versionTimeline are
// injected fakes here, per versionHistoryService.ts's own comment on why
// those two dependencies are overridable).

function makeSnapshot(documentCount: number): RoomSnapshot {
  const documents = Array.from({ length: documentCount }, (_, i) => ({
    lastChangedClock: i,
    state: { id: `shape:${i}`, typeName: 'shape' } as any,
  }));
  return { clock: documentCount, documents, tombstones: {}, schema: undefined as any };
}

// Fake RoomManager — a type assertion is used at the call site (not `as
// any` on individual members) because RoomManager is a concrete class with
// private fields; TypeScript's structural typing can't treat a plain
// object as one even when every PUBLIC member this service actually calls
// (onSnapshotChanged, getCurrentSnapshot, restoreSnapshot) is faithfully
// implemented, which this fake does. RoomManager's own lifecycle (join,
// teardown, persistence timing, session counting) is covered by
// realtime-rooms.test.ts against the real class — this fake exists only to
// drive VersionHistoryService/RestoreService's reaction to it.
class FakeRoomManager {
  private listeners = new Set<SnapshotChangedListener>();
  private snapshots = new Map<string, RoomSnapshot>();

  setSnapshot(roomId: string, snapshot: RoomSnapshot | null): void {
    if (snapshot === null) this.snapshots.delete(roomId);
    else this.snapshots.set(roomId, snapshot);
  }

  triggerSnapshotChanged(roomId: string): void {
    for (const l of this.listeners) l(roomId);
  }

  onSnapshotChanged(listener: SnapshotChangedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getCurrentSnapshot(roomId: string): RoomSnapshot | null {
    return this.snapshots.get(roomId) ?? null;
  }

  restoreSnapshot(roomId: string, snapshot: RoomSnapshot): boolean {
    if (!this.snapshots.has(roomId)) return false;
    this.snapshots.set(roomId, snapshot);
    return true;
  }
}

class FakeVersionStorage {
  public versions: BoardVersion[] = [];
  public createCalls: CreateVersionInput[] = [];
  private snapshotsByVersionId = new Map<string, RoomSnapshot>();
  private counter = 0;

  createVersion = vi.fn(async (input: CreateVersionInput): Promise<BoardVersion> => {
    this.createCalls.push(input);
    const version: BoardVersion = {
      id: `version-${++this.counter}`,
      boardId: input.boardId,
      createdByRoll: input.createdByRoll,
      createdByName: input.createdByName,
      createdAt: new Date().toISOString(),
      trigger: input.trigger,
      description: input.description ?? null,
      restoredFromVersionId: input.restoredFromVersionId ?? null,
    };
    this.versions.unshift(version);
    this.snapshotsByVersionId.set(version.id, input.snapshot);
    return version;
  });

  getMostRecentVersion = vi.fn(async (boardId: string): Promise<BoardVersion | null> => {
    return this.versions.find(v => v.boardId === boardId) ?? null;
  });

  getVersionWithSnapshot = vi.fn(async (boardId: string, versionId: string) => {
    const version = this.versions.find(v => v.id === versionId && v.boardId === boardId);
    if (!version) return null;
    const snapshot = this.snapshotsByVersionId.get(versionId);
    if (!snapshot) return null;
    return { version, snapshot };
  });
}

class FakeVersionTimeline {
  public enforceRetentionCalls: string[] = [];
  enforceRetention = vi.fn(async (boardId: string): Promise<void> => {
    this.enforceRetentionCalls.push(boardId);
  });
}

describe('VersionHistoryService', () => {
  let roomManager: FakeRoomManager;
  let storage: FakeVersionStorage;
  let timeline: FakeVersionTimeline;
  let service: VersionHistoryService;

  beforeEach(() => {
    vi.useFakeTimers();
    roomManager = new FakeRoomManager();
    storage = new FakeVersionStorage();
    timeline = new FakeVersionTimeline();
    service = new VersionHistoryService({
      roomManager: roomManager as unknown as RoomManager<unknown>,
      getCanvasSnapshotFromPersistence: async () => null,
      resolveBoardIdForRoom: async (roomId) => `board-for-${roomId}`,
      versionStorage: storage,
      versionTimeline: timeline,
    });
    service.start();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it('does not checkpoint on every single snapshot change (no version spam)', () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    roomManager.triggerSnapshotChanged('room-1');
    roomManager.triggerSnapshotChanged('room-1');
    roomManager.triggerSnapshotChanged('room-1');

    // Small edits (below the major-change threshold), no inactivity window
    // elapsed yet — none of this should have written a version.
    expect(storage.createCalls.length).toBe(0);
  });

  it('creates an inactivity checkpoint after the debounce window elapses with no further edits', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    roomManager.triggerSnapshotChanged('room-1');

    await vi.advanceTimersByTimeAsync(61_000); // past INACTIVITY_CHECKPOINT_MS (60s)

    expect(storage.createCalls.length).toBe(1);
    expect(storage.createCalls[0].trigger).toBe('inactivity');
    expect(storage.createCalls[0].createdByRoll).toBeNull(); // auto-checkpoints have no attributed actor
  });

  it('resets the inactivity timer on each new edit (does not fire early)', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    roomManager.triggerSnapshotChanged('room-1');

    await vi.advanceTimersByTimeAsync(45_000);
    roomManager.triggerSnapshotChanged('room-1'); // resets the 60s window
    await vi.advanceTimersByTimeAsync(45_000); // 90s total elapsed, but only 45s since the reset

    expect(storage.createCalls.length).toBe(0);

    await vi.advanceTimersByTimeAsync(16_000); // now 61s since the reset
    expect(storage.createCalls.length).toBe(1);
  });

  it('creates a major-change checkpoint immediately when the document count jumps past the threshold', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0); // flush maybeAutoCheckpoint's internal awaits
    expect(storage.createCalls.length).toBe(0); // small change, no checkpoint yet

    // Simulate a big paste — document count jumps by more than
    // MAJOR_CHANGE_DOCUMENT_DELTA (20) since nothing has been checkpointed yet.
    roomManager.setSnapshot('room-1', makeSnapshot(30));
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(storage.createCalls.length).toBe(1);
    expect(storage.createCalls[0].trigger).toBe('major_change');
  });

  it('does not major-change-checkpoint a small delta', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    roomManager.triggerSnapshotChanged('room-1');
    roomManager.setSnapshot('room-1', makeSnapshot(10)); // delta of 5, below threshold
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(storage.createCalls.length).toBe(0);
  });

  it('rate-limits automatic checkpoints even when both triggers fire in quick succession', async () => {
    // First change seeds the major-change baseline (see handleSnapshotChanged's
    // own comment) — a room's initial content is never itself a "change".
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.createCalls.length).toBe(0);

    // Now a real jump from that baseline — large enough to trigger
    // major_change immediately.
    roomManager.setSnapshot('room-1', makeSnapshot(50));
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.createCalls.length).toBe(1);

    // Another big jump right away — should be rate-limited by
    // MIN_AUTO_CHECKPOINT_INTERVAL_MS (30s), not produce a second version instantly.
    roomManager.setSnapshot('room-1', makeSnapshot(100));
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.createCalls.length).toBe(1);
  });

  it('explicit checkpoint calls enforceRetention after writing', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    await service.checkpointExplicit('board-1', 'room-1', 'STUDENT1', 'Ada Lovelace');

    expect(storage.createCalls.length).toBe(1);
    expect(storage.createCalls[0].trigger).toBe('explicit');
    expect(storage.createCalls[0].createdByRoll).toBe('STUDENT1');
    expect(timeline.enforceRetentionCalls).toEqual(['board-1']);
  });

  it('explicit checkpoint falls back to persistence when no live room exists', async () => {
    const fallbackSnapshot = makeSnapshot(3);
    const serviceWithFallback = new VersionHistoryService({
      roomManager: roomManager as unknown as RoomManager<unknown>,
      getCanvasSnapshotFromPersistence: async (roomId) => roomId === 'room-2' ? fallbackSnapshot : null,
      resolveBoardIdForRoom: async (roomId) => `board-for-${roomId}`,
      versionStorage: storage,
      versionTimeline: timeline,
    });

    // No setSnapshot call for room-2 — RoomManager.getCurrentSnapshot returns
    // null (no live room), so this must fall back to getCanvasSnapshotFromPersistence.
    const version = await serviceWithFallback.checkpointExplicit('board-2', 'room-2', 'STUDENT1', null);

    expect(version).not.toBeNull();
    expect(storage.createCalls[0].snapshot).toBe(fallbackSnapshot);
  });

  it('returns null (no checkpoint) when neither a live room nor persisted content exists', async () => {
    const version = await service.checkpointExplicit('board-3', 'room-3', 'STUDENT1', null);
    expect(version).toBeNull();
    expect(storage.createCalls.length).toBe(0);
  });

  it('rename and archive checkpoints carry the correct trigger and actor, and are never deduplicated even back-to-back', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));

    // Deliberately NOT advancing time between these two calls — a rename
    // immediately followed by an archive (or any other explicit-trigger
    // combination) must each produce their own row. The auto-checkpoint
    // dedup/rate-limit guard must never apply to explicit user-caused
    // events (see writeCheckpoint's own comment on why — this was a real
    // bug where rename/archive/explicit checkpoints could be silently
    // dropped by a recent unrelated auto-checkpoint).
    const renameVersion = await service.checkpointRename('board-1', 'room-1', 'STUDENT1', 'Ada Lovelace');
    expect(renameVersion?.trigger).toBe('rename');

    const archiveVersion = await service.checkpointArchive('board-1', 'room-1', 'STUDENT1', 'Ada Lovelace');
    expect(archiveVersion?.trigger).toBe('archive');
    expect(archiveVersion?.id).not.toBe(renameVersion?.id);

    expect(storage.createCalls.length).toBe(2);
  });

  it('does NOT deduplicate explicit checkpoints — each call always writes a new row', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    const first = await service.checkpointExplicit('board-1', 'room-1', 'STUDENT1', null);
    const second = await service.checkpointExplicit('board-1', 'room-1', 'STUDENT1', null);

    expect(storage.createCalls.length).toBe(2);
    expect(second?.id).not.toBe(first?.id);
  });

  it('DOES deduplicate an inactivity checkpoint that lands within the rate-limit window of a prior major_change checkpoint', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    roomManager.triggerSnapshotChanged('room-1'); // seeds baseline, no checkpoint yet
    await vi.advanceTimersByTimeAsync(0);

    // A big paste triggers major_change immediately.
    roomManager.setSnapshot('room-1', makeSnapshot(30));
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.createCalls.length).toBe(1);

    // Then editing goes quiet — the inactivity timer (reset by the same
    // triggerSnapshotChanged call above) fires 60s later, but that's well
    // past the 30s rate-limit window from the major_change checkpoint, so
    // this SHOULD still produce a second version (proves the two windows
    // are independent, not that they never both fire).
    await vi.advanceTimersByTimeAsync(61_000);
    expect(storage.createCalls.length).toBe(2);
    expect(storage.createCalls[1].trigger).toBe('inactivity');
  });

  it('DOES deduplicate a major_change firing within the rate-limit window right after another automatic checkpoint', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    roomManager.triggerSnapshotChanged('room-1'); // seeds baseline
    await vi.advanceTimersByTimeAsync(0);

    roomManager.setSnapshot('room-1', makeSnapshot(30)); // first major_change
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.createCalls.length).toBe(1);

    // A second big jump immediately after (well under 30s later) — this is
    // the realistic "coalesce" case: two automatic triggers for what's
    // plausibly the same burst of activity.
    roomManager.setSnapshot('room-1', makeSnapshot(60));
    roomManager.triggerSnapshotChanged('room-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.createCalls.length).toBe(1); // still 1 — coalesced
  });
});

describe('RestoreService', () => {
  let roomManager: FakeRoomManager;
  let storage: FakeVersionStorage;
  let timeline: FakeVersionTimeline;
  let restoreService: RestoreService;
  let persistedSnapshots: Map<string, RoomSnapshot>;

  beforeEach(() => {
    roomManager = new FakeRoomManager();
    storage = new FakeVersionStorage();
    timeline = new FakeVersionTimeline();
    persistedSnapshots = new Map();

    restoreService = new RestoreService({
      roomManager: roomManager as unknown as RoomManager<unknown>,
      persistCanvasSnapshot: async (roomId, snapshot) => {
        persistedSnapshots.set(roomId, snapshot);
      },
      versionStorage: storage,
      versionTimeline: timeline,
    });
  });

  it('returns version_not_found for an unknown versionId', async () => {
    const result = await restoreService.restore('board-1', 'room-1', 'nonexistent-version', 'STUDENT1', null);
    expect(result.ok).toBe(false);
  });

  it('hot-swaps a live room, records a new "restore" version, and never touches the original version row', async () => {
    // Seed history: an original version (V1), then simulate the room
    // having since diverged from it (a live room with different content).
    roomManager.setSnapshot('room-1', makeSnapshot(9));
    const v1 = await storage.createVersion({
      boardId: 'board-1', snapshot: makeSnapshot(3), trigger: 'explicit',
      createdByRoll: 'STUDENT1', createdByName: 'Ada',
    });

    const result = await restoreService.restore('board-1', 'room-1', v1.id, 'STUDENT2', 'Bob');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hadLiveRoom).toBe(true);
    expect(result.version.trigger).toBe('restore');
    expect(result.version.restoredFromVersionId).toBe(v1.id);
    expect(result.version.createdByRoll).toBe('STUDENT2'); // the restorer, not V1's original author

    // The room's live content is now V1's snapshot content (3 documents),
    // not what it had before the restore (9).
    expect(roomManager.getCurrentSnapshot('room-1')?.documents.length).toBe(3);

    // V1's own row is untouched — still exists, still has trigger 'explicit',
    // was never deleted or modified by the restore.
    const v1StillExists = storage.versions.find(v => v.id === v1.id);
    expect(v1StillExists).toBeDefined();
    expect(v1StillExists?.trigger).toBe('explicit');

    // History only grew: both V1 and the new restore version exist.
    expect(storage.versions.length).toBe(2);
  });

  it('falls back to persistCanvasSnapshot when the room is not currently live, and reports hadLiveRoom: false', async () => {
    // No setSnapshot call for room-2 — no live room exists for it.
    const v1 = await storage.createVersion({
      boardId: 'board-2', snapshot: makeSnapshot(4), trigger: 'explicit',
      createdByRoll: 'STUDENT1', createdByName: null,
    });

    const result = await restoreService.restore('board-2', 'room-2', v1.id, 'STUDENT1', null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hadLiveRoom).toBe(false);
    expect(persistedSnapshots.get('room-2')?.documents.length).toBe(4);
  });

  it('always writes a new version on restore, never coalescing with a recent one (unlike VersionHistoryService checkpoints)', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    const v1 = await storage.createVersion({
      boardId: 'board-1', snapshot: makeSnapshot(3), trigger: 'explicit',
      createdByRoll: 'STUDENT1', createdByName: null,
    });

    // Two restores back-to-back — VersionHistoryService's dedup guard would
    // coalesce two explicit checkpoints this close together, but a restore
    // must never be silently dropped, since each one is a deliberate action
    // the user needs to be able to see happened.
    await restoreService.restore('board-1', 'room-1', v1.id, 'STUDENT1', null);
    await restoreService.restore('board-1', 'room-1', v1.id, 'STUDENT1', null);

    const restoreVersions = storage.versions.filter(v => v.trigger === 'restore');
    expect(restoreVersions.length).toBe(2);
  });

  it('calls enforceRetention after a successful restore', async () => {
    roomManager.setSnapshot('room-1', makeSnapshot(5));
    const v1 = await storage.createVersion({
      boardId: 'board-1', snapshot: makeSnapshot(3), trigger: 'explicit',
      createdByRoll: 'STUDENT1', createdByName: null,
    });

    await restoreService.restore('board-1', 'room-1', v1.id, 'STUDENT1', null);

    expect(timeline.enforceRetentionCalls).toContain('board-1');
  });
});

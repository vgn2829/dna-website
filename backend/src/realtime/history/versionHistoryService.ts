import type { RoomSnapshot } from '@tldraw/sync-core';
import type { RoomManager } from '../rooms';
import * as defaultVersionStorage from './versionStorage';
import type { BoardVersion, VersionTrigger } from './versionStorage';
import * as defaultVersionTimeline from './versionTimeline';

// ─────────────────────────────────────────────────────────────────────────
// VERSION HISTORY SERVICE — the decision-maker. Owns exactly the questions
// the spec assigns to "the history layer": when to store a checkpoint, what
// counts as worth storing, and (via versionTimeline) retention. RoomManager
// itself makes none of these decisions — it only calls onSnapshotChanged(roomId)
// with no payload (see rooms.ts's own doc comment on that contract), and this
// service is the one place that reacts to it.
//
// WHY THIS STAYS INDEPENDENT OF THE REALTIME TRANSPORT (the spec asks this
// to be explained explicitly):
//   1. This service never touches WebSockets, TLSocketRoom, or the wire
//      protocol directly — its only coupling to realtime/rooms.ts is
//      RoomManager's two already-generic, transport-agnostic accessors
//      (onSnapshotChanged, getCurrentSnapshot) plus RoomPersistence (for
//      boards that currently have no live room — see checkpointFromPersistence).
//      A RoomSnapshot value is just data by the time it reaches here.
//   2. It has no idea whether zero, one, or many sessions are connected,
//      what their roles are, or whether they're reconnecting — none of
//      that is checkpoint-relevant. A checkpoint is a fact about the
//      DOCUMENT's state at a point in time, not about who's currently
//      looking at it.
//   3. Concretely, this means: RoomManager could be swapped for a
//      completely different transport (a future non-WS sync mechanism, or
//      even a batch import pipeline that never opens a live room at all)
//      and this service would keep working unchanged as long as its two
//      inputs — "something changed" and "give me the current snapshot" —
//      are still satisfied. The reverse is also true: RoomManager has zero
//      import of, or reference to, anything in this history/ directory.
// ─────────────────────────────────────────────────────────────────────────

// Debounce window after the LAST edit before an "inactivity" checkpoint is
// considered — long enough that a normal active editing burst (the kind
// that also drives the 2s PERSIST_DEBOUNCE_MS in rooms.ts) doesn't spawn a
// version per pause, short enough that a checkpoint exists soon after
// someone finishes a real editing session and closes the tab. Deliberately
// much longer than PERSIST_DEBOUNCE_MS: persistence must be fast (data-loss
// window), but a "moment worth showing in history" is a coarser, human-
// scale judgment — closer to "this person seems done for now."
const INACTIVITY_CHECKPOINT_MS = 60_000;

// A "major change" checkpoint requires the document to have moved
// substantially since the last checkpoint, measured cheaply (document
// count delta) rather than via a real diff — no per-shape/per-field
// comparison, which would mean parsing and walking both full snapshots on
// every single edit. This is intentionally coarse: it exists to catch "a
// large chunk of work happened" (e.g. pasting in a big chunk of content,
// bulk delete), not to be a precise change-significance model.
const MAJOR_CHANGE_DOCUMENT_DELTA = 20;

// Never checkpoint more often than this from automatic triggers, even if
// both inactivity and major-change conditions are individually satisfied
// in quick succession — prevents e.g. a rapid sequence of "60s idle, one
// edit, 60s idle" from spamming near-duplicate versions.
const MIN_AUTO_CHECKPOINT_INTERVAL_MS = 30_000;

// Generic over SessionMeta for the same reason RoomManager itself is (see
// rooms.ts) — this service only ever calls onSnapshotChanged/getCurrentSnapshot,
// neither of which reference SessionMeta, so it should accept whatever
// concrete RoomManager<SessionMeta> the caller already has (RoomManager<
// StudentSessionMeta> today) rather than forcing an unsound cast at the
// call site. `= unknown` as the default keeps `new VersionHistoryService(...)`
// callers who don't care (like this file's own tests, using a bare
// RoomManager<void>-shaped fake) from having to specify it explicitly.
export interface VersionHistoryServiceOptions<SessionMeta = unknown> {
  roomManager: RoomManager<SessionMeta>;
  // Fallback content source for explicit checkpoint triggers (rename/
  // archive/manual save) when the board has no live room right now — reads
  // whatever's currently persisted instead. Same RoomPersistence.load
  // signature/semantics as roomPersistence.ts, passed in rather than
  // imported directly so this service doesn't need its own Postgres
  // dependency for the one case it needs a fallback.
  getCanvasSnapshotFromPersistence: (roomId: string) => Promise<RoomSnapshot | null>;
  // RoomManager's notifications and accessors are keyed by roomId (it
  // "knows nothing about boards" — see rooms.ts). This service needs
  // boardId for the board_versions foreign key, so the caller (server.ts)
  // supplies the roomId -> boardId lookup — kept as an injected function
  // rather than this service importing `pool` directly, so it stays
  // testable against a fake without a database.
  resolveBoardIdForRoom: (roomId: string) => Promise<string | null>;
  // Both default to the real Postgres-backed modules (versionStorage.ts,
  // versionTimeline.ts) — overridable ONLY so this file's own test suite
  // can exercise the checkpoint DECISION logic (debounce timing, the
  // major-change document-count threshold, the rate limit, the dedup
  // guard) against an in-memory fake, without needing a database. Every
  // real caller (server.ts) leaves these at their defaults.
  versionStorage?: Pick<typeof defaultVersionStorage, 'createVersion' | 'getMostRecentVersion'>;
  versionTimeline?: Pick<typeof defaultVersionTimeline, 'enforceRetention'>;
}

interface BoardActivityState {
  inactivityTimer: ReturnType<typeof setTimeout> | null;
  lastAutoCheckpointAt: number;
  lastCheckpointedDocumentCount: number | null;
}

function countDocuments(snapshot: RoomSnapshot): number {
  return snapshot.documents.length;
}

export class VersionHistoryService<SessionMeta = unknown> {
  private activity = new Map<string, BoardActivityState>();
  private unsubscribeSnapshotChanged: (() => void) | null = null;
  private storage: Pick<typeof defaultVersionStorage, 'createVersion' | 'getMostRecentVersion'>;
  private timeline: Pick<typeof defaultVersionTimeline, 'enforceRetention'>;

  constructor(private opts: VersionHistoryServiceOptions<SessionMeta>) {
    this.storage = opts.versionStorage ?? defaultVersionStorage;
    this.timeline = opts.versionTimeline ?? defaultVersionTimeline;
  }

  // Wires this service into RoomManager's notification — call once, from
  // the composition root (server.ts). Separate from the constructor so a
  // test can construct a VersionHistoryService against a fake RoomManager
  // without it immediately subscribing to anything real.
  start(): void {
    this.unsubscribeSnapshotChanged = this.opts.roomManager.onSnapshotChanged((roomId) => {
      this.handleSnapshotChanged(roomId);
    });
  }

  stop(): void {
    this.unsubscribeSnapshotChanged?.();
    this.unsubscribeSnapshotChanged = null;
    for (const state of this.activity.values()) {
      if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
    }
    this.activity.clear();
  }

  private getOrCreateActivity(roomId: string): BoardActivityState {
    let state = this.activity.get(roomId);
    if (!state) {
      state = { inactivityTimer: null, lastAutoCheckpointAt: 0, lastCheckpointedDocumentCount: null };
      this.activity.set(roomId, state);
    }
    return state;
  }

  private handleSnapshotChanged(roomId: string): void {
    const state = this.getOrCreateActivity(roomId);

    // First change observed for this room this session — seed the
    // major-change baseline from whatever content exists RIGHT NOW, before
    // this change's own effect is reflected in a later read. Without this,
    // the baseline would default to comparing against 0 (empty), which
    // would misfire "major change" on a small edit to a board that already
    // had substantial pre-existing content loaded from persistence — the
    // point of this heuristic is "did a lot change since we started
    // watching," not "does this board have a lot of content."
    if (state.lastCheckpointedDocumentCount === null) {
      const initialSnapshot = this.opts.roomManager.getCurrentSnapshot(roomId);
      if (initialSnapshot) {
        state.lastCheckpointedDocumentCount = countDocuments(initialSnapshot);
      }
    }

    // Reset the inactivity timer on every change — it only fires once
    // editing has actually gone quiet for the full window, the same
    // debounce shape as rooms.ts's own schedulePersist (just a much longer
    // window, per INACTIVITY_CHECKPOINT_MS's own comment).
    if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(() => {
      state.inactivityTimer = null;
      void this.maybeAutoCheckpoint(roomId, 'inactivity');
    }, INACTIVITY_CHECKPOINT_MS);

    // Major-change is checked on every change immediately (not debounced)
    // — if someone pastes in a huge chunk of content, that's worth a
    // checkpoint right away, not 60 seconds later when they might have
    // already made further large edits on top of it.
    void this.maybeAutoCheckpoint(roomId, 'major_change');
  }

  private async maybeAutoCheckpoint(roomId: string, trigger: 'inactivity' | 'major_change'): Promise<void> {
    const state = this.getOrCreateActivity(roomId);

    const now = Date.now();
    if (now - state.lastAutoCheckpointAt < MIN_AUTO_CHECKPOINT_INTERVAL_MS) return;

    const snapshot = this.opts.roomManager.getCurrentSnapshot(roomId);
    // Room already torn down (last participant left) by the time this
    // runs — RoomManager.persistNow already saved canvas_data on that same
    // teardown path, so there's nothing new to checkpoint here.
    if (!snapshot) return;

    if (trigger === 'major_change') {
      const currentCount = countDocuments(snapshot);
      // lastCheckpointedDocumentCount is normally already seeded by
      // handleSnapshotChanged (from the room's content as of the first
      // observed change this session — see that method's own comment on
      // why 0/empty would be the wrong baseline for a room with
      // substantial pre-existing content). The ?? 0 here is only a
      // defensive fallback for the unlikely case getCurrentSnapshot
      // returned null at seed time but a real snapshot exists by now.
      const lastCount = state.lastCheckpointedDocumentCount ?? 0;
      const delta = Math.abs(currentCount - lastCount);
      if (delta < MAJOR_CHANGE_DOCUMENT_DELTA) return;
    }

    const boardId = await this.resolveBoardId(roomId);
    if (!boardId) return;

    await this.writeCheckpoint({
      boardId,
      snapshot,
      trigger,
      createdByRoll: null, // see this file's own header comment on why auto-checkpoints have no attributed actor
      createdByName: null,
    });

    state.lastAutoCheckpointAt = now;
    state.lastCheckpointedDocumentCount = countDocuments(snapshot);
  }

  private async resolveBoardId(roomId: string): Promise<string | null> {
    return this.opts.resolveBoardIdForRoom(roomId);
  }

  // ── Explicit triggers — called from REST routes, not from the
  // onSnapshotChanged subscription. Each resolves its own snapshot source:
  // prefer a live room (freshest content) via RoomManager, fall back to
  // whatever's currently persisted (covers rename/archive on a board with
  // no one connected right now — still worth a checkpoint since the
  // metadata event happened regardless of live editing state). ──

  async checkpointExplicit(boardId: string, roomId: string, actorRoll: string, actorName: string | null, description?: string): Promise<BoardVersion | null> {
    return this.checkpointWithTrigger(boardId, roomId, 'explicit', actorRoll, actorName, description);
  }

  async checkpointRename(boardId: string, roomId: string, actorRoll: string, actorName: string | null): Promise<BoardVersion | null> {
    return this.checkpointWithTrigger(boardId, roomId, 'rename', actorRoll, actorName);
  }

  async checkpointArchive(boardId: string, roomId: string, actorRoll: string, actorName: string | null): Promise<BoardVersion | null> {
    return this.checkpointWithTrigger(boardId, roomId, 'archive', actorRoll, actorName);
  }

  private async checkpointWithTrigger(
    boardId: string,
    roomId: string,
    trigger: VersionTrigger,
    actorRoll: string,
    actorName: string | null,
    description?: string
  ): Promise<BoardVersion | null> {
    const snapshot = this.opts.roomManager.getCurrentSnapshot(roomId)
      ?? await this.opts.getCanvasSnapshotFromPersistence(roomId);
    if (!snapshot) return null;

    const version = await this.writeCheckpoint({
      boardId, snapshot, trigger,
      createdByRoll: actorRoll, createdByName: actorName, description,
    });

    const state = this.getOrCreateActivity(roomId);
    state.lastAutoCheckpointAt = Date.now();
    state.lastCheckpointedDocumentCount = countDocuments(snapshot);

    return version;
  }

  private async writeCheckpoint(input: {
    boardId: string;
    snapshot: RoomSnapshot;
    trigger: VersionTrigger;
    createdByRoll: string | null;
    createdByName: string | null;
    description?: string | null;
    restoredFromVersionId?: string | null;
  }): Promise<BoardVersion> {
    // Avoid duplicate versions — but ONLY for the two AUTOMATIC triggers
    // (inactivity, major_change), where the dedup guard's premise actually
    // holds: two automatic checks firing in close succession for the same
    // underlying burst of activity are very plausibly "the same moment,"
    // and coalescing them is the intended behavior (see
    // MIN_AUTO_CHECKPOINT_INTERVAL_MS's own comment). Every OTHER trigger —
    // explicit, rename, archive, restore — represents a real, distinct,
    // user-caused event that must always produce its own row: a rename
    // happening 10s after an auto-save must never be silently dropped just
    // because a recent version already exists, or the rename itself would
    // never appear in the timeline at all. (This used to run for every
    // trigger — a real bug, caught in review — see this file's git history
    // for the fix.)
    const isAutomaticTrigger = input.trigger === 'inactivity' || input.trigger === 'major_change';
    if (isAutomaticTrigger) {
      const mostRecent = await this.storage.getMostRecentVersion(input.boardId);
      if (mostRecent) {
        const recentEnough = Date.now() - new Date(mostRecent.createdAt).getTime() < MIN_AUTO_CHECKPOINT_INTERVAL_MS;
        if (recentEnough) {
          // Still return the existing version rather than silently doing
          // nothing — a caller that specifically wants to know "was a NEW
          // version created" can compare the returned id against what it
          // already knew.
          return mostRecent;
        }
      }
    }

    const version = await this.storage.createVersion({
      boardId: input.boardId,
      snapshot: input.snapshot,
      createdByRoll: input.createdByRoll,
      createdByName: input.createdByName,
      trigger: input.trigger,
      description: input.description ?? null,
      restoredFromVersionId: input.restoredFromVersionId ?? null,
    });

    await this.timeline.enforceRetention(input.boardId);

    return version;
  }
}

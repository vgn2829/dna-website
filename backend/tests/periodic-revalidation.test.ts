import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client';
import { startPeriodicRevalidation, type StudentSessionMeta } from '../src/realtime/connectionHandler';
import type { RoomManager } from '../src/realtime/rooms';

// ─────────────────────────────────────────────────────────────────────────
// Integration-style tests for startPeriodicRevalidation: real
// checkRoomAccessForRoll (hits the local test DB, exactly like
// room-access.test.ts's own suite for that function) combined with a FAKE
// RoomManager-shaped object exposing only the subset of methods this
// module actually calls (getSessionMetas, updateSessionWriteAccess,
// disconnectSession).
//
// Uses REAL timers with a very short interval override (10ms — see
// startPeriodicRevalidation's own new `intervalMs` parameter, added
// specifically for this), not vi.useFakeTimers(): checkRoomAccessForRoll
// does real Postgres I/O (an actual socket round-trip, even to
// localhost), and vi.advanceTimersByTimeAsync only flushes the fake
// clock plus pending microtasks — it does not reliably wait for real
// socket I/O to complete, which made every fake-timer version of this
// suite fail non-deterministically on first write (confirmed directly,
// not assumed). A short real interval plus a bounded polling helper
// (waitUntil) is the correct tool for "real async I/O on a timer,"
// matching how the rest of this test file's own assertions already wait
// on real Postgres calls elsewhere in this codebase.
//
// This suite exists because a live, hand-built-WebSocket manual QA
// attempt against this exact mechanism turned out to be unable to
// unambiguously isolate it: a raw client socket that never completes
// tldraw's own real connect handshake gets torn down by TLSyncRoom's own
// unrelated ~10s AwaitingConnectMessage timeout (SESSION_START_WAIT_TIME
// in @tldraw/sync-core's RoomSession.ts) at almost the same order of
// magnitude as this feature's own interval, making a bare "did the
// socket close" observation inconclusive about WHICH mechanism closed
// it. This suite tests the mechanism directly, with no transport
// ambiguity at all.
// ─────────────────────────────────────────────────────────────────────────

class FakeRoomManagerForRevalidation {
  public sessionsByRoom = new Map<string, Array<{ sessionId: string; meta: StudentSessionMeta }>>();
  public writeAccessUpdates: Array<{ roomId: string; sessionId: string; canWriteCanvas: boolean }> = [];
  public disconnected: Array<{ roomId: string; sessionId: string }> = [];

  getSessionMetas(roomId: string) {
    return this.sessionsByRoom.get(roomId) ?? [];
  }
  updateSessionWriteAccess(roomId: string, sessionId: string, canWriteCanvas: boolean): boolean {
    this.writeAccessUpdates.push({ roomId, sessionId, canWriteCanvas });
    return true;
  }
  disconnectSession(roomId: string, sessionId: string): void {
    this.disconnected.push({ roomId, sessionId });
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, 10));
  }
}

const TEST_INTERVAL_MS = 20;

// Every board needs a workspace_id (NOT NULL since the workspace-layer
// migration in schema.ts). This suite doesn't exercise workspace-ceiling
// access — just gives each fixture board a minimal personal workspace
// owned by the same roll, so existing owner/board_members-driven
// permission behavior under test here is completely unaffected.
async function ensureWorkspace(ownerRoll: string): Promise<string> {
  const id = `workspace-test-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, 'Test Workspace', true, $2, $3)`,
    [id, ownerRoll, now]
  );
  await query(
    `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'owner', 'Owner', $3)`,
    [id, ownerRoll, now]
  );
  return id;
}

async function createBoard(opts: {
  id: string; roomId: string; ownerRoll: string;
  visibility?: 'private' | 'shared'; editMode?: 'members_only' | 'anyone';
  isArchived?: boolean;
}): Promise<string> {
  const now = new Date().toISOString();
  const workspaceId = await ensureWorkspace(opts.ownerRoll);
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, realtime_enabled, is_archived, workspace_id)
     VALUES ($1, 'Periodic Revalidation Test', $2, 'Owner', $3, $4, $5, $5, $6, true, $7, $8)`,
    [opts.id, opts.ownerRoll, opts.visibility ?? 'private', opts.editMode ?? 'members_only', now, opts.roomId, opts.isArchived ?? false, workspaceId]
  );
  return workspaceId;
}

async function addMember(boardId: string, roll: string): Promise<void> {
  await query(
    `INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1, $2, $3, $4)`,
    [boardId, roll, `Student ${roll}`, new Date().toISOString()]
  );
}

beforeEach(async () => {
  await query('TRUNCATE "board_members", "boards", "workspace_members", "workspaces" CASCADE');
  process.env.REALTIME_ENABLED = 'true';
});

describe('startPeriodicRevalidation', () => {
  it('disconnects a session whose membership was revoked, without waiting for the client to reconnect', async () => {
    await createBoard({ id: 'board-1', roomId: 'room-1', ownerRoll: 'OWNER1', visibility: 'private' });
    await addMember('board-1', 'MEMBER1');

    const fakeManager = new FakeRoomManagerForRevalidation();
    fakeManager.sessionsByRoom.set('room-1', [{ sessionId: 'session-1', meta: { roll: 'MEMBER1', role: 'editor' } }]);

    const stop = startPeriodicRevalidation(fakeManager as unknown as RoomManager<StudentSessionMeta>, () => ['room-1'], TEST_INTERVAL_MS);
    try {
      await query('DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2', ['board-1', 'MEMBER1']);

      await waitUntil(() => fakeManager.disconnected.length > 0);

      expect(fakeManager.disconnected).toEqual([{ roomId: 'room-1', sessionId: 'session-1' }]);
      expect(fakeManager.writeAccessUpdates).toHaveLength(0); // fully disconnected, not just downgraded
    } finally {
      stop();
    }
  });

  it('downgrades a session whose ONLY access was workspace-ceiling membership, once that workspace_members row is revoked mid-session', async () => {
    const workspaceId = await createBoard({ id: 'board-1w', roomId: 'room-1w', ownerRoll: 'OWNER1W', visibility: 'shared' });
    const now = new Date().toISOString();
    await query(
      `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'member', $3, $4)`,
      [workspaceId, 'WSMEMBER1W', 'WS Member', now]
    );

    const fakeManager = new FakeRoomManagerForRevalidation();
    fakeManager.sessionsByRoom.set('room-1w', [{ sessionId: 'session-1w', meta: { roll: 'WSMEMBER1W', role: 'editor' } }]);

    const stop = startPeriodicRevalidation(fakeManager as unknown as RoomManager<StudentSessionMeta>, () => ['room-1w'], TEST_INTERVAL_MS);
    try {
      await query('DELETE FROM workspace_members WHERE workspace_id = $1 AND roll_number = $2', [workspaceId, 'WSMEMBER1W']);

      // A shared board with no workspace ceiling still leaves the caller
      // at 'commenter' (any signed-in student can read a shared board) —
      // so this is a write-access downgrade, not a full disconnect,
      // exactly mirroring the archived-board case below.
      await waitUntil(() => fakeManager.writeAccessUpdates.some(u => u.canWriteCanvas === false));

      expect(fakeManager.disconnected).toHaveLength(0);
      expect(fakeManager.writeAccessUpdates[fakeManager.writeAccessUpdates.length - 1])
        .toEqual({ roomId: 'room-1w', sessionId: 'session-1w', canWriteCanvas: false });
    } finally {
      stop();
    }
  });

  it('downgrades (not disconnects) a session when the board is archived while connected', async () => {
    await createBoard({ id: 'board-2', roomId: 'room-2', ownerRoll: 'OWNER2', visibility: 'private' });
    await addMember('board-2', 'MEMBER2');

    const fakeManager = new FakeRoomManagerForRevalidation();
    fakeManager.sessionsByRoom.set('room-2', [{ sessionId: 'session-2', meta: { roll: 'MEMBER2', role: 'editor' } }]);

    const stop = startPeriodicRevalidation(fakeManager as unknown as RoomManager<StudentSessionMeta>, () => ['room-2'], TEST_INTERVAL_MS);
    try {
      await query('UPDATE boards SET is_archived = true WHERE id = $1', ['board-2']);

      await waitUntil(() => fakeManager.writeAccessUpdates.some(u => u.canWriteCanvas === false));

      expect(fakeManager.disconnected).toHaveLength(0); // still has read access — not disconnected
      expect(fakeManager.writeAccessUpdates[fakeManager.writeAccessUpdates.length - 1])
        .toEqual({ roomId: 'room-2', sessionId: 'session-2', canWriteCanvas: false });
    } finally {
      stop();
    }
  });

  it('disconnects a session whose board was deleted while connected', async () => {
    await createBoard({ id: 'board-3', roomId: 'room-3', ownerRoll: 'OWNER3' });

    const fakeManager = new FakeRoomManagerForRevalidation();
    fakeManager.sessionsByRoom.set('room-3', [{ sessionId: 'session-3', meta: { roll: 'OWNER3', role: 'owner' } }]);

    const stop = startPeriodicRevalidation(fakeManager as unknown as RoomManager<StudentSessionMeta>, () => ['room-3'], TEST_INTERVAL_MS);
    try {
      await query('DELETE FROM boards WHERE id = $1', ['board-3']);

      await waitUntil(() => fakeManager.disconnected.length > 0);

      expect(fakeManager.disconnected).toEqual([{ roomId: 'room-3', sessionId: 'session-3' }]);
    } finally {
      stop();
    }
  });

  it('repeatedly confirms write access for a session whose access is unchanged (never disconnects it)', async () => {
    await createBoard({ id: 'board-4', roomId: 'room-4', ownerRoll: 'OWNER4' });

    const fakeManager = new FakeRoomManagerForRevalidation();
    fakeManager.sessionsByRoom.set('room-4', [{ sessionId: 'session-4', meta: { roll: 'OWNER4', role: 'owner' } }]);

    const stop = startPeriodicRevalidation(fakeManager as unknown as RoomManager<StudentSessionMeta>, () => ['room-4'], TEST_INTERVAL_MS);
    try {
      await waitUntil(() => fakeManager.writeAccessUpdates.length >= 2);

      expect(fakeManager.disconnected).toHaveLength(0);
      for (const update of fakeManager.writeAccessUpdates) {
        expect(update).toEqual({ roomId: 'room-4', sessionId: 'session-4', canWriteCanvas: true });
      }
    } finally {
      stop();
    }
  });

  it('independently re-checks multiple sessions across multiple rooms in the same tick', async () => {
    await createBoard({ id: 'board-6', roomId: 'room-6', ownerRoll: 'OWNER6' });
    await createBoard({ id: 'board-7', roomId: 'room-7', ownerRoll: 'OWNER7' });

    const fakeManager = new FakeRoomManagerForRevalidation();
    fakeManager.sessionsByRoom.set('room-6', [{ sessionId: 'session-6a', meta: { roll: 'OWNER6', role: 'owner' } }]);
    fakeManager.sessionsByRoom.set('room-7', [{ sessionId: 'session-7a', meta: { roll: 'OWNER7', role: 'owner' } }]);

    const stop = startPeriodicRevalidation(
      fakeManager as unknown as RoomManager<StudentSessionMeta>, () => ['room-6', 'room-7'], TEST_INTERVAL_MS
    );
    try {
      await waitUntil(() =>
        fakeManager.writeAccessUpdates.some(u => u.roomId === 'room-6')
        && fakeManager.writeAccessUpdates.some(u => u.roomId === 'room-7')
      );
      expect(fakeManager.disconnected).toHaveLength(0);
    } finally {
      stop();
    }
  });

  it('stops re-validating once the returned stop function is called', async () => {
    await createBoard({ id: 'board-8', roomId: 'room-8', ownerRoll: 'OWNER8' });

    const fakeManager = new FakeRoomManagerForRevalidation();
    fakeManager.sessionsByRoom.set('room-8', [{ sessionId: 'session-8', meta: { roll: 'OWNER8', role: 'owner' } }]);

    const stop = startPeriodicRevalidation(fakeManager as unknown as RoomManager<StudentSessionMeta>, () => ['room-8'], TEST_INTERVAL_MS);
    await waitUntil(() => fakeManager.writeAccessUpdates.length > 0);
    stop();

    const countAtStop = fakeManager.writeAccessUpdates.length;
    await new Promise(r => setTimeout(r, TEST_INTERVAL_MS * 5));
    expect(fakeManager.writeAccessUpdates.length).toBe(countAtStop); // no further ticks after stop()
  });
});

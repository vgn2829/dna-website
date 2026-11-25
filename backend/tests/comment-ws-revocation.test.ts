import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client';
import { CommentBroadcaster, COMMENT_READ_TTL_MS } from '../src/realtime/comments/commentBroadcaster';
import { startPeriodicRevalidation, type CommentRevalidationTarget } from '../src/realtime/connectionHandler';
import type { RoomManager } from '../src/realtime/rooms';
import type { BoardComment } from '../src/realtime/comments/commentsStorage';

// ─────────────────────────────────────────────────────────────────────────
// COMMENT WEBSOCKET LIVE REVOCATION (V2.6 Phase A).
//
// THE VULNERABILITY THIS LOCKS DOWN, reproduced against this exact class
// before it was fixed: CommentBroadcaster stored only Set<WebSocket>. The
// connecting user's roll was computed by checkRoomAccess and then
// DISCARDED, so a connected comment socket carried no identity and there
// was nothing any revocation mechanism could re-check — the broadcaster's
// entire surface was join/broadcast/getActiveSocketCount, with no way to
// express "this person may no longer receive". A user removed from a
// private board kept receiving every subsequent comment event on it while
// their socket stayed open.
//
// The fix retains the roll per session and extends the EXISTING periodic
// re-validation tick (same timer, same checkRoomAccessForRoll helper, same
// interval) to close comment sockets whose access has gone. There is no
// second timer, no second cache and no second permission model.
//
// Like periodic-revalidation.test.ts, this uses REAL timers with a short
// injected interval rather than fake timers, because checkRoomAccessForRoll
// does real Postgres I/O — see that file's own comment for why fake timers
// do not reliably flush real socket I/O.
// ─────────────────────────────────────────────────────────────────────────

class FakeSocket {
  readonly OPEN = 1;
  readyState: 0 | 1 | 2 | 3 = 1;
  received: string[] = [];
  closes: Array<{ code?: number; reason?: string }> = [];
  private listeners = new Map<string, Set<() => void>>();
  send(data: string): void { this.received.push(data); }
  on(type: string, l: () => void): this {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
    return this;
  }
  emit(type: string): void { this.listeners.get(type)?.forEach(l => l()); }
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.emit('close');
  }
  events(): number { return this.received.length; }
}

const fakeComment = (id: string): BoardComment => ({
  id, content: 'private board content',
} as unknown as BoardComment);

// RoomManager stand-in: this suite is about the COMMENT channel, so the
// canvas branch of the tick must be an inert no-op.
const inertRoomManager = {
  getSessionMetas: () => [],
  updateSessionWriteAccess: () => true,
  disconnectSession: () => {},
} as unknown as RoomManager<{ roll: string; role: 'owner' }>;

const TICK_MS = 20;

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
    await new Promise(r => setTimeout(r, 10));
  }
}

async function createBoard(ownerRoll: string, roomId: string, visibility: 'private' | 'shared' = 'private'): Promise<string> {
  const id = `board-cws-${Math.random().toString(36).slice(2, 10)}`;
  const wsId = `ws-cws-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1,'WS',true,$2,$3)`,
    [wsId, ownerRoll, now]
  );
  await query(
    `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1,$2,'owner','Owner',$3)`,
    [wsId, ownerRoll, now]
  );
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, realtime_enabled, workspace_id)
     VALUES ($1,'CWS Board',$2,'Owner',$3,'members_only',$4,$4,$5,true,$6)`,
    [id, ownerRoll, visibility, now, roomId, wsId]
  );
  return id;
}

const addMember = (boardId: string, roll: string) => query(
  `INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1,$2,$3,$4)`,
  [boardId, roll, `Student ${roll}`, new Date().toISOString()]
);

const revoke = (boardId: string, roll: string) =>
  query('DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2', [boardId, roll]);

beforeEach(async () => {
  await query('TRUNCATE "board_comments","board_members","boards","workspace_members","workspaces" CASCADE');
  process.env.REALTIME_ENABLED = 'true';
});

describe('CommentBroadcaster — identity and revocation', () => {
  it('delivers events to a connected socket and tracks its roll', () => {
    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');

    b.broadcast('r1', { type: 'create', comment: fakeComment('c1') });
    expect(s.events()).toBe(1);
    expect(b.getConnectedRolls('r1')).toEqual(['240280']);
    expect(b.getActiveRoomIds()).toEqual(['r1']);
  });

  it('stops delivering and closes with 1008 once a roll is disconnected', () => {
    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');
    b.broadcast('r1', { type: 'create', comment: fakeComment('c1') });

    expect(b.disconnectRoll('r1', '240280')).toBe(1);
    b.broadcast('r1', { type: 'create', comment: fakeComment('c2-after') });

    expect(s.events()).toBe(1);                       // no post-revocation event
    expect(s.closes).toEqual([{ code: 1008, reason: 'permission_denied' }]);
    expect(b.getActiveSocketCount('r1')).toBe(0);
  });

  it('closes every socket a roll holds, leaving other users connected', () => {
    const b = new CommentBroadcaster();
    const tabA = new FakeSocket(), tabB = new FakeSocket(), other = new FakeSocket();
    b.join('r1', tabA as never, '240280');
    b.join('r1', tabB as never, '240280');
    b.join('r1', other as never, '230437');

    expect(b.disconnectRoll('r1', '240280')).toBe(2);
    b.broadcast('r1', { type: 'create', comment: fakeComment('after') });

    expect(tabA.events()).toBe(0);
    expect(tabB.events()).toBe(0);
    expect(other.events()).toBe(1);                    // unaffected
    expect(b.getConnectedRolls('r1')).toEqual(['230437']);
  });

  it('deduplicates rolls so one person with several tabs is re-checked once', () => {
    const b = new CommentBroadcaster();
    b.join('r1', new FakeSocket() as never, '240280');
    b.join('r1', new FakeSocket() as never, '240280');
    b.join('r1', new FakeSocket() as never, '230437');
    expect(b.getConnectedRolls('r1').sort()).toEqual(['230437', '240280']);
  });

  it('leaves other rooms untouched when one room is revoked', () => {
    const b = new CommentBroadcaster();
    const inR1 = new FakeSocket(), inR2 = new FakeSocket();
    b.join('r1', inR1 as never, '240280');
    b.join('r2', inR2 as never, '240280');

    b.disconnectRoll('r1', '240280');
    b.broadcast('r2', { type: 'create', comment: fakeComment('x') });

    expect(inR1.events()).toBe(0);
    expect(inR2.events()).toBe(1);
    expect(b.getActiveRoomIds()).toEqual(['r2']);
  });

  it('cleans up the subscription when a socket closes normally', () => {
    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');
    expect(b.getActiveSocketCount('r1')).toBe(1);

    s.close();
    expect(b.getActiveSocketCount('r1')).toBe(0);
    expect(b.getActiveRoomIds()).toEqual([]);
  });

  it('tolerates a double close and a close after disconnectRoll without corrupting state', () => {
    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');

    b.disconnectRoll('r1', '240280');   // removes + closes (fires 'close')
    expect(() => s.emit('close')).not.toThrow();   // stray second close
    expect(() => b.disconnectRoll('r1', '240280')).not.toThrow();
    expect(b.disconnectRoll('r1', '240280')).toBe(0);
    expect(b.getActiveSocketCount('r1')).toBe(0);
  });

  it('never delivers to a socket already removed, even mid-broadcast', () => {
    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');
    b.disconnectRoll('r1', '240280');

    // Several broadcasts after revocation — none may land.
    for (let i = 0; i < 5; i++) b.broadcast('r1', { type: 'create', comment: fakeComment(`x${i}`) });
    expect(s.events()).toBe(0);
  });

  // ── Broadcast-time freshness (COMMENT_READ_TTL_MS) ──────────────────
  // The periodic tick alone left a window: a revoked user kept receiving
  // comment events until the next tick fired — measured directly against
  // the running server, where a post-revocation comment containing private
  // content was delivered. These cover the guard that closes it.

  it('does not deliver to a session whose access has been revoked, without waiting for the periodic tick', async () => {
    let allowed = true;
    const b = new CommentBroadcaster(async () => allowed);
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');

    // Age the decision past the TTL so the next broadcast must re-check.
    await new Promise(r => setTimeout(r, COMMENT_READ_TTL_MS + 50));

    allowed = false;   // revoked in the database
    b.broadcast('r1', { type: 'create', comment: fakeComment('secret') });

    await waitUntil(() => s.readyState === 3);
    expect(s.events()).toBe(0);
    expect(s.closes[0]).toEqual({ code: 1008, reason: 'permission_denied' });
  });

  it('still delivers (a moment later) when the re-check confirms access', async () => {
    const b = new CommentBroadcaster(async () => true);
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');
    await new Promise(r => setTimeout(r, COMMENT_READ_TTL_MS + 50));

    b.broadcast('r1', { type: 'create', comment: fakeComment('ok') });
    await waitUntil(() => s.events() === 1);
    expect(s.readyState).toBe(1);
  });

  it('reuses a fresh decision within the TTL instead of re-querying', async () => {
    let calls = 0;
    const b = new CommentBroadcaster(async () => { calls++; return true; });
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');

    // join() stamps checkedAt = now, so these all fall inside the TTL.
    for (let i = 0; i < 20; i++) b.broadcast('r1', { type: 'create', comment: fakeComment(`c${i}`) });
    expect(calls).toBe(0);
    expect(s.events()).toBe(20);
  });

  it('de-duplicates concurrent re-checks into a single query', async () => {
    let calls = 0;
    const b = new CommentBroadcaster(async () => {
      calls++;
      await new Promise(r => setTimeout(r, 30));
      return true;
    });
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');
    await new Promise(r => setTimeout(r, COMMENT_READ_TTL_MS + 50));

    for (let i = 0; i < 8; i++) b.broadcast('r1', { type: 'create', comment: fakeComment(`c${i}`) });
    await waitUntil(() => s.events() === 8, 4000);
    expect(calls).toBe(1);
  });

  it('fails closed when the re-check throws', async () => {
    const b = new CommentBroadcaster(async () => { throw new Error('db down'); });
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');
    await new Promise(r => setTimeout(r, COMMENT_READ_TTL_MS + 50));

    b.broadcast('r1', { type: 'create', comment: fakeComment('secret') });
    await waitUntil(() => s.readyState === 3);
    expect(s.events()).toBe(0);   // never an implicit grant
  });

  it('delivers immediately when no checker is configured (existing behaviour)', () => {
    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join('r1', s as never, '240280');
    b.broadcast('r1', { type: 'create', comment: fakeComment('c1') });
    expect(s.events()).toBe(1);   // synchronous, unchanged
  });

  it('does not expose any client->server write path', () => {
    // The channel remains receive-only: join attaches a no-op 'message'
    // handler and the class has no method that mutates comment data.
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(new CommentBroadcaster()));
    expect(surface).not.toContain('handleMessage');
    expect(surface.some(n => /create|update|write|mutate/i.test(n))).toBe(false);
  });
});

describe('comment socket periodic re-validation', () => {
  it('closes a comment socket whose board membership was revoked', async () => {
    const roomId = `room-rv-${Math.random().toString(36).slice(2, 8)}`;
    const boardId = await createBoard('230437', roomId);
    await addMember(boardId, '240280');

    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join(roomId, s as never, '240280');

    const stop = startPeriodicRevalidation(
      inertRoomManager, () => [], TICK_MS, b as CommentRevalidationTarget
    );
    try {
      // Still a member — must survive several ticks.
      await new Promise(r => setTimeout(r, TICK_MS * 5));
      expect(s.readyState).toBe(1);
      expect(b.getActiveSocketCount(roomId)).toBe(1);

      await revoke(boardId, '240280');

      await waitUntil(() => s.readyState === 3);
      expect(s.closes[0]).toEqual({ code: 1008, reason: 'permission_denied' });
      expect(b.getActiveSocketCount(roomId)).toBe(0);

      // And no further events can reach it.
      b.broadcast(roomId, { type: 'create', comment: fakeComment('after-revocation') });
      expect(s.events()).toBe(0);
    } finally {
      stop();
    }
  });

  it('closes a comment socket when the board is deleted', async () => {
    const roomId = `room-del-${Math.random().toString(36).slice(2, 8)}`;
    const boardId = await createBoard('230437', roomId);
    await addMember(boardId, '240280');

    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join(roomId, s as never, '240280');

    const stop = startPeriodicRevalidation(
      inertRoomManager, () => [], TICK_MS, b as CommentRevalidationTarget
    );
    try {
      await query('DELETE FROM boards WHERE id = $1', [boardId]);
      await waitUntil(() => s.readyState === 3);
      expect(b.getActiveSocketCount(roomId)).toBe(0);
    } finally {
      stop();
    }
  });

  it('keeps an authorized socket connected across many ticks', async () => {
    const roomId = `room-ok-${Math.random().toString(36).slice(2, 8)}`;
    const boardId = await createBoard('230437', roomId);
    await addMember(boardId, '240280');

    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join(roomId, s as never, '240280');

    const stop = startPeriodicRevalidation(
      inertRoomManager, () => [], TICK_MS, b as CommentRevalidationTarget
    );
    try {
      await new Promise(r => setTimeout(r, TICK_MS * 15));
      expect(s.readyState).toBe(1);
      b.broadcast(roomId, { type: 'create', comment: fakeComment('still-ok') });
      expect(s.events()).toBe(1);
    } finally {
      stop();
    }
  });

  it('stops re-validating once the returned stop function is called (no timer leak)', async () => {
    const roomId = `room-stop-${Math.random().toString(36).slice(2, 8)}`;
    const boardId = await createBoard('230437', roomId);
    await addMember(boardId, '240280');

    const b = new CommentBroadcaster();
    const s = new FakeSocket();
    b.join(roomId, s as never, '240280');

    const stop = startPeriodicRevalidation(
      inertRoomManager, () => [], TICK_MS, b as CommentRevalidationTarget
    );
    stop();

    await revoke(boardId, '240280');
    await new Promise(r => setTimeout(r, TICK_MS * 10));
    // Nothing is re-checking any more, so the socket stays as it was —
    // proving the interval really was cleared.
    expect(s.readyState).toBe(1);
  });

  it('runs without a comment broadcaster (existing callers are unaffected)', async () => {
    const stop = startPeriodicRevalidation(inertRoomManager, () => [], TICK_MS);
    await new Promise(r => setTimeout(r, TICK_MS * 5));
    expect(() => stop()).not.toThrow();
  });
});

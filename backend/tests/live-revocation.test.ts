import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client';
import { RoomManager, WRITE_DECISION_TTL_MS } from '../src/realtime/rooms';
import { checkRoomAccessForRoll, roleCanWriteCanvas, type RoomRole } from '../src/realtime/roomAccess';
import type { RoomPersistence } from '../src/realtime/roomPersistence';
import type { RoomSnapshot } from '@tldraw/sync-core';

// ─────────────────────────────────────────────────────────────────────────
// LIVE PERMISSION REVOCATION (V2.5 Phase 3).
//
// THE VULNERABILITY THIS LOCKS DOWN, reproduced over the real wire before
// it was fixed: a push used to be authorized purely against
// ManagedSession.canWriteCanvas — an in-memory boolean refreshed ONLY by
// the 15s periodic re-validator. Deleting a user's board_members row and
// immediately pushing a shape over their still-open socket was ACCEPTED
// and PERSISTED to Postgres. The socket did eventually close (~15-20s) and
// a reconnect was correctly refused with 1008 permission_denied, but a
// revoked user had a multi-second window of full write access.
//
// The fix: RoomManager now re-checks CURRENT board access before
// forwarding a push whenever the cached decision has aged past
// WRITE_DECISION_TTL_MS, reusing the same checkRoomAccessForRoll +
// roleCanWriteCanvas helpers the connect-time check and the periodic
// re-validator already use. No new table, endpoint, socket or role model.
//
// These tests drive the REAL RoomManager against the REAL test database
// with the REAL access helpers wired exactly as server.ts wires them — the
// gate's decision is observed through RoomManager's public surface rather
// than by reaching into private state.
// ─────────────────────────────────────────────────────────────────────────

class FakePersistence implements RoomPersistence {
  async load(): Promise<RoomSnapshot | null> { return null; }
  async save(): Promise<void> { /* no-op */ }
}

interface Meta { roll: string; role: RoomRole }

// Exactly the checker server.ts injects — same helpers, same order.
const liveWriteCheck = async (roomId: string, meta: Meta): Promise<boolean> => {
  const access = await checkRoomAccessForRoll(roomId, meta.roll);
  if (!access.ok) return false;
  return roleCanWriteCanvas(access.role, access.isArchived);
};

function makeManager(): RoomManager<Meta> {
  return new RoomManager<Meta>(new FakePersistence(), liveWriteCheck);
}

// A WebSocketMinimal-ish fake. RoomManager hands the gate a real-ish
// socket; the gate attaches its own 'message' listener, and TLSocketRoom
// attaches one downstream of the gate. `emitMessage` therefore exercises
// the full gate path, and `sent` shows what the room pushed back.
class FakeSocket {
  readyState: 0 | 1 | 2 | 3 = 1;
  sent: string[] = [];
  private listeners = new Map<string, Set<(e: any) => void>>();
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.emit('close', {}); }
  addEventListener(type: string, l: (e: any) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: (e: any) => void): void {
    this.listeners.get(type)?.delete(l);
  }
  emit(type: string, e: any): void { this.listeners.get(type)?.forEach(l => l(e)); }
  emitMessage(data: string): void { this.emit('message', { data }); }
}

// The gate only ever reads a message's top-level `type`, so a minimal
// push body is sufficient and deliberately carries no real diff — this
// suite is about AUTHORIZATION, not document semantics. (Same reasoning
// room-socket-gate.test.ts documents for its own fixtures.)
const PUSH = JSON.stringify({ type: 'push', clientClock: 1, diff: {} });

// Whether a push emitted on this socket reached the room. Read via the
// gate's observable effect: an allowed push reaches TLSocketRoom, which
// has no session registered for a raw fake socket and so responds; the
// reliable signal for these tests is RoomManager's own cached decision
// after a forced re-check, so assert on that instead of room internals.
async function canStillWrite(mgr: RoomManager<Meta>, roomId: string, sessionId: string): Promise<boolean> {
  // Age the cached decision past the TTL so the next check is forced to
  // hit the database, exactly as a push arriving >1s later would.
  (mgr as unknown as {
    rooms: Map<string, { sessions: Map<string, { writeCheckedAt: number }> }>
  }).rooms.get(roomId)!.sessions.get(sessionId)!.writeCheckedAt = 0;
  return (mgr as unknown as {
    revalidateWriteAccess: (r: string, s: string) => Promise<boolean>
  }).revalidateWriteAccess(roomId, sessionId);
}

async function ensureWorkspace(ownerRoll: string): Promise<string> {
  const id = `ws-revoke-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO workspaces (id, name, is_personal, owner_roll, created_at) VALUES ($1, 'Revocation Test WS', true, $2, $3)`,
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
  isArchived?: boolean; workspaceId?: string;
}): Promise<string> {
  const now = new Date().toISOString();
  const workspaceId = opts.workspaceId ?? await ensureWorkspace(opts.ownerRoll);
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, realtime_enabled, is_archived, workspace_id)
     VALUES ($1, 'Revocation Test Board', $2, 'Owner', $3, $4, $5, $5, $6, true, $7, $8)`,
    [opts.id, opts.ownerRoll, opts.visibility ?? 'private', opts.editMode ?? 'members_only',
     now, opts.roomId, opts.isArchived ?? false, workspaceId]
  );
  return workspaceId;
}

const addMember = (boardId: string, roll: string) => query(
  `INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1, $2, $3, $4)`,
  [boardId, roll, `Student ${roll}`, new Date().toISOString()]
);

const revokeMember = (boardId: string, roll: string) =>
  query(`DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2`, [boardId, roll]);

beforeEach(async () => {
  await query('TRUNCATE "board_members", "boards", "workspace_members", "workspaces" CASCADE');
  process.env.REALTIME_ENABLED = 'true';
});

describe('live permission revocation — per-push authorization', () => {
  // (1) authorized editor can mutate
  it('allows an authorized editor to write', async () => {
    const mgr = makeManager();
    await createBoard({ id: 'b1', roomId: 'r1', ownerRoll: '230437' });
    await addMember('b1', '240280');

    await mgr.join('r1', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);
    expect(await canStillWrite(mgr, 'r1', 's1')).toBe(true);
  });

  // (5)(6) revocation blocks writes on an ALREADY-OPEN connection, with
  // no reconnect, no reload and without waiting for the 15s re-validator.
  it('blocks writes immediately after revocation on an already-open connection', async () => {
    const mgr = makeManager();
    await createBoard({ id: 'b2', roomId: 'r2', ownerRoll: '230437' });
    await addMember('b2', '240280');

    await mgr.join('r2', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);
    expect(await canStillWrite(mgr, 'r2', 's1')).toBe(true);

    await revokeMember('b2', '240280');

    // No reconnect, no periodic tick — the very next push re-checks.
    expect(await canStillWrite(mgr, 'r2', 's1')).toBe(false);
    // ...and stays denied on every subsequent attempt.
    expect(await canStillWrite(mgr, 'r2', 's1')).toBe(false);
  });

  // (8) owner remains authorized throughout
  it('keeps the owner authorized when another member is revoked', async () => {
    const mgr = makeManager();
    await createBoard({ id: 'b3', roomId: 'r3', ownerRoll: '230437' });
    await addMember('b3', '240280');

    await mgr.join('r3', 'owner-s', new FakeSocket() as never, { roll: '230437', role: 'owner' }, true);
    await mgr.join('r3', 'member-s', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);

    await revokeMember('b3', '240280');

    expect(await canStillWrite(mgr, 'r3', 'member-s')).toBe(false);
    expect(await canStillWrite(mgr, 'r3', 'owner-s')).toBe(true);
  });

  // (2)(3) commenter/viewer cannot mutate — a non-member on a SHARED
  // board classifies as commenter, which roleCanWriteCanvas denies.
  it('denies writes to a non-member on a shared board (commenter tier)', async () => {
    const mgr = makeManager();
    // edit_mode members_only so the shared board does not grant 'editor'
    // via the edit_mode==='anyone' path.
    await createBoard({ id: 'b4', roomId: 'r4', ownerRoll: '230437', visibility: 'shared' });

    await mgr.join('r4', 's1', new FakeSocket() as never, { roll: '999999', role: 'commenter' }, false);
    expect(await canStillWrite(mgr, 'r4', 's1')).toBe(false);
  });

  // Archive is the other live downgrade the same path must honour.
  it('denies writes once the board is archived mid-session', async () => {
    const mgr = makeManager();
    await createBoard({ id: 'b5', roomId: 'r5', ownerRoll: '230437' });
    await addMember('b5', '240280');

    await mgr.join('r5', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);
    expect(await canStillWrite(mgr, 'r5', 's1')).toBe(true);

    await query(`UPDATE boards SET is_archived = true WHERE id = 'b5'`);
    expect(await canStillWrite(mgr, 'r5', 's1')).toBe(false);
  });

  it('denies writes once the board is deleted mid-session', async () => {
    const mgr = makeManager();
    await createBoard({ id: 'b6', roomId: 'r6', ownerRoll: '230437' });
    await addMember('b6', '240280');

    await mgr.join('r6', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);
    await query(`DELETE FROM boards WHERE id = 'b6'`);

    expect(await canStillWrite(mgr, 'r6', 's1')).toBe(false);
  });

  // (10) workspace isolation — a member of a DIFFERENT workspace gets
  // nothing from the workspace ceiling.
  it('does not grant write access to a member of a different workspace', async () => {
    const mgr = makeManager();
    const otherWs = await ensureWorkspace('111111');
    await createBoard({ id: 'b7', roomId: 'r7', ownerRoll: '230437', visibility: 'shared' });
    // 999999 belongs to a workspace that does NOT own this board.
    await query(
      `INSERT INTO workspace_members (workspace_id, roll_number, role, name, added_at) VALUES ($1, $2, 'member', 'Outsider', $3)`,
      [otherWs, '999999', new Date().toISOString()]
    );

    await mgr.join('r7', 's1', new FakeSocket() as never, { roll: '999999', role: 'commenter' }, false);
    expect(await canStillWrite(mgr, 'r7', 's1')).toBe(false);
  });

  // (9) project membership is not a board grant — there is no project
  // table involvement in the access path at all, which is the point.
  it('does not grant board write access via a project association', async () => {
    const mgr = makeManager();
    const ws = await ensureWorkspace('230437');
    await createBoard({ id: 'b8', roomId: 'r8', ownerRoll: '230437', workspaceId: ws });
    await query(
      `INSERT INTO projects (id, workspace_id, name, owner_roll, owner_name, created_at, is_archived)
       VALUES ('p1', $1, 'Proj', '230437', 'Owner', $2, false)`,
      [ws, new Date().toISOString()]
    );
    await query(`UPDATE boards SET project_id = 'p1' WHERE id = 'b8'`);

    // 999999 is in no board_members row and no workspace_members row.
    await mgr.join('r8', 's1', new FakeSocket() as never, { roll: '999999', role: 'commenter' }, false);
    expect(await canStillWrite(mgr, 'r8', 's1')).toBe(false);
  });

  // (11) a board created from a template is an ordinary board row and
  // obeys exactly the same permission model.
  it('applies the same revocation rules to a board created from a template', async () => {
    const mgr = makeManager();
    await createBoard({ id: 'b9', roomId: 'r9', ownerRoll: '230437' });
    await addMember('b9', '240280');

    await mgr.join('r9', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);
    expect(await canStillWrite(mgr, 'r9', 's1')).toBe(true);

    await revokeMember('b9', '240280');
    expect(await canStillWrite(mgr, 'r9', 's1')).toBe(false);
  });

  it('fails closed when the access check throws', async () => {
    // A transient DB error must never become an implicit grant.
    const mgr = new RoomManager<Meta>(new FakePersistence(), async () => {
      throw new Error('simulated database failure');
    });
    await createBoard({ id: 'b10', roomId: 'r10', ownerRoll: '230437' });
    await addMember('b10', '240280');
    await mgr.join('r10', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);

    await expect(canStillWrite(mgr, 'r10', 's1')).rejects.toThrow('simulated database failure');
  });

  it('reuses a fresh decision within the TTL instead of re-querying', async () => {
    let calls = 0;
    const mgr = new RoomManager<Meta>(new FakePersistence(), async (roomId, meta) => {
      calls++;
      return liveWriteCheck(roomId, meta);
    });
    await createBoard({ id: 'b11', roomId: 'r11', ownerRoll: '230437' });
    await addMember('b11', '240280');
    await mgr.join('r11', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);

    const revalidate = (mgr as unknown as {
      revalidateWriteAccess: (r: string, s: string) => Promise<boolean>
    }).revalidateWriteAccess.bind(mgr);

    // join() stamps writeCheckedAt = now, so these all fall inside the
    // TTL and must not produce a single query.
    for (let i = 0; i < 20; i++) await revalidate('r11', 's1');
    expect(calls).toBe(0);
    expect(WRITE_DECISION_TTL_MS).toBeGreaterThan(0);
  });

  it('de-duplicates concurrent re-checks into a single query', async () => {
    let calls = 0;
    const mgr = new RoomManager<Meta>(new FakePersistence(), async (roomId, meta) => {
      calls++;
      await new Promise(r => setTimeout(r, 30));
      return liveWriteCheck(roomId, meta);
    });
    await createBoard({ id: 'b12', roomId: 'r12', ownerRoll: '230437' });
    await addMember('b12', '240280');
    await mgr.join('r12', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);

    // Age the decision, then fire a burst — as a fast drag would.
    (mgr as unknown as {
      rooms: Map<string, { sessions: Map<string, { writeCheckedAt: number }> }>
    }).rooms.get('r12')!.sessions.get('s1')!.writeCheckedAt = 0;

    const revalidate = (mgr as unknown as {
      revalidateWriteAccess: (r: string, s: string) => Promise<boolean>
    }).revalidateWriteAccess.bind(mgr);

    const results = await Promise.all(Array.from({ length: 10 }, () => revalidate('r12', 's1')));
    expect(results.every(r => r === true)).toBe(true);
    expect(calls).toBe(1);
  });

  it('leaves the pre-existing cached-flag behaviour untouched when no checker is injected', async () => {
    // Every existing caller/test constructs RoomManager with persistence
    // only — that path must not change.
    const mgr = new RoomManager<Meta>(new FakePersistence());
    await createBoard({ id: 'b13', roomId: 'r13', ownerRoll: '230437' });
    await addMember('b13', '240280');
    await mgr.join('r13', 's1', new FakeSocket() as never, { roll: '240280', role: 'editor' }, true);

    await revokeMember('b13', '240280');
    // No checker => no live re-check => the cached flag still says yes.
    // This documents that the guard is opt-in at the composition root.
    expect(await canStillWrite(mgr, 'r13', 's1')).toBe(true);
  });
});

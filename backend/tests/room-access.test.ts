import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { checkRoomAccess } from '../src/realtime/roomAccess';

// ─────────────────────────────────────────────────────────────────────────
// Regression coverage for a real bug found during Commit 6 manual QA (see
// roomAccess.ts's own bug-fix comment): checkRoomAccess's query used to
// look boards up by `id` while every real caller (the Commit 3 document-
// sync WS path AND the Commit 6 comments WS path) passes `room_id` — a
// DIFFERENT column, always a different value for any board created after
// the room_id backfill. That meant EVERY realtime WebSocket connection was
// closing immediately with "Board not found" in production, and a second,
// related bug meant even a fixed lookup would have failed to recognize
// board members (board_members.board_id needs the real board id, not
// room_id). Neither bug had any test coverage before this file — this
// suite exists specifically to make sure both stay fixed.
//
// NOTE: process.env.REALTIME_ENABLED is NOT set to 'true' by tests/setup.ts
// (it deliberately mirrors production defaults — realtime is opt-in), so
// each test here sets/restores it around the call, since checkRoomAccess's
// very first check is the global kill switch.
// ─────────────────────────────────────────────────────────────────────────

async function createBoard(opts: {
  id: string;
  roomId: string;
  ownerRoll: string;
  visibility?: 'private' | 'shared';
  editMode?: 'members_only' | 'anyone';
  realtimeEnabled?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, realtime_enabled)
     VALUES ($1, 'Room Access Test Board', $2, 'Owner', $3, $4, $5, $5, $6, $7)`,
    [opts.id, opts.ownerRoll, opts.visibility ?? 'private', opts.editMode ?? 'members_only', now, opts.roomId, opts.realtimeEnabled ?? true]
  );
}

async function addMember(boardId: string, roll: string): Promise<void> {
  await query(
    `INSERT INTO board_members (board_id, roll_number, name, added_at) VALUES ($1, $2, $3, $4)`,
    [boardId, roll, `Student ${roll}`, new Date().toISOString()]
  );
}

function tokenFor(roll: string): string {
  return signStudentToken(roll);
}

beforeEach(async () => {
  await query('TRUNCATE "board_members", "boards" CASCADE');
  process.env.REALTIME_ENABLED = 'true';
});

describe('checkRoomAccess', () => {
  it('finds the board by room_id, NOT by id — the exact bug this file guards against', async () => {
    // Deliberately distinct id vs room_id, mirroring every real board
    // (room_id is a separately generated UUID per schema.ts's backfill —
    // never equal to id in practice). Passing board.id here (the old,
    // buggy call shape) must NOT find this board; passing room_id must.
    await createBoard({ id: 'board-A', roomId: 'room-A', ownerRoll: 'OWNER1' });

    const viaRoomId = await checkRoomAccess('room-A', tokenFor('OWNER1'));
    expect(viaRoomId.ok).toBe(true);

    const viaBoardId = await checkRoomAccess('board-A', tokenFor('OWNER1'));
    expect(viaBoardId.ok).toBe(false);
    if (!viaBoardId.ok) expect(viaBoardId.reason).toBe('Board not found');
  });

  it('grants the owner editor access', async () => {
    await createBoard({ id: 'board-B', roomId: 'room-B', ownerRoll: 'OWNER2' });
    const result = await checkRoomAccess('room-B', tokenFor('OWNER2'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('editor');
  });

  it('recognizes a board member — the second half of the same room_id/id bug', async () => {
    // board_members.board_id must be looked up using the real board id
    // (not room_id) internally; this test would have failed under the old
    // buggy code even after "fixing" only the board lookup, since the
    // member query used the wrong id there too.
    await createBoard({ id: 'board-C', roomId: 'room-C', ownerRoll: 'OWNER3', visibility: 'private' });
    await addMember('board-C', 'MEMBER3');

    const result = await checkRoomAccess('room-C', tokenFor('MEMBER3'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('editor');
  });

  it('denies a non-member on a private board', async () => {
    await createBoard({ id: 'board-D', roomId: 'room-D', ownerRoll: 'OWNER4', visibility: 'private' });
    const result = await checkRoomAccess('room-D', tokenFor('STRANGER4'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Access denied');
  });

  it('grants a non-member viewer access on a shared board (read, not write)', async () => {
    await createBoard({ id: 'board-E', roomId: 'room-E', ownerRoll: 'OWNER5', visibility: 'shared', editMode: 'members_only' });
    const result = await checkRoomAccess('room-E', tokenFor('STRANGER5'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('viewer');
  });

  it('grants a non-member editor access on a shared board with edit_mode=anyone', async () => {
    await createBoard({ id: 'board-F', roomId: 'room-F', ownerRoll: 'OWNER6', visibility: 'shared', editMode: 'anyone' });
    const result = await checkRoomAccess('room-F', tokenFor('STRANGER6'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('editor');
  });

  it('rejects when realtime_enabled is false for the board, even with valid access otherwise', async () => {
    await createBoard({ id: 'board-G', roomId: 'room-G', ownerRoll: 'OWNER7', realtimeEnabled: false });
    const result = await checkRoomAccess('room-G', tokenFor('OWNER7'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Realtime is not enabled for this board');
  });

  it('rejects an invalid/missing token before ever querying the board', async () => {
    await createBoard({ id: 'board-H', roomId: 'room-H', ownerRoll: 'OWNER8' });
    const result = await checkRoomAccess('room-H', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Sign in required');
  });

  it('rejects globally when REALTIME_ENABLED is off, regardless of board state', async () => {
    await createBoard({ id: 'board-I', roomId: 'room-I', ownerRoll: 'OWNER9' });
    process.env.REALTIME_ENABLED = 'false';
    const result = await checkRoomAccess('room-I', tokenFor('OWNER9'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Realtime collaboration is disabled');
  });

  it('returns the tldraw-sync NOT_FOUND close code (4099) for an unknown room, not a generic one', async () => {
    const result = await checkRoomAccess('room-does-not-exist', tokenFor('NOBODY'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(4099);
  });
});

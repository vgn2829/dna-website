import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { checkRoomAccess, checkRoomAccessForRoll, getBoardRole, getRoomBoardStatus, roleCanWriteCanvas, roleCanComment } from '../src/realtime/roomAccess';

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
// room_id). Both stay covered here.
//
// Commit 7 extends this suite to cover the new 4-tier role model
// (owner/editor/commenter/viewer), the machine-readable denial reasons
// (see RoomAccessDenialReason), the archived-board write freeze, the
// roll-only re-validation path (checkRoomAccessForRoll), and the
// board.id-keyed equivalent REST endpoints use (getBoardRole).
//
// NOTE: process.env.REALTIME_ENABLED is NOT set to 'true' by tests/setup.ts
// (it deliberately mirrors production defaults — realtime is opt-in), so
// each test here sets/restores it around the call, since checkRoomAccess's
// very first check is the global kill switch.
// ─────────────────────────────────────────────────────────────────────────

// Every board needs a workspace_id (NOT NULL since the workspace-layer
// migration in schema.ts). Tests here don't exercise workspace-ceiling
// access at all (that's room-access.test.ts's own future workspace-role
// coverage, added alongside classifyBoardAccess's workspace branch) — this
// just gives each fixture board a minimal personal workspace owned by the
// same roll, so the owner-branch tests in this file are completely
// unaffected: classifyBoardAccess's isOwner check short-circuits before
// the workspace ceiling is ever consulted.
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
  id: string;
  roomId: string;
  ownerRoll: string;
  visibility?: 'private' | 'shared';
  editMode?: 'members_only' | 'anyone';
  realtimeEnabled?: boolean;
  isArchived?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  const workspaceId = await ensureWorkspace(opts.ownerRoll);
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, realtime_enabled, is_archived, workspace_id)
     VALUES ($1, 'Room Access Test Board', $2, 'Owner', $3, $4, $5, $5, $6, $7, $8, $9)`,
    [
      opts.id, opts.ownerRoll, opts.visibility ?? 'private', opts.editMode ?? 'members_only', now,
      opts.roomId, opts.realtimeEnabled ?? true, opts.isArchived ?? false, workspaceId,
    ]
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
  await query('TRUNCATE "board_members", "boards", "workspace_members", "workspaces" CASCADE');
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
    if (!viaBoardId.ok) expect(viaBoardId.reason).toBe('board_not_found');
  });

  it('grants the owner the owner role', async () => {
    await createBoard({ id: 'board-B', roomId: 'room-B', ownerRoll: 'OWNER2' });
    const result = await checkRoomAccess('room-B', tokenFor('OWNER2'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('owner');
      expect(result.isArchived).toBe(false);
      expect(roleCanWriteCanvas(result.role, result.isArchived)).toBe(true);
      expect(roleCanComment(result.role)).toBe(true);
    }
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
    if (!result.ok) expect(result.reason).toBe('permission_denied');
  });

  it('grants a non-member the commenter role on a shared board (read, not write)', async () => {
    await createBoard({ id: 'board-E', roomId: 'room-E', ownerRoll: 'OWNER5', visibility: 'shared', editMode: 'members_only' });
    const result = await checkRoomAccess('room-E', tokenFor('STRANGER5'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('commenter');
      expect(roleCanWriteCanvas(result.role, result.isArchived)).toBe(false);
      expect(roleCanComment(result.role)).toBe(true);
    }
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
    if (!result.ok) expect(result.reason).toBe('realtime_disabled');
  });

  it('rejects an invalid/missing token before ever querying the board', async () => {
    await createBoard({ id: 'board-H', roomId: 'room-H', ownerRoll: 'OWNER8' });
    const result = await checkRoomAccess('room-H', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('session_expired');
  });

  it('rejects globally when REALTIME_ENABLED is off, regardless of board state', async () => {
    await createBoard({ id: 'board-I', roomId: 'room-I', ownerRoll: 'OWNER9' });
    process.env.REALTIME_ENABLED = 'false';
    const result = await checkRoomAccess('room-I', tokenFor('OWNER9'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('realtime_disabled');
  });

  it('returns the tldraw-sync NOT_FOUND close code (4099) for an unknown room, not a generic one', async () => {
    const result = await checkRoomAccess('room-does-not-exist', tokenFor('NOBODY'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(4099);
  });

  // ── Commit 7 additions ──────────────────────────────────────────────

  it('downgrades a member to commenter (no write) on an archived board', async () => {
    await createBoard({ id: 'board-J', roomId: 'room-J', ownerRoll: 'OWNER10', isArchived: true });
    await addMember('board-J', 'MEMBER10');

    const memberResult = await checkRoomAccess('room-J', tokenFor('MEMBER10'));
    expect(memberResult.ok).toBe(true);
    if (memberResult.ok) {
      expect(memberResult.role).toBe('commenter');
      expect(memberResult.isArchived).toBe(true);
      expect(roleCanWriteCanvas(memberResult.role, memberResult.isArchived)).toBe(false);
    }
  });

  it('REGRESSION: an owner cannot write to an archived board — role stays "owner" (identity), but write capability is correctly false', async () => {
    // This is the exact real bug caught during this commit's own manual QA
    // (not by any test that existed before this one — every earlier
    // assertion here checked `role` alone, never the actual computed write
    // capability). RoomRole is IDENTITY, not capability: an owner of an
    // archived board is still, correctly, 'owner' — they didn't stop
    // owning it — but roleCanWriteCanvas MUST take isArchived as a
    // required second argument and return false here. An earlier version
    // of classifyBoardAccess computed canWrite correctly internally, then
    // discarded it for the owner branch (`isOwner ? 'owner' : ...`), and
    // the old roleCanWriteCanvas(role) was a pure function of role with no
    // is_archived awareness at all — meaning an OWNER of an ARCHIVED board
    // could still write to the live canvas in production. Reproduced live
    // against a real server before fixing (see this commit's own QA
    // scripts), not assumed.
    await createBoard({ id: 'board-K', roomId: 'room-K', ownerRoll: 'OWNER11', isArchived: true });
    const result = await checkRoomAccess('room-K', tokenFor('OWNER11'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('owner'); // identity unchanged
      expect(result.isArchived).toBe(true);
      expect(roleCanWriteCanvas(result.role, result.isArchived)).toBe(false); // capability correctly frozen
    }
  });

  it('rejects a shared board\'s edit_mode=anyone write grant once archived', async () => {
    await createBoard({ id: 'board-L', roomId: 'room-L', ownerRoll: 'OWNER12', visibility: 'shared', editMode: 'anyone', isArchived: true });
    const result = await checkRoomAccess('room-L', tokenFor('STRANGER12'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Would be 'editor' on a non-archived board with edit_mode=anyone —
      // archiving must override that, same rule as a member's downgrade above.
      expect(result.role).toBe('commenter');
      expect(roleCanWriteCanvas(result.role, result.isArchived)).toBe(false);
    }
  });
});

describe('checkRoomAccessForRoll (roll-only re-validation, no token)', () => {
  it('recomputes the same access a full checkRoomAccess call would, given the roll directly', async () => {
    await createBoard({ id: 'board-M', roomId: 'room-M', ownerRoll: 'OWNER13' });
    await addMember('board-M', 'MEMBER13');

    const result = await checkRoomAccessForRoll('room-M', 'MEMBER13');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('editor');
  });

  it('reflects a membership change immediately — the point of periodic re-validation', async () => {
    await createBoard({ id: 'board-N', roomId: 'room-N', ownerRoll: 'OWNER14', visibility: 'private' });
    await addMember('board-N', 'MEMBER14');

    const before = await checkRoomAccessForRoll('room-N', 'MEMBER14');
    expect(before.ok).toBe(true);

    await query('DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2', ['board-N', 'MEMBER14']);

    const after = await checkRoomAccessForRoll('room-N', 'MEMBER14');
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe('permission_denied');
  });

  it('reflects a board being archived immediately (downgrade, not disconnect)', async () => {
    await createBoard({ id: 'board-O', roomId: 'room-O', ownerRoll: 'OWNER15' });
    await addMember('board-O', 'MEMBER15');

    const before = await checkRoomAccessForRoll('room-O', 'MEMBER15');
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.role).toBe('editor');

    await query('UPDATE boards SET is_archived = true WHERE id = $1', ['board-O']);

    const after = await checkRoomAccessForRoll('room-O', 'MEMBER15');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.role).toBe('commenter');
  });

  it('reflects a board being deleted immediately (full disconnect)', async () => {
    await createBoard({ id: 'board-P', roomId: 'room-P', ownerRoll: 'OWNER16' });

    const before = await checkRoomAccessForRoll('room-P', 'OWNER16');
    expect(before.ok).toBe(true);

    await query('DELETE FROM boards WHERE id = $1', ['board-P']);

    const after = await checkRoomAccessForRoll('room-P', 'OWNER16');
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe('board_not_found');
  });

  it('still honors the global REALTIME_ENABLED kill switch', async () => {
    await createBoard({ id: 'board-Q', roomId: 'room-Q', ownerRoll: 'OWNER17' });
    process.env.REALTIME_ENABLED = 'false';
    const result = await checkRoomAccessForRoll('room-Q', 'OWNER17');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('realtime_disabled');
  });
});

describe('getBoardRole (board.id-keyed, used by REST endpoints)', () => {
  it('returns the same classification as checkRoomAccess, keyed by board id instead of room_id', async () => {
    await createBoard({ id: 'board-R', roomId: 'room-R', ownerRoll: 'OWNER18', visibility: 'shared', editMode: 'members_only' });
    const result = await getBoardRole('board-R', 'STRANGER18');
    expect(result?.role).toBe('commenter');
    expect(result?.isArchived).toBe(false);
  });

  it('returns null for no read access', async () => {
    await createBoard({ id: 'board-S', roomId: 'room-S', ownerRoll: 'OWNER19', visibility: 'private' });
    const result = await getBoardRole('board-S', 'STRANGER19');
    expect(result).toBeNull();
  });

  it('returns null for a nonexistent board', async () => {
    const result = await getBoardRole('does-not-exist', 'NOBODY');
    expect(result).toBeNull();
  });

  it('does NOT consult the REALTIME_ENABLED flag — REST endpoints are not gated by the realtime kill switch', async () => {
    await createBoard({ id: 'board-T', roomId: 'room-T', ownerRoll: 'OWNER20', realtimeEnabled: false });
    process.env.REALTIME_ENABLED = 'false';
    const result = await getBoardRole('board-T', 'OWNER20');
    expect(result?.role).toBe('owner');
  });

  it('reflects the archived-board write freeze for a member, closing the gap the old routes/versions.ts canEditBoard helper had', async () => {
    await createBoard({ id: 'board-U', roomId: 'room-U', ownerRoll: 'OWNER21', isArchived: true });
    await addMember('board-U', 'MEMBER21');
    const result = await getBoardRole('board-U', 'MEMBER21');
    expect(result?.role).toBe('commenter');
    expect(roleCanWriteCanvas(result!.role, result!.isArchived)).toBe(false);
  });

  it('REGRESSION: reflects the archived-board write freeze for the OWNER too, not just members', async () => {
    // Same bug class as the checkRoomAccess regression test above — the
    // board.id-keyed path must independently get this right too, since
    // routes/comments.ts and routes/versions.ts call getBoardRole
    // directly, not checkRoomAccess.
    await createBoard({ id: 'board-U2', roomId: 'room-U2', ownerRoll: 'OWNER21B', isArchived: true });
    const result = await getBoardRole('board-U2', 'OWNER21B');
    expect(result?.role).toBe('owner');
    expect(result?.isArchived).toBe(true);
    expect(roleCanWriteCanvas(result!.role, result!.isArchived)).toBe(false);
  });
});

describe('getRoomBoardStatus (REST pre-check helper)', () => {
  it('reports exists:false for an unknown room', async () => {
    const status = await getRoomBoardStatus('room-does-not-exist');
    expect(status).toEqual({ exists: false });
  });

  it('reports isArchived accurately', async () => {
    await createBoard({ id: 'board-V', roomId: 'room-V', ownerRoll: 'OWNER22', isArchived: true });
    const status = await getRoomBoardStatus('room-V');
    expect(status).toEqual({ exists: true, isArchived: true });
  });
});

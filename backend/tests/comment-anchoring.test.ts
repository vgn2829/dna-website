import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { CommentBroadcaster } from '../src/realtime/comments/commentBroadcaster';
import type { VersionHistoryService } from '../src/realtime/history/versionHistoryService';
import type { RestoreService } from '../src/realtime/history/restoreService';

// ─────────────────────────────────────────────────────────────────────────
// PAGE-AWARE COMMENT ANCHORS (V2.6 Phase B).
//
// THE BUG THIS LOCKS DOWN, reproduced against the real router before the
// fix: nothing recorded which tldraw page a comment belonged to. The
// create endpoint silently dropped an anchorPageId, board_comments had no
// page column at all, and the list endpoint had no page dimension to
// filter on — so a comment pinned on Page A rendered at the same
// coordinates on every other page of a multi-page board. tldraw's page
// menu is available to users, so this was reachable in normal use.
//
// COMPATIBILITY RULE (the reason anchor_page_id is nullable and is NOT
// backfilled): a NULL page means "created before pages were tracked".
// Those legacy comments keep rendering on EVERY page — exactly their
// pre-Phase-B behaviour — rather than being guessed onto one page and
// silently vanishing from the others. Every new comment carries a real
// page, so the ambiguous set is fixed and never grows. The rendering half
// of this rule lives in CommentsOverlay's visibleThreads filter; this
// suite covers the persistence/API half.
//
// ORPHANS are deliberately NOT a stored field: whether an anchored shape
// still exists is live tldraw state, so it is derived at render time
// (CommentsOverlay.pinPageXY -> { orphaned }) rather than denormalised
// into a column that could go stale. These tests therefore assert that the
// anchor data needed to survive a deleted shape is preserved.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp({
  versionHistoryService: {} as VersionHistoryService,
  restoreService: {} as RestoreService,
  commentBroadcaster: new CommentBroadcaster(),
});

const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const OWNER = '230437';
const MEMBER = '240280';

const PAGE_A = 'page:aaaaaaaaaaaaaaaaaaaaa';
const PAGE_B = 'page:bbbbbbbbbbbbbbbbbbbbb';

// Real UUID — the route validates parentCommentId as a uuid, and every
// genuine pre-Phase-B row has one (createComment used uuidv4()).
const LEGACY_ROOT_ID = '22222222-2222-4222-8222-222222222222';

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1,$2,'01 Jan 2026',$3,$4) ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

async function createBoard(ownerRoll: string): Promise<string> {
  const id = `board-anch-${Math.random().toString(36).slice(2, 10)}`;
  const wsId = `ws-anch-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  await query(`INSERT INTO workspaces (id,name,is_personal,owner_roll,created_at) VALUES ($1,'WS',true,$2,$3)`, [wsId, ownerRoll, now]);
  await query(`INSERT INTO workspace_members (workspace_id,roll_number,role,name,added_at) VALUES ($1,$2,'owner','Owner',$3)`, [wsId, ownerRoll, now]);
  await query(
    `INSERT INTO boards (id,name,owner_roll,owner_name,visibility,edit_mode,created_at,updated_at,room_id,workspace_id)
     VALUES ($1,'Anchoring Board',$2,'Owner','private','members_only',$3,$3,$4,$5)`,
    [id, ownerRoll, now, `room-${id}`, wsId]
  );
  return id;
}

const post = (boardId: string, roll: string, body: Record<string, unknown>) =>
  request(app).post(`/api/boards/${boardId}/comments`).set(auth(roll)).send(body);

const list = (boardId: string, roll: string) =>
  request(app).get(`/api/boards/${boardId}/comments`).set(auth(roll));

beforeEach(async () => {
  await query('TRUNCATE "board_comments","board_members","boards","workspace_members","workspaces" CASCADE');
  process.env.REALTIME_ENABLED = 'true';
  await Promise.all([registerStudent(OWNER), registerStudent(MEMBER)]);
});

describe('page-aware comment anchors', () => {
  it('persists the page a canvas-anchored comment was created on', async () => {
    const boardId = await createBoard(OWNER);
    const res = await post(boardId, OWNER, {
      content: 'on page A', anchorType: 'canvas', anchorX: 10, anchorY: 20, anchorPageId: PAGE_A,
    });
    expect(res.status).toBe(201);
    expect(res.body.anchorPageId).toBe(PAGE_A);

    const rows = await query<{ anchor_page_id: string | null }>(
      'SELECT anchor_page_id FROM board_comments WHERE id = $1', [res.body.id]
    );
    expect(rows[0].anchor_page_id).toBe(PAGE_A);
  });

  it('persists the page a shape-anchored comment was created on', async () => {
    const boardId = await createBoard(OWNER);
    const res = await post(boardId, OWNER, {
      content: 'on shape', anchorType: 'shape', anchorShapeId: 'shape:abc',
      anchorX: 5, anchorY: 6, anchorPageId: PAGE_B,
    });
    expect(res.status).toBe(201);
    expect(res.body.anchorPageId).toBe(PAGE_B);
    expect(res.body.anchorShapeId).toBe('shape:abc');
  });

  it('returns the page identity on the list endpoint so the client can filter', async () => {
    const boardId = await createBoard(OWNER);
    await post(boardId, OWNER, { content: 'A', anchorType: 'canvas', anchorX: 1, anchorY: 1, anchorPageId: PAGE_A });
    await post(boardId, OWNER, { content: 'B', anchorType: 'canvas', anchorX: 2, anchorY: 2, anchorPageId: PAGE_B });

    const res = await list(boardId, OWNER);
    expect(res.status).toBe(200);
    const pages = res.body.comments.map((c: { anchorPageId: string | null }) => c.anchorPageId).sort();
    expect(pages).toEqual([PAGE_A, PAGE_B]);
  });

  it('inherits the root\'s page on a reply, so a thread can never span pages', async () => {
    const boardId = await createBoard(OWNER);
    const root = await post(boardId, OWNER, {
      content: 'root on A', anchorType: 'canvas', anchorX: 1, anchorY: 1, anchorPageId: PAGE_A,
    });

    // The reply claims a DIFFERENT page; the server must ignore that and
    // inherit from the root, exactly as it already does for coordinates.
    const reply = await post(boardId, OWNER, {
      content: 'reply', parentCommentId: root.body.id, anchorPageId: PAGE_B,
    });
    expect(reply.status).toBe(201);
    expect(reply.body.anchorPageId).toBe(PAGE_A);
  });

  // ── Legacy compatibility ────────────────────────────────────────────
  it('leaves a pre-existing comment\'s page NULL (no destructive backfill)', async () => {
    const boardId = await createBoard(OWNER);
    // Simulates a row written before Phase B existed.
    const now = new Date().toISOString();
    await query(
      `INSERT INTO board_comments
         (id, board_id, author_roll, author_name, created_at, updated_at,
          anchor_type, anchor_x, anchor_y, content)
       VALUES ('11111111-1111-4111-8111-111111111111',$1,$2,'Owner',$3,$3,'canvas',50,60,'legacy comment')`,
      [boardId, OWNER, now]
    );

    const res = await list(boardId, OWNER);
    const legacy = res.body.comments.find((c: { id: string }) => c.id === '11111111-1111-4111-8111-111111111111');
    expect(legacy).toBeDefined();
    // NULL is the signal the renderer uses to show it on every page.
    expect(legacy.anchorPageId).toBeNull();
  });

  it('keeps a legacy thread legacy: a reply to a NULL-page root also has a NULL page', async () => {
    const boardId = await createBoard(OWNER);
    const now = new Date().toISOString();
    await query(
      `INSERT INTO board_comments
         (id, board_id, author_roll, author_name, created_at, updated_at,
          anchor_type, anchor_x, anchor_y, content)
       VALUES ($4,$1,$2,'Owner',$3,$3,'canvas',10,10,'legacy root')`,
      [boardId, OWNER, now, LEGACY_ROOT_ID]
    );

    const reply = await post(boardId, OWNER, {
      content: 'reply to legacy', parentCommentId: LEGACY_ROOT_ID, anchorPageId: PAGE_A,
    });
    expect(reply.status).toBe(201);
    // Inherited NULL — the whole thread keeps behaving as it did before.
    expect(reply.body.anchorPageId).toBeNull();
  });

  it('accepts a comment with no page at all (older client), storing NULL', async () => {
    const boardId = await createBoard(OWNER);
    const res = await post(boardId, OWNER, {
      content: 'no page sent', anchorType: 'canvas', anchorX: 3, anchorY: 4,
    });
    expect(res.status).toBe(201);
    expect(res.body.anchorPageId).toBeNull();
  });

  // ── Orphan support (the data half) ──────────────────────────────────
  it('preserves the last known coordinates of a shape anchor, so a deleted shape can still be located', async () => {
    const boardId = await createBoard(OWNER);
    const res = await post(boardId, OWNER, {
      content: 'anchored', anchorType: 'shape', anchorShapeId: 'shape:gone',
      anchorX: 321, anchorY: 654, anchorPageId: PAGE_A,
    });
    // The client derives `orphaned` by looking the shape up in live tldraw
    // state; these stored fields are what let it still draw the pin.
    expect(res.body.anchorType).toBe('shape');
    expect(res.body.anchorShapeId).toBe('shape:gone');
    expect(res.body.anchorX).toBe(321);
    expect(res.body.anchorY).toBe(654);
    expect(res.body.anchorPageId).toBe(PAGE_A);
  });

  it('keeps the anchor intact across edit and resolve/reopen', async () => {
    const boardId = await createBoard(OWNER);
    const created = await post(boardId, OWNER, {
      content: 'original', anchorType: 'shape', anchorShapeId: 'shape:keep',
      anchorX: 11, anchorY: 22, anchorPageId: PAGE_B,
    });
    const id = created.body.id;

    const edited = await request(app)
      .put(`/api/boards/${boardId}/comments/${id}`).set(auth(OWNER)).send({ content: 'edited' });
    expect(edited.status).toBe(200);
    expect(edited.body.anchorPageId).toBe(PAGE_B);
    expect(edited.body.anchorShapeId).toBe('shape:keep');

    const resolved = await request(app)
      .post(`/api/boards/${boardId}/comments/${id}/resolve`).set(auth(OWNER));
    expect(resolved.status).toBe(200);
    expect(resolved.body.anchorPageId).toBe(PAGE_B);

    const reopened = await request(app)
      .post(`/api/boards/${boardId}/comments/${id}/reopen`).set(auth(OWNER));
    expect(reopened.status).toBe(200);
    expect(reopened.body.anchorPageId).toBe(PAGE_B);
  });

  it('rejects an over-long page id rather than storing it', async () => {
    const boardId = await createBoard(OWNER);
    const res = await post(boardId, OWNER, {
      content: 'bad page', anchorType: 'canvas', anchorX: 1, anchorY: 1,
      anchorPageId: 'p'.repeat(500),
    });
    expect(res.status).toBe(400);
  });

  it('does not let page identity leak a comment across boards', async () => {
    // Page ids are per-board tldraw records; listing is board-scoped, so
    // the same page id on two boards must not merge their comments.
    const boardA = await createBoard(OWNER);
    const boardB = await createBoard(OWNER);
    await post(boardA, OWNER, { content: 'on board A', anchorType: 'canvas', anchorX: 1, anchorY: 1, anchorPageId: PAGE_A });
    await post(boardB, OWNER, { content: 'on board B', anchorType: 'canvas', anchorX: 1, anchorY: 1, anchorPageId: PAGE_A });

    const resA = await list(boardA, OWNER);
    expect(resA.body.comments).toHaveLength(1);
    expect(resA.body.comments[0].content).toBe('on board A');
  });
});

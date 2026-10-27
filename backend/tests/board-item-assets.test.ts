import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { settleDerivativeJobs } from '../src/storage/derivatives';

// ─────────────────────────────────────────────────────────────────────────
// Assets "Add to Moodboard" (boards.ts POST /:id/items with asset_id),
// through the real HTTP router, the local test DB and LocalStorageProvider.
//
// The server resolves the asset itself: it must be an image the caller may
// use on the BOARD's workspace (the same rule as the board's own asset
// picker), the board must be writable by the caller, the stored URL is the
// asset's own original (never a client-supplied one), and the asset's
// visibility is never touched. A repeat add while the item is still
// pending returns the existing row instead of stacking a duplicate.
//
// Cast: ALICE owns personal workspace p-alice and team TEAM; BOB is a
// member of TEAM and of STUDIO (owned by DAVE); EVE has only her own
// personal workspace.
// ─────────────────────────────────────────────────────────────────────────

afterEach(async () => { await settleDerivativeJobs(); });

const app = createApp();
const request = localRequest(app);
const auth = (roll: string) => ({ Authorization: `Bearer ${signStudentToken(roll)}` });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

const upload = async (roll: string, ws: string, visibility = 'personal') => {
  const res = await request(app).post('/api/assets').set(auth(roll))
    .field('workspace_id', ws).field('visibility', visibility)
    .attach('file', PNG, { filename: 'mark.png', contentType: 'image/png' });
  expect(res.status).toBe(201);
  return res.body as { id: string; url: string; download_url: string | null; visibility: string };
};
const addAsset = (roll: string, boardId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/boards/${boardId}/items`).set(auth(roll)).send(body);
const itemRows = async (boardId: string) =>
  query('SELECT * FROM board_items WHERE board_id = $1 ORDER BY created_at', [boardId]) as Promise<Array<{ id: string; image_url: string; note: string | null; added_by_roll: string }>>;

let boardSeq = 0;
async function createBoard(owner: string, ws: string, opts: { visibility?: 'private' | 'shared' } = {}) {
  const id = `board-${++boardSeq}-${Date.now()}`;
  await query(
    `INSERT INTO boards (id, name, owner_roll, owner_name, visibility, edit_mode, created_at, updated_at, room_id, is_archived, workspace_id)
     VALUES ($1, 'Board', $2, $2, $3, 'members_only', now(), now(), $4, false, $5)`,
    [id, owner, opts.visibility ?? 'private', `room-${id}`, ws]
  );
  return id;
}

beforeEach(async () => {
  await query('TRUNCATE "board_items", "board_versions", "board_members", "boards", "templates", "assets", "asset_collections", "workspace_members", "workspaces" CASCADE');
  for (const roll of ['ALICE', 'BOB', 'DAVE', 'EVE']) {
    await query(
      `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
       VALUES ($1, $2, '01 Jan 2026', $1, $3) ON CONFLICT (roll_number) DO NOTHING`,
      [roll, `IITK-DnA-${roll}-AAAA`, `${roll.toLowerCase()}@iitk.ac.in`]
    );
  }
  await query(`INSERT INTO workspaces(id, name, is_personal, owner_roll, created_at) VALUES
    ('p-alice', 'Alice', true, 'ALICE', now()), ('p-eve', 'Eve', true, 'EVE', now()),
    ('team', 'Team', false, 'ALICE', now()), ('studio', 'Studio', false, 'DAVE', now())`);
  await query(`INSERT INTO workspace_members(workspace_id, roll_number, role, added_at) VALUES
    ('p-alice', 'ALICE', 'owner', now()), ('p-eve', 'EVE', 'owner', now()),
    ('team', 'ALICE', 'owner', now()), ('team', 'BOB', 'member', now()),
    ('studio', 'DAVE', 'owner', now()), ('studio', 'BOB', 'member', now())`);
});

describe('adding a library asset to a moodboard', () => {
  it('stores the asset’s own original URL and filename as a pending item', async () => {
    const asset = await upload('ALICE', 'p-alice');
    const board = await createBoard('ALICE', 'p-alice');

    // A client-supplied image_url alongside asset_id is ignored.
    const res = await addAsset('ALICE', board, { asset_id: asset.id, image_url: 'https://evil.example/x.png', source_url: 'https://www.dnaiitk.site/assets' });
    expect(res.status).toBe(201);
    expect(res.body.image_url).toBe(asset.url);
    expect(res.body.note).toBe('mark.png');
    expect(res.body.source_url).toBe('https://www.dnaiitk.site/assets');
    expect(res.body.placed_at).toBeNull();
    expect(res.body.duplicate).toBeUndefined();

    // It shows up as a pending item the canvas materializes on load.
    const detail = await request(app).get(`/api/boards/${board}`).set(auth('ALICE'));
    expect(detail.body.items.map((i: { image_url: string }) => i.image_url)).toEqual([asset.url]);
  });

  it('never changes the asset’s visibility', async () => {
    const asset = await upload('ALICE', 'p-alice');
    const board = await createBoard('ALICE', 'p-alice');
    expect((await addAsset('ALICE', board, { asset_id: asset.id })).status).toBe(201);
    const [row] = await query('SELECT visibility, status FROM assets WHERE id = $1', [asset.id]) as Array<{ visibility: string; status: string }>;
    expect(row).toEqual({ visibility: 'personal', status: 'active' });
  });

  it('a repeat add while the item is still pending returns the existing row', async () => {
    const asset = await upload('ALICE', 'p-alice');
    const board = await createBoard('ALICE', 'p-alice');
    const first = await addAsset('ALICE', board, { asset_id: asset.id });
    const again = await addAsset('ALICE', board, { asset_id: asset.id });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.id).toBe(first.body.id);
    expect(await itemRows(board)).toHaveLength(1);
  });

  it('concurrent adds of the same asset create exactly one item', async () => {
    const asset = await upload('ALICE', 'p-alice');
    const board = await createBoard('ALICE', 'p-alice');
    const results = await Promise.all([1, 2, 3, 4].map(() => addAsset('ALICE', board, { asset_id: asset.id })));
    expect(results.map(r => r.status).sort()).toEqual([200, 200, 200, 201]);
    expect(await itemRows(board)).toHaveLength(1);
  });

  it('once placed on the canvas, adding it again creates a new item', async () => {
    const asset = await upload('ALICE', 'p-alice');
    const board = await createBoard('ALICE', 'p-alice');
    const first = await addAsset('ALICE', board, { asset_id: asset.id });
    await query('UPDATE board_items SET placed_at = now() WHERE id = $1', [first.body.id]);
    const again = await addAsset('ALICE', board, { asset_id: asset.id });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(first.body.id);
    expect(await itemRows(board)).toHaveLength(2);
  });

  it('the same asset can go onto two different boards', async () => {
    const asset = await upload('ALICE', 'p-alice');
    const a = await createBoard('ALICE', 'p-alice');
    const b = await createBoard('ALICE', 'p-alice');
    expect((await addAsset('ALICE', a, { asset_id: asset.id })).status).toBe(201);
    expect((await addAsset('ALICE', b, { asset_id: asset.id })).status).toBe(201);
  });
});

describe('asset visibility is enforced against the board’s workspace', () => {
  it('a Personal asset only goes onto boards in its own workspace', async () => {
    const asset = await upload('ALICE', 'p-alice');
    const teamBoard = await createBoard('ALICE', 'team');
    const res = await addAsset('ALICE', teamBoard, { asset_id: asset.id });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Asset not available on this board');
    expect(await itemRows(teamBoard)).toHaveLength(0);
  });

  it('another member’s Personal asset is refused as if it did not exist', async () => {
    const asset = await upload('ALICE', 'team');
    const bobBoard = await createBoard('BOB', 'team');
    expect((await addAsset('BOB', bobBoard, { asset_id: asset.id })).status).toBe(404);
    expect(await itemRows(bobBoard)).toHaveLength(0);
  });

  it('a Workspace asset reaches boards in its workspace, not other workspaces', async () => {
    const asset = await upload('ALICE', 'team', 'workspace');
    const teamBoard = await createBoard('BOB', 'team');
    const studioBoard = await createBoard('BOB', 'studio');
    expect((await addAsset('BOB', teamBoard, { asset_id: asset.id })).status).toBe(201);
    expect((await addAsset('BOB', studioBoard, { asset_id: asset.id })).status).toBe(404);
    expect(await itemRows(studioBoard)).toHaveLength(0);
  });

  it('a Workspace asset explicitly shared into another workspace reaches its boards', async () => {
    const asset = await upload('ALICE', 'p-alice', 'workspace');
    const teamBoard = await createBoard('BOB', 'team');
    expect((await addAsset('BOB', teamBoard, { asset_id: asset.id })).status).toBe(404);
    expect((await request(app).put(`/api/assets/${asset.id}/shares/team`).set(auth('ALICE'))).status).toBe(204);
    expect((await addAsset('BOB', teamBoard, { asset_id: asset.id })).status).toBe(201);
  });

  it('a Community asset reaches any board in a workspace the caller belongs to', async () => {
    const asset = await upload('ALICE', 'team', 'community');
    const eveBoard = await createBoard('EVE', 'p-eve');
    expect((await addAsset('EVE', eveBoard, { asset_id: asset.id })).status).toBe(201);
    const [row] = await query('SELECT visibility FROM assets WHERE id = $1', [asset.id]) as Array<{ visibility: string }>;
    expect(row.visibility).toBe('community');
  });

  it('a hidden (moderated) asset is refused', async () => {
    const asset = await upload('ALICE', 'team', 'community');
    await query(`UPDATE assets SET status = 'hidden' WHERE id = $1`, [asset.id]);
    const eveBoard = await createBoard('EVE', 'p-eve');
    expect((await addAsset('EVE', eveBoard, { asset_id: asset.id })).status).toBe(404);
  });

  it('files, links and unknown ids are refused — only images go on a board', async () => {
    const board = await createBoard('ALICE', 'p-alice');
    const file = await request(app).post('/api/assets').set(auth('ALICE'))
      .field('workspace_id', 'p-alice').field('kind', 'file')
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'brief.pdf', contentType: 'application/pdf' });
    expect(file.status).toBe(201);
    const link = await request(app).post('/api/assets/links').set(auth('ALICE'))
      .send({ workspace_id: 'p-alice', name: 'Ref', url: 'https://www.behance.net/gallery/1' });
    expect(link.status).toBe(201);
    for (const id of [file.body.id, link.body.id, 'no-such-asset']) {
      expect((await addAsset('ALICE', board, { asset_id: id })).status).toBe(404);
    }
    expect(await itemRows(board)).toHaveLength(0);
  });
});

describe('board write permission still decides first', () => {
  it('a viewer of a shared board cannot add to it', async () => {
    const asset = await upload('BOB', 'team', 'community');
    const aliceShared = await createBoard('ALICE', 'p-alice', { visibility: 'shared' });
    const res = await addAsset('BOB', aliceShared, { asset_id: asset.id });
    expect(res.status).toBe(403);
    expect(await itemRows(aliceShared)).toHaveLength(0);
  });

  it('a stranger’s private board is refused', async () => {
    const asset = await upload('EVE', 'p-eve', 'community');
    const aliceBoard = await createBoard('ALICE', 'p-alice');
    expect((await addAsset('EVE', aliceBoard, { asset_id: asset.id })).status).toBe(403);
  });

  it('requires a signed-in student', async () => {
    const asset = await upload('ALICE', 'p-alice');
    const board = await createBoard('ALICE', 'p-alice');
    expect((await request(app).post(`/api/boards/${board}/items`).send({ asset_id: asset.id })).status).toBe(401);
  });

  it('an empty body is a 400', async () => {
    const board = await createBoard('ALICE', 'p-alice');
    expect((await addAsset('ALICE', board, {})).status).toBe(400);
  });
});

describe('Gallery “Save to Moodboard” is unchanged', () => {
  it('still stores the given image_url and does not dedupe', async () => {
    const board = await createBoard('ALICE', 'p-alice');
    const body = { image_url: 'https://example.com/art.png', note: 'from gallery', source_url: 'https://www.dnaiitk.site/gallery' };
    const a = await addAsset('ALICE', board, body);
    const b = await addAsset('ALICE', board, body);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.image_url).toBe('https://example.com/art.png');
    expect(a.body.note).toBe('from gallery');
    expect(await itemRows(board)).toHaveLength(2);
  });
});

describe('download_url', () => {
  it('images get one, files reuse their download url, links have none', async () => {
    const image = await upload('ALICE', 'p-alice');
    expect(typeof image.download_url).toBe('string');
    const file = await request(app).post('/api/assets').set(auth('ALICE'))
      .field('workspace_id', 'p-alice').field('kind', 'file')
      .attach('file', Buffer.from('PK test'), { filename: 'kit.zip', contentType: 'application/zip' });
    expect(file.body.download_url).toBe(file.body.url);
    const link = await request(app).post('/api/assets/links').set(auth('ALICE'))
      .send({ workspace_id: 'p-alice', name: 'Ref', url: 'https://www.behance.net/gallery/1' });
    expect(link.body.download_url).toBeNull();
  });
});

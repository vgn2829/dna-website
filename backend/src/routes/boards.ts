import { Router } from 'express';
import { pool } from '../db/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id          TEXT PRIMARY KEY,
        owner_roll  TEXT NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        visibility  TEXT NOT NULL DEFAULT 'private',
        created_at  TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS board_members (
        board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        roll_number TEXT NOT NULL,
        added_at    TEXT NOT NULL,
        PRIMARY KEY (board_id, roll_number)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS board_items (
        id            TEXT PRIMARY KEY,
        board_id      TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        added_by_roll TEXT NOT NULL,
        image_url     TEXT NOT NULL,
        note          TEXT,
        source_url    TEXT,
        added_at      TEXT NOT NULL
      )
    `);
  } catch (err) {
    console.error('Board tables init error:', err);
  }
})();

const boardSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  visibility: z.enum(['private', 'shared']).default('private'),
});

const itemSchema = z.object({
  image_url: z.string().min(1),
  note: z.string().max(500).optional(),
  source_url: z.string().optional(),
});

// GET / — list boards owned by or shared with the roll
router.get('/', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;
  if (!roll) return res.status(401).json({ error: 'Roll number required' });

  try {
    const result = await pool.query(`
      SELECT DISTINCT
        b.id, b.owner_roll, b.name, b.description,
        b.visibility, b.created_at,
        ss.name as owner_name,
        COUNT(bi.id)::int as item_count
      FROM boards b
      LEFT JOIN student_sessions ss ON b.owner_roll = ss.roll_number
      LEFT JOIN board_items bi ON b.id = bi.board_id
      LEFT JOIN board_members bm ON b.id = bm.board_id
      WHERE b.owner_roll = $1 OR bm.roll_number = $1
      GROUP BY b.id, ss.name
      ORDER BY b.created_at DESC
    `, [roll]);

    res.json(result.rows);
  } catch (err) {
    console.error('List boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create a board
router.post('/', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;
  if (!roll) return res.status(401).json({ error: 'Roll number required' });

  try {
    const parsed = boardSchema.parse(req.body);
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO boards (id, owner_roll, name, description, visibility, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [id, roll, parsed.name, parsed.description ?? null, parsed.visibility, now]);

    res.status(201).json({ ...result.rows[0], item_count: 0, owner_name: null });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error('Create board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id — get board detail with items and members
router.get('/:id', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;

  try {
    const boardResult = await pool.query(`
      SELECT b.*, ss.name as owner_name
      FROM boards b
      LEFT JOIN student_sessions ss ON b.owner_roll = ss.roll_number
      WHERE b.id = $1
    `, [req.params.id]);

    if (boardResult.rows.length === 0) return res.status(404).json({ error: 'Board not found' });

    const board = boardResult.rows[0];

    if (board.visibility === 'private') {
      if (!roll) return res.status(403).json({ error: 'Private board' });
      if (board.owner_roll !== roll) {
        const memberCheck = await pool.query(
          'SELECT 1 FROM board_members WHERE board_id = $1 AND roll_number = $2',
          [req.params.id, roll]
        );
        if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Private board' });
      }
    }

    const [itemsResult, membersResult] = await Promise.all([
      pool.query(`
        SELECT bi.*, ss.name as added_by_name
        FROM board_items bi
        LEFT JOIN student_sessions ss ON bi.added_by_roll = ss.roll_number
        WHERE bi.board_id = $1
        ORDER BY bi.added_at DESC
      `, [req.params.id]),
      pool.query(`
        SELECT bm.roll_number, bm.added_at, ss.name
        FROM board_members bm
        LEFT JOIN student_sessions ss ON bm.roll_number = ss.roll_number
        WHERE bm.board_id = $1
        ORDER BY bm.added_at ASC
      `, [req.params.id]),
    ]);

    res.json({ ...board, items: itemsResult.rows, members: membersResult.rows });
  } catch (err) {
    console.error('Get board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — delete board (owner only)
router.delete('/:id', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;
  if (!roll) return res.status(401).json({ error: 'Roll number required' });

  try {
    const boardCheck = await pool.query('SELECT owner_roll FROM boards WHERE id = $1', [req.params.id]);
    if (boardCheck.rows.length === 0) return res.status(404).json({ error: 'Board not found' });
    if (boardCheck.rows[0].owner_roll !== roll) return res.status(403).json({ error: 'Not the owner' });

    await pool.query('DELETE FROM boards WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/items — list items
router.get('/:id/items', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;

  try {
    const boardResult = await pool.query('SELECT * FROM boards WHERE id = $1', [req.params.id]);
    if (boardResult.rows.length === 0) return res.status(404).json({ error: 'Board not found' });

    const board = boardResult.rows[0];

    if (board.visibility === 'private') {
      if (!roll) return res.status(403).json({ error: 'Private board' });
      if (board.owner_roll !== roll) {
        const memberCheck = await pool.query(
          'SELECT 1 FROM board_members WHERE board_id = $1 AND roll_number = $2',
          [req.params.id, roll]
        );
        if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Private board' });
      }
    }

    const result = await pool.query(`
      SELECT bi.*, ss.name as added_by_name
      FROM board_items bi
      LEFT JOIN student_sessions ss ON bi.added_by_roll = ss.roll_number
      WHERE bi.board_id = $1
      ORDER BY bi.added_at DESC
    `, [req.params.id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Get items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/items — add item (owner or member)
router.post('/:id/items', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;
  if (!roll) return res.status(401).json({ error: 'Roll number required' });

  try {
    const boardResult = await pool.query('SELECT * FROM boards WHERE id = $1', [req.params.id]);
    if (boardResult.rows.length === 0) return res.status(404).json({ error: 'Board not found' });

    const board = boardResult.rows[0];

    if (board.owner_roll !== roll) {
      const memberCheck = await pool.query(
        'SELECT 1 FROM board_members WHERE board_id = $1 AND roll_number = $2',
        [req.params.id, roll]
      );
      if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Not a member' });
    }

    const parsed = itemSchema.parse(req.body);
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO board_items (id, board_id, added_by_roll, image_url, note, source_url, added_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, req.params.id, roll, parsed.image_url, parsed.note ?? null, parsed.source_url || null, now]);

    const nameResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1', [roll]
    );

    res.status(201).json({ ...result.rows[0], added_by_name: nameResult.rows[0]?.name ?? null });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error('Add item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id/items/:itemId — delete item (board owner or item owner)
router.delete('/:id/items/:itemId', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;
  if (!roll) return res.status(401).json({ error: 'Roll number required' });

  try {
    const boardResult = await pool.query('SELECT owner_roll FROM boards WHERE id = $1', [req.params.id]);
    if (boardResult.rows.length === 0) return res.status(404).json({ error: 'Board not found' });

    const itemResult = await pool.query(
      'SELECT added_by_roll FROM board_items WHERE id = $1 AND board_id = $2',
      [req.params.itemId, req.params.id]
    );
    if (itemResult.rows.length === 0) return res.status(404).json({ error: 'Item not found' });

    const isOwner = boardResult.rows[0].owner_roll === roll;
    const isItemOwner = itemResult.rows[0].added_by_roll === roll;

    if (!isOwner && !isItemOwner) return res.status(403).json({ error: 'Not authorized' });

    await pool.query('DELETE FROM board_items WHERE id = $1', [req.params.itemId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/members — add member (owner only)
router.post('/:id/members', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;
  if (!roll) return res.status(401).json({ error: 'Roll number required' });

  try {
    const boardResult = await pool.query('SELECT owner_roll FROM boards WHERE id = $1', [req.params.id]);
    if (boardResult.rows.length === 0) return res.status(404).json({ error: 'Board not found' });
    if (boardResult.rows[0].owner_roll !== roll) return res.status(403).json({ error: 'Not the owner' });

    const parsed = z.object({ roll_number: z.string().min(1) }).parse(req.body);

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1', [parsed.roll_number]
    );
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found — they must register first' });

    const now = new Date().toISOString();
    await pool.query(`
      INSERT INTO board_members (board_id, roll_number, added_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (board_id, roll_number) DO NOTHING
    `, [req.params.id, parsed.roll_number, now]);

    res.json({ name: studentResult.rows[0].name });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id/members/:memberRoll — remove member (owner only)
router.delete('/:id/members/:memberRoll', async (req, res) => {
  const roll = req.headers['x-roll-number'] as string | undefined;
  if (!roll) return res.status(401).json({ error: 'Roll number required' });

  try {
    const boardResult = await pool.query('SELECT owner_roll FROM boards WHERE id = $1', [req.params.id]);
    if (boardResult.rows.length === 0) return res.status(404).json({ error: 'Board not found' });
    if (boardResult.rows[0].owner_roll !== roll) return res.status(403).json({ error: 'Not the owner' });

    await pool.query(
      'DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2',
      [req.params.id, req.params.memberRoll]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

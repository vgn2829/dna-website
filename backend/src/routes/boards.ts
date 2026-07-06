import { Router, Request, Response } from 'express';
import { pool } from '../db/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../middleware/adminAuth';
import { requireStudent, optionalStudent } from '../middleware/studentAuth';
import multer from 'multer';
import { getStorage } from '../storage';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Helper: check if roll is board member or owner
async function canAccess(boardId: string, roll: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT 1 FROM boards
    WHERE id = $1 AND (
      owner_roll = $2
      OR visibility = 'shared'
    )
    UNION
    SELECT 1 FROM board_members
    WHERE board_id = $1 AND roll_number = $2
  `, [boardId, roll]);
  return result.rows.length > 0;
}

async function isOwner(boardId: string, roll: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM boards WHERE id = $1 AND owner_roll = $2',
    [boardId, roll]
  );
  return result.rows.length > 0;
}

async function isMember(boardId: string, roll: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT 1 FROM boards
    WHERE id = $1 AND owner_roll = $2
    UNION
    SELECT 1 FROM board_members
    WHERE board_id = $1 AND roll_number = $2
  `, [boardId, roll]);
  return result.rows.length > 0;
}

// GET /api/boards
// Returns boards owned by or shared with this student
router.get('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const result = await pool.query(`
      SELECT DISTINCT
        b.*,
        COUNT(bi.id)::int as item_count,
        COUNT(bm.roll_number)::int as member_count
      FROM boards b
      LEFT JOIN board_items bi ON bi.board_id = b.id
      LEFT JOIN board_members bm ON bm.board_id = b.id
      WHERE b.owner_roll = $1
        OR b.id IN (
          SELECT board_id FROM board_members
          WHERE roll_number = $1
        )
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `, [roll]);

    res.json(result.rows);
  } catch (err) {
    console.error('Get boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/shared
// Returns all shared boards (for discovery)
router.get('/shared', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        b.*,
        COUNT(bi.id)::int as item_count,
        COUNT(bm.roll_number)::int as member_count
      FROM boards b
      LEFT JOIN board_items bi ON bi.board_id = b.id
      LEFT JOIN board_members bm ON bm.board_id = b.id
      WHERE b.visibility = 'shared'
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/admin/all
// Returns all boards from all users (admin only)
router.get('/admin/all', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        b.*,
        COUNT(DISTINCT bi.id)::int as item_count,
        COUNT(DISTINCT bm.roll_number)::int as member_count
      FROM boards b
      LEFT JOIN board_items bi ON bi.board_id = b.id
      LEFT JOIN board_members bm ON bm.board_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin get boards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/admin/:id
// Admin can delete any board
router.delete('/admin/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM boards WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Admin delete board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/admin/:id
// Admin can update visibility/edit_mode of any board
router.put('/admin/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      visibility: z.enum(['private', 'shared']).optional(),
      edit_mode: z.enum(['members_only', 'anyone']).optional(),
    });
    const parsed = schema.parse(req.body);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (parsed.visibility !== undefined) {
      fields.push(`visibility = $${i++}`);
      values.push(parsed.visibility);
    }
    if (parsed.edit_mode !== undefined) {
      fields.push(`edit_mode = $${i++}`);
      values.push(parsed.edit_mode);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(`
      UPDATE boards SET ${fields.join(', ')}
      WHERE id = $${i} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:id/canvas
// Save Excalidraw canvas state (owner + members)
router.put('/:id/canvas', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const access = await isMember(req.params.id, roll);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { canvas_data } = req.body as { canvas_data?: string };
    if (!canvas_data) {
      return res.status(400).json({ error: 'canvas_data is required' });
    }

    try {
      JSON.parse(canvas_data);
    } catch {
      return res.status(400).json({ error: 'canvas_data must be valid JSON' });
    }

    await pool.query(`
      UPDATE boards
      SET canvas_data = $1
      WHERE id = $2
    `, [canvas_data, req.params.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Save canvas error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/:id/canvas
// Load Excalidraw canvas state
router.get('/:id/canvas', optionalStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll;

    const boardResult = await pool.query(
      'SELECT visibility, canvas_data FROM boards WHERE id = $1',
      [req.params.id]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = boardResult.rows[0] as { visibility: string; canvas_data: string | null };

    if (board.visibility === 'private') {
      if (!roll) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const access = await isMember(req.params.id, roll);
      if (!access) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({ canvas_data: board.canvas_data ?? null });
  } catch (err) {
    console.error('Load canvas error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/:id
// Returns board with items and members
router.get('/:id', optionalStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll;

    const boardResult = await pool.query(
      'SELECT * FROM boards WHERE id = $1',
      [req.params.id]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = boardResult.rows[0];

    // Private boards: owner + members only; shared boards: everyone (even guests)
    if (board.visibility === 'private') {
      if (!roll) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const access = await isMember(board.id, roll);
      if (!access) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const itemsResult = await pool.query(`
      SELECT * FROM board_items
      WHERE board_id = $1
      ORDER BY created_at DESC
    `, [req.params.id]);

    const membersResult = await pool.query(`
      SELECT roll_number, name, added_at
      FROM board_members
      WHERE board_id = $1
      ORDER BY added_at ASC
    `, [req.params.id]);

    res.json({
      ...board,
      items: itemsResult.rows,
      members: membersResult.rows,
    });
  } catch (err) {
    console.error('Get board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards
// Create a new board
router.post('/', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const schema = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(300).optional(),
      visibility: z.enum(['private', 'shared']).default('private'),
    });

    const parsed = schema.parse(req.body);

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const ownerName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    const id = uuidv4();
    const roomId = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO boards
        (id, name, description, owner_roll,
         owner_name, visibility, room_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      id, parsed.name, parsed.description ?? null,
      roll, ownerName, parsed.visibility, roomId, now,
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    console.error('Create board error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/boards/:id
// Update board name/description/visibility (owner only)
router.put('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const owner = await isOwner(req.params.id, roll);
    if (!owner) {
      return res.status(403).json({ error: 'Only owner can update board' });
    }

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(300).optional(),
      visibility: z.enum(['private', 'shared']).optional(),
      edit_mode: z.enum(['members_only', 'anyone']).optional(),
    });

    const parsed = schema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (parsed.name !== undefined) { fields.push(`name = $${i++}`); values.push(parsed.name); }
    if (parsed.description !== undefined) { fields.push(`description = $${i++}`); values.push(parsed.description); }
    if (parsed.visibility !== undefined) { fields.push(`visibility = $${i++}`); values.push(parsed.visibility); }
    if (parsed.edit_mode !== undefined) { fields.push(`edit_mode = $${i++}`); values.push(parsed.edit_mode); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(`
      UPDATE boards SET ${fields.join(', ')}
      WHERE id = $${i} RETURNING *
    `, values);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id
// Delete board (owner only)
router.delete('/:id', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const owner = await isOwner(req.params.id, roll);
    if (!owner) {
      return res.status(403).json({ error: 'Only owner can delete board' });
    }

    await pool.query('DELETE FROM boards WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/members
// Add collaborator by roll number (owner only)
router.post('/:id/members', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const owner = await isOwner(req.params.id, roll);
    if (!owner) {
      return res.status(403).json({ error: 'Only owner can add members' });
    }

    const { roll_number } = req.body as { roll_number?: string };
    if (!roll_number) {
      return res.status(400).json({ error: 'Roll number required' });
    }

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll_number]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Student not found — they must register first',
      });
    }

    const memberName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO board_members (board_id, roll_number, name, added_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `, [req.params.id, roll_number, memberName, now]);

    res.json({ success: true, name: memberName });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id/members/:roll
// Remove collaborator (owner only)
router.delete('/:id/members/:roll', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const owner = await isOwner(req.params.id, roll);
    if (!owner) {
      return res.status(403).json({ error: 'Only owner can remove members' });
    }

    await pool.query(
      'DELETE FROM board_members WHERE board_id = $1 AND roll_number = $2',
      [req.params.id, req.params.roll]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/items
// Add item to board (owner + members)
router.post('/:id/items', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const access = await isMember(req.params.id, roll);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const schema = z.object({
      image_url: z.string().min(1),
      note: z.string().max(500).optional(),
      source_url: z.string().optional(),
    });

    const parsed = schema.parse(req.body);

    const studentResult = await pool.query(
      'SELECT name FROM student_sessions WHERE roll_number = $1',
      [roll]
    );
    const addedByName = (studentResult.rows[0] as { name: string } | undefined)?.name ?? null;

    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO board_items
        (id, board_id, image_url, note,
         source_url, added_by_roll, added_by_name, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      id, req.params.id,
      parsed.image_url,
      parsed.note ?? null,
      parsed.source_url ?? null,
      roll,
      addedByName,
      now,
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    console.error('Add item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id/items/:itemId
// Delete item (item owner or board owner)
router.delete('/:id/items/:itemId', requireStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    const itemResult = await pool.query(
      'SELECT * FROM board_items WHERE id = $1 AND board_id = $2',
      [req.params.itemId, req.params.id]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemResult.rows[0] as { added_by_roll: string };
    const owner = await isOwner(req.params.id, roll);

    if (item.added_by_roll !== roll && !owner) {
      return res.status(403).json({ error: 'Cannot delete this item' });
    }

    await pool.query('DELETE FROM board_items WHERE id = $1', [req.params.itemId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/boards/:id/items
// Get only items (for polling)
router.get('/:id/items', optionalStudent, async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll;

    const boardResult = await pool.query(
      'SELECT * FROM boards WHERE id = $1',
      [req.params.id]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = boardResult.rows[0] as { visibility: string; id: string };

    if (board.visibility === 'private') {
      if (!roll) return res.status(403).json({ error: 'Access denied' });
      const access = await isMember(board.id, roll);
      if (!access) return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(`
      SELECT * FROM board_items
      WHERE board_id = $1
      ORDER BY created_at DESC
    `, [req.params.id]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:id/canvas-files
// Upload a canvas image file to storage; returns the public URL
// Extensions are derived from a validated content-type allowlist, never from the
// raw client MIME string, so they can't be used to smuggle path characters.
const CANVAS_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

router.post('/:id/canvas-files', requireStudent, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const roll = req.studentRoll!;

    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid board id' });
    }

    const access = await isMember(req.params.id, roll);
    if (!access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const ext = CANVAS_MIME_EXT[req.file.mimetype];
    if (!ext) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const rawFileId = (req.body.fileId as string | undefined) ?? `canvas_${Date.now()}`;
    if (!FILE_ID_RE.test(rawFileId)) {
      return res.status(400).json({ error: 'Invalid fileId' });
    }
    const fileId = rawFileId;

    const storagePath = `canvas-files/${req.params.id}/${fileId}.${ext}`;

    await getStorage().upload(storagePath, req.file.buffer, req.file.mimetype);
    const url = getStorage().getPublicUrl(storagePath);

    res.json({ fileId, url });
  } catch (err) {
    console.error('Canvas file upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

import { Router } from 'express';
import { pool } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { requireStudent } from '../middleware/studentAuth';

const router = Router();

// GET /api/coordinators — admin only
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        agm.roll_number,
        agm.name,
        agm.approved,
        agm.added_at,
        ss.email,
        ss.registered_at
      FROM audience_group_members agm
      LEFT JOIN student_sessions ss
        ON ss.roll_number = agm.roll_number
      WHERE agm.group_id = 'coordinators'
      ORDER BY agm.name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Get coordinators error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/coordinators — manually add a coordinator, admin only
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { roll_number, name } = req.body as { roll_number?: string; name?: string };

    if (!roll_number?.trim() || !name?.trim()) {
      return res.status(400).json({ error: 'roll_number and name are required' });
    }

    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO audience_group_members
        (group_id, roll_number, name,
         added_at, approved)
      VALUES ('coordinators', $1, $2, $3, false)
      ON CONFLICT (group_id, roll_number)
      DO UPDATE SET name = EXCLUDED.name
    `, [roll_number.trim(), name.trim(), now]);

    res.json({
      success: true,
      roll_number: roll_number.trim(),
      name: name.trim(),
      approved: false,
      added_at: now,
      email: null,
      registered_at: null,
    });
  } catch (err) {
    console.error('Add coordinator error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/coordinators/:roll/approve — toggle approval, admin only
router.put('/:roll/approve', requireAdmin, async (req, res) => {
  try {
    const { roll } = req.params;
    const { approved } = req.body as { approved?: unknown };

    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'approved must be a boolean' });
    }

    const result = await pool.query(`
      UPDATE audience_group_members
      SET approved = $1
      WHERE group_id = 'coordinators'
        AND roll_number = $2
      RETURNING *
    `, [approved, roll]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Coordinator not found' });
    }

    console.log(`Coordinator ${roll} ${approved ? 'approved' : 'revoked'}`);

    res.json({ success: true, approved });
  } catch (err) {
    console.error('Approve coordinator error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/coordinators/:roll — remove coordinator, admin only
router.delete('/:roll', requireAdmin, async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM audience_group_members
      WHERE group_id = 'coordinators'
        AND roll_number = $1
    `, [req.params.roll]);

    res.json({ success: true });
  } catch (err) {
    console.error('Delete coordinator error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/coordinators/check — returns whether the *authenticated* student is an
// approved coordinator. Derives the roll from the verified token (no enumeration).
router.get('/check', requireStudent, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT approved
      FROM audience_group_members
      WHERE group_id = 'coordinators'
        AND roll_number = $1
        AND approved = true
    `, [req.studentRoll!]);

    res.json({ canSchedule: result.rows.length > 0 });
  } catch (err) {
    console.error('Coordinator check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

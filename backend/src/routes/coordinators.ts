import { Router } from 'express';
import { pool } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';

const router = Router();

// GET /api/coordinators
// Returns all team members with Coordinator designation, with their approval status
// Admin only
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        tm.id,
        tm.name,
        tm.roll_number,
        tm.designation,
        tm.photo_url,
        tm.year,
        COALESCE(agm.approved, false) as approved,
        COALESCE(agm.roll_number IS NOT NULL, false) as in_group,
        ss.email,
        ss.registered_at
      FROM team_members tm
      LEFT JOIN audience_group_members agm
        ON agm.roll_number = tm.roll_number
        AND agm.group_id = 'coordinators'
      LEFT JOIN student_sessions ss
        ON ss.roll_number = tm.roll_number
      WHERE TRIM(tm.designation) = 'Coordinator'
      ORDER BY tm.name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Get coordinators error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/coordinators/:roll/approve
// Toggle approval status for a coordinator
// Admin only
router.put('/:roll/approve', requireAdmin, async (req, res) => {
  try {
    const { roll } = req.params;
    const { approved } = req.body as { approved?: unknown };

    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'approved must be a boolean' });
    }

    await pool.query(`
      INSERT INTO audience_group_members
        (group_id, roll_number, name, added_at, approved)
      VALUES (
        'coordinators',
        $1,
        (SELECT name FROM team_members WHERE roll_number = $1 LIMIT 1),
        $2,
        $3
      )
      ON CONFLICT (group_id, roll_number)
      DO UPDATE SET approved = EXCLUDED.approved
    `, [roll, new Date().toISOString(), approved]);

    console.log(`Coordinator ${roll} ${approved ? 'approved' : 'revoked'}`);

    res.json({ success: true, approved });
  } catch (err) {
    console.error('Approve coordinator error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/coordinators/check/:roll
// Public — checks if a roll number is an approved coordinator
router.get('/check/:roll', async (req, res) => {
  try {
    const { roll } = req.params;

    const result = await pool.query(`
      SELECT agm.approved
      FROM audience_group_members agm
      WHERE agm.group_id = 'coordinators'
        AND agm.roll_number = $1
        AND agm.approved = true
    `, [roll]);

    res.json({ canSchedule: result.rows.length > 0 });
  } catch (err) {
    console.error('Coordinator check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

import { Router } from 'express';
import { pool } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const sessionSchema = z.object({
  title: z.string().min(1).max(200),
  host: z.string().min(1).max(100),
  meet_link: z.string().url(),
  scheduled_at: z.string(),
  audience_group_id: z.string().nullable().optional(),
  description: z.string().max(500).optional(),
});

router.get('/active', async (req, res) => {
  try {
    const roll = req.headers['x-roll-number'] as string | undefined;

    const result = await pool.query(`
      SELECT
        ls.*,
        ag.name as audience_name
      FROM live_sessions ls
      LEFT JOIN audience_groups ag
        ON ls.audience_group_id = ag.id
      WHERE ls.status IN ('upcoming', 'live')
      ORDER BY ls.scheduled_at ASC
    `);

    const sessions = await Promise.all(
      result.rows.map(async (session) => {
        if (
          !session.audience_group_id ||
          session.audience_group_id === 'all_students'
        ) {
          return { ...session, canAccess: true };
        }

        if (!roll) {
          return { ...session, canAccess: false, meet_link: null };
        }

        const memberCheck = await pool.query(`
          SELECT 1 FROM audience_group_members
          WHERE group_id = $1 AND roll_number = $2
        `, [session.audience_group_id, roll]);

        const canAccess = memberCheck.rows.length > 0;
        return {
          ...session,
          canAccess,
          meet_link: canAccess ? session.meet_link : null,
        };
      })
    );

    res.json(sessions);
  } catch (err) {
    console.error('Get active sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/groups', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ag.*,
        COUNT(agm.roll_number)::int as member_count
      FROM audience_groups ag
      LEFT JOIN audience_group_members agm
        ON ag.id = agm.group_id
      GROUP BY ag.id
      ORDER BY ag.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ls.*, ag.name as audience_name
      FROM live_sessions ls
      LEFT JOIN audience_groups ag
        ON ls.audience_group_id = ag.id
      ORDER BY ls.scheduled_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const parsed = sessionSchema.parse(req.body);
    const id = uuidv4();
    const now = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO live_sessions
        (id, title, host, meet_link, scheduled_at,
         status, audience_group_id, description, created_at)
      VALUES ($1,$2,$3,$4,$5,'upcoming',$6,$7,$8)
      RETURNING *
    `, [
      id, parsed.title, parsed.host, parsed.meet_link,
      parsed.scheduled_at,
      parsed.audience_group_id ?? null,
      parsed.description ?? null,
      now,
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['upcoming', 'live', 'ended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(`
      UPDATE live_sessions SET status = $1
      WHERE id = $2 RETURNING *
    `, [status, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const parsed = sessionSchema.partial().parse(req.body);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (parsed.title !== undefined) { fields.push(`title = $${i++}`); values.push(parsed.title); }
    if (parsed.host !== undefined) { fields.push(`host = $${i++}`); values.push(parsed.host); }
    if (parsed.meet_link !== undefined) { fields.push(`meet_link = $${i++}`); values.push(parsed.meet_link); }
    if (parsed.scheduled_at !== undefined) { fields.push(`scheduled_at = $${i++}`); values.push(parsed.scheduled_at); }
    if (parsed.audience_group_id !== undefined) { fields.push(`audience_group_id = $${i++}`); values.push(parsed.audience_group_id); }
    if (parsed.description !== undefined) { fields.push(`description = $${i++}`); values.push(parsed.description); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(`
      UPDATE live_sessions SET ${fields.join(', ')}
      WHERE id = $${i} RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM live_sessions WHERE id = $1',
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

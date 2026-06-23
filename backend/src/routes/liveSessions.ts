import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

async function requireCoordinator(req: Request, res: Response, next: NextFunction): Promise<void> {
  const roll = req.headers['x-roll-number'] as string | undefined;
  if (!roll) { res.status(401).json({ error: 'Roll number required' }); return; }
  try {
    const result = await pool.query(`
      SELECT 1 FROM audience_group_members
      WHERE group_id = 'coordinators' AND roll_number = $1 AND approved = true
    `, [roll]);
    if (result.rows.length === 0) { res.status(403).json({ error: 'Access denied' }); return; }
    next();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

function verifyPublicMeetToken(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as {
      type: string;
      exp: number;
    };
    return payload.type === 'public_meet' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

const sessionSchema = z.object({
  title: z.string().min(1).max(200),
  host: z.string().min(1).max(100),
  meet_link: z.string().url(),
  scheduled_at: z.string(),
  audience_group_id: z.string().nullable().optional(),
  description: z.string().max(500).optional(),
});

// ── Static paths first (must be before /:id routes) ──────────────────────────

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

router.get('/past', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ls.*,
        ag.name as audience_name,
        COUNT(sj.roll_number)::int as join_count
      FROM live_sessions ls
      LEFT JOIN audience_groups ag
        ON ls.audience_group_id = ag.id
      LEFT JOIN session_joins sj
        ON ls.id = sj.session_id
      WHERE ls.status = 'ended'
      GROUP BY ls.id, ag.name
      ORDER BY ls.scheduled_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Get past sessions error:', err);
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

router.post('/public', async (req, res) => {
  try {
    const { token, ...body } = req.body as { token?: string } & Record<string, unknown>;
    if (!token || !verifyPublicMeetToken(token)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const parsed = sessionSchema.parse(body);
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
    console.error('Public create session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/public/:id', async (req, res) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token || !verifyPublicMeetToken(token)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await pool.query(
      `DELETE FROM live_sessions WHERE id = $1 AND created_at >= $2 RETURNING id`,
      [req.params.id, cutoff]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or too old to delete' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Public delete session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/coordinator', requireCoordinator, async (req, res) => {
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
    console.error('Coordinator create session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/coordinator/:id', requireCoordinator, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = await pool.query(
      `DELETE FROM live_sessions WHERE id = $1 AND created_at >= $2 RETURNING id`,
      [req.params.id, cutoff]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or too old to delete' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Coordinator delete session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/coordinator/:id/status', requireCoordinator, async (req, res) => {
  try {
    const { status } = req.body as { status?: string };

    if (!['live', 'ended', 'upcoming'].includes(status ?? '')) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(`
      UPDATE live_sessions
      SET status = $1
      WHERE id = $2
      RETURNING *
    `, [status, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    console.log(`Coordinator updated session ${req.params.id} to ${status}`);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Coordinator status update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Parameterised paths ───────────────────────────────────────────────────────

router.get('/:id/joins', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sj.roll_number,
        sj.name,
        sj.joined_at
      FROM session_joins sj
      WHERE sj.session_id = $1
      ORDER BY sj.joined_at ASC
    `, [req.params.id]);

    res.json({
      session_id: req.params.id,
      count: result.rows.length,
      joins: result.rows,
    });
  } catch (err) {
    console.error('Get joins error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/joins/count', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*)::int as count
      FROM session_joins
      WHERE session_id = $1
    `, [req.params.id]);

    res.json({ count: result.rows[0].count });
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

router.post('/:id/join', async (req, res) => {
  try {
    const roll = req.headers['x-roll-number'] as string;
    if (!roll) {
      return res.status(401).json({ error: 'Roll number required' });
    }

    const sessionCheck = await pool.query(
      `SELECT id, title, status FROM live_sessions WHERE id = $1`,
      [req.params.id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const studentCheck = await pool.query(
      `SELECT name FROM student_sessions WHERE roll_number = $1`,
      [roll]
    );

    const name = (studentCheck.rows[0] as { name: string } | undefined)?.name ?? null;

    await pool.query(`
      INSERT INTO session_joins
        (id, session_id, roll_number, name, joined_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (session_id, roll_number) DO UPDATE
        SET joined_at = EXCLUDED.joined_at
    `, [
      uuidv4(),
      req.params.id,
      roll,
      name,
      new Date().toISOString(),
    ]);

    console.log(`Join tracked: ${name ?? roll} → session ${req.params.id}`);

    res.json({ success: true });
  } catch (err) {
    console.error('Join tracking error:', err);
    // Don't fail loudly — tracking should never block the student from joining
    res.json({ success: true });
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

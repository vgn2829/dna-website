import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client';
import { requireStudent, requireVerifiedStudent } from '../middleware/studentAuth';
import { param } from '../routeParams';

export const designersRouter = Router();

const handle = z.string().trim().toLowerCase().min(3).max(30)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
const fields = {
  handle,
  displayName: z.string().trim().min(1).max(100),
  bio: z.string().trim().max(500).nullable().optional(),
};
const createSchema = z.object(fields).strict();
const updateSchema = createSchema.partial().refine(body => Object.keys(body).length > 0);

interface ProfileRow {
  id: string; handle: string; display_name: string; bio: string | null;
  created_at: Date; updated_at: Date;
}

// Explicit public projection for every response, including owner endpoints.
function toProfile(row: ProfileRow) {
  return { id: row.id, handle: row.handle, displayName: row.display_name,
    bio: row.bio, createdAt: row.created_at, updatedAt: row.updated_at };
}
const PUBLIC_COLUMNS = 'id, handle, display_name, bio, created_at, updated_at';

// GET /api/designers/me -> profile, or null before creation. Legacy/bypass
// sessions may read their profile; only writes require fresh OTP sign-in.
designersRouter.get('/me', requireStudent, async (req, res) => {
  const result = await pool.query<ProfileRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM designer_profiles WHERE owner_roll = $1`, [req.studentRoll]
  );
  res.json(result.rows[0] ? toProfile(result.rows[0]) : null);
});

// POST/PATCH /api/designers/me never accept owner, account or attribution fields.
designersRouter.post('/me', requireVerifiedStudent, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid designer profile' });
  try {
    // A signed identity must still resolve to an existing account. The FK is
    // the final arbiter if the account disappears concurrently.
    const account = await pool.query('SELECT 1 FROM student_sessions WHERE roll_number = $1', [req.studentRoll]);
    if (!account.rows.length) return res.status(403).json({ error: 'Account not found' });
    const { handle, displayName, bio } = parsed.data;
    const result = await pool.query<ProfileRow>(
      `INSERT INTO designer_profiles(id, owner_roll, handle, display_name, bio)
       VALUES($1, $2, $3, $4, $5) RETURNING ${PUBLIC_COLUMNS}`,
      [uuidv4(), req.studentRoll, handle, displayName, bio ?? null]
    );
    return res.status(201).json(toProfile(result.rows[0]));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') return res.status(409).json({ error: 'Designer profile or handle already exists' });
    if (code === '23503') return res.status(403).json({ error: 'Account not found' });
    throw err;
  }
});

designersRouter.patch('/me', requireVerifiedStudent, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid designer profile update' });
  const body = parsed.data;
  try {
    const result = await pool.query<ProfileRow>(
      `UPDATE designer_profiles SET
         handle = COALESCE($2, handle), display_name = COALESCE($3, display_name),
         bio = CASE WHEN $4::boolean THEN $5 ELSE bio END, updated_at = NOW()
       WHERE owner_roll = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [req.studentRoll, body.handle ?? null, body.displayName ?? null, body.bio !== undefined, body.bio ?? null]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Designer profile not found' });
    return res.json(toProfile(result.rows[0]));
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Designer handle already exists' });
    }
    throw err;
  }
});

// Public identity lookup only: no account data or portfolio collection.
designersRouter.get('/:handle', async (req, res) => {
  const parsed = handle.safeParse(param(req.params.handle));
  if (!parsed.success) return res.status(404).json({ error: 'Designer profile not found' });
  const result = await pool.query<ProfileRow>(
    `SELECT ${PUBLIC_COLUMNS} FROM designer_profiles WHERE handle = $1`, [parsed.data]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Designer profile not found' });
  return res.json(toProfile(result.rows[0]));
});

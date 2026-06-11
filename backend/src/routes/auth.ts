import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/client';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts — try again in 15 minutes' },
});

const loginSchema = z.object({ password: z.string().min(1) });

authRouter.post('/admin/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Password is required' }); return; }

  const rows = await query<{ value: string }>('SELECT value FROM admin_config WHERE key=$1', ['admin_password_hash']);
  if (rows.length === 0) { res.status(500).json({ error: 'Admin not configured' }); return; }

  const valid = await bcrypt.compare(parsed.data.password, rows[0].value);
  if (!valid) { res.status(401).json({ error: 'Incorrect password' }); return; }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET!, { expiresIn: '8h' });
  res.json({ token });
});

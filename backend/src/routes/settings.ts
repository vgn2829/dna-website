import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { z } from 'zod';

const router = Router();

// Strict limiter to make passcode brute-forcing impractical.
const passcodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: 'Too many attempts — try again in 15 minutes' },
});

router.get('/public', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('public_meet_enabled', 'student_otp_bypass_enabled')`
    );
    const settings: Record<string, string> = {};
    result.rows.forEach((r: { key: string; value: string }) => {
      settings[r.key] = r.value;
    });
    res.json(settings);
  } catch (err) {
    console.error('Get public settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT key, value, updated_at FROM app_settings ORDER BY key'
    );
    const settings: Record<string, string> = {};
    result.rows.forEach((r: { key: string; value: string; updated_at: string }) => {
      settings[r.key] = r.value;
    });
    res.json(settings);
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/', requireAdmin, async (req, res) => {
  try {
    const schema = z.record(z.string(), z.string());
    const updates = schema.parse(req.body);
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `, [key, value, now]);
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-passcode', passcodeLimiter, async (req, res) => {
  try {
    const { passcode } = req.body as { passcode?: string };
    if (!passcode) return res.status(400).json({ error: 'Passcode required' });

    const enabledResult = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'public_meet_enabled'`
    );
    if (!enabledResult.rows.length || (enabledResult.rows[0] as { value: string }).value !== 'true') {
      return res.status(403).json({ error: 'Public meet scheduler is not enabled' });
    }

    const passcodeResult = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'public_meet_passcode'`
    );
    const correctPasscode = (passcodeResult.rows[0] as { value: string } | undefined)?.value;
    // Fail closed if no passcode has been configured.
    if (!correctPasscode || passcode !== correctPasscode) {
      return res.status(401).json({ error: 'Incorrect passcode' });
    }

    // Signed token — cannot be forged client-side (was previously base64(JSON)).
    const token = jwt.sign(
      { typ: 'public_meet' },
      process.env.JWT_SECRET!,
      { algorithm: 'HS256', expiresIn: '24h' }
    );
    res.json({ success: true, token });
  } catch (err) {
    console.error('Verify passcode error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

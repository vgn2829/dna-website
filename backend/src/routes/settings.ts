import { Router } from 'express';
import { pool } from '../db/client';
import { requireAdmin } from '../middleware/adminAuth';
import { z } from 'zod';

const router = Router();

router.get('/public', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('public_meet_enabled')`
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
      return res.status(400).json({ error: err.errors });
    }
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-passcode', async (req, res) => {
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
    if (passcode !== correctPasscode) {
      return res.status(401).json({ error: 'Incorrect passcode' });
    }

    const token = Buffer.from(JSON.stringify({
      type: 'public_meet',
      exp: Date.now() + 24 * 60 * 60 * 1000,
    })).toString('base64');
    res.json({ success: true, token });
  } catch (err) {
    console.error('Verify passcode error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

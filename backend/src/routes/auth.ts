import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/client';
import { signStudentToken } from '../middleware/studentAuth';
import { sendOtpEmail, sendWelcomeEmail } from '../services/mailer';

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

// ── Student email-OTP authentication ─────────────────────────────────────────

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: { error: 'Too many code requests — try again in 15 minutes' },
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many attempts — try again in 15 minutes' },
});

const ROLL_SCHEMA = z.string().regex(/^[0-9]{2}[a-zA-Z0-9]{4,6}$/i, 'Invalid roll number format')
  .transform(s => s.trim().toUpperCase());

const requestOtpSchema = z.object({
  rollNumber: ROLL_SCHEMA,
  name: z.string().min(2).max(100).trim().optional(),
  email: z.string().email().max(200)
    .refine(e => e.toLowerCase().endsWith('@iitk.ac.in'), 'Only @iitk.ac.in email addresses are allowed')
    .transform(e => e.toLowerCase())
    .optional(),
});

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  const shown = user.slice(0, 1);
  return `${shown}${'*'.repeat(Math.max(1, user.length - 1))}@${domain}`;
}

authRouter.post('/student/request-otp', otpRequestLimiter, async (req, res) => {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid roll number or email' }); return; }
  const { rollNumber: roll } = parsed.data;

  const existing = await query<{ name: string | null; email: string | null }>(
    'SELECT name, email FROM student_sessions WHERE roll_number=$1 AND name IS NOT NULL AND email IS NOT NULL',
    [roll]
  );

  let targetEmail: string;
  let targetName: string | null;
  const isNew = existing.length === 0;

  if (!isNew) {
    // Existing student: always send to the email already on file (ignore client-supplied).
    targetEmail = existing[0].email!;
    targetName = existing[0].name;
  } else {
    // New student: must supply a valid name + IITK email.
    if (!parsed.data.name || !parsed.data.email) {
      res.status(400).json({ error: 'Name and IITK email are required to register' });
      return;
    }
    targetEmail = parsed.data.email;
    targetName = parsed.data.name;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await query(
    `INSERT INTO student_otps (roll_number, email, code_hash, name, expires_at, attempts)
     VALUES ($1,$2,$3,$4,$5,0)
     ON CONFLICT (roll_number)
     DO UPDATE SET email=EXCLUDED.email, code_hash=EXCLUDED.code_hash,
                   name=EXCLUDED.name, expires_at=EXCLUDED.expires_at, attempts=0,
                   created_at=NOW()`,
    [roll, targetEmail, codeHash, targetName, expiresAt]
  );

  try {
    await sendOtpEmail(targetEmail, code);
  } catch {
    res.status(502).json({ error: 'Could not send verification email — try again shortly' });
    return;
  }

  res.json({ sent: true, isNew, email: maskEmail(targetEmail) });
});

const verifyOtpSchema = z.object({
  rollNumber: ROLL_SCHEMA,
  code: z.string().regex(/^[0-9]{6}$/, 'Invalid code'),
});

authRouter.post('/student/verify-otp', otpVerifyLimiter, async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid code' }); return; }
  const { rollNumber: roll, code } = parsed.data;

  const rows = await query<{ email: string; code_hash: string; name: string | null; expires_at: string; attempts: number }>(
    'SELECT email, code_hash, name, expires_at, attempts FROM student_otps WHERE roll_number=$1',
    [roll]
  );
  if (rows.length === 0) { res.status(400).json({ error: 'No pending code — request a new one' }); return; }

  const otp = rows[0];
  if (new Date(otp.expires_at).getTime() < Date.now()) {
    await query('DELETE FROM student_otps WHERE roll_number=$1', [roll]);
    res.status(400).json({ error: 'Code expired — request a new one' });
    return;
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await query('DELETE FROM student_otps WHERE roll_number=$1', [roll]);
    res.status(429).json({ error: 'Too many incorrect attempts — request a new code' });
    return;
  }

  const ok = await bcrypt.compare(code, otp.code_hash);
  if (!ok) {
    await query('UPDATE student_otps SET attempts=attempts+1 WHERE roll_number=$1', [roll]);
    res.status(400).json({ error: 'Incorrect code' });
    return;
  }

  // Verified — consume the OTP.
  await query('DELETE FROM student_otps WHERE roll_number=$1', [roll]);

  const existing = await query<{ unique_id: string; registered_at: string; name: string | null; email: string | null }>(
    'SELECT unique_id, registered_at, name, email FROM student_sessions WHERE roll_number=$1',
    [roll]
  );

  let uniqueId: string;
  let registeredAt: string;
  let name: string;
  let email: string;
  let isNew = false;

  if (existing.length > 0 && existing[0].name && existing[0].email) {
    uniqueId = existing[0].unique_id;
    registeredAt = existing[0].registered_at;
    name = existing[0].name;
    email = existing[0].email;
  } else {
    isNew = true;
    name = otp.name ?? '';
    email = otp.email;
    uniqueId = `IITK-DnA-${roll}-${uuidv4().slice(0, 4).toUpperCase()}`;
    registeredAt = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    await query(
      `INSERT INTO student_sessions(roll_number,unique_id,registered_at,name,email)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (roll_number) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email`,
      [roll, uniqueId, registeredAt, name, email]
    );
    sendWelcomeEmail(name, email).catch(err => console.error('Welcome email failed:', err));
  }

  const watched = await query<{ video_id: string }>('SELECT video_id FROM student_watched_videos WHERE roll_number=$1', [roll]);
  const quizzes = await query<{ domain_id: string }>('SELECT domain_id FROM student_completed_quizzes WHERE roll_number=$1', [roll]);

  const token = signStudentToken(roll);
  res.json({
    token,
    isNew,
    session: { rollNumber: roll, uniqueId, registeredAt, name, email },
    progress: { watchedVideos: watched.map(r => r.video_id), completedQuizzes: quizzes.map(r => r.domain_id) },
  });
});

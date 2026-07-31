import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';

const app = createApp();

// The real code is only ever emailed, never returned in the API response —
// so tests that need to assert an exact success/failure outcome insert a
// known plaintext code directly (bypassing email dispatch), the same shape
// routes/auth.ts's request-otp handler itself writes. Tests that only care
// "a pending code now exists" (not its value) call the real request-otp
// endpoint instead, exactly as documented per-test below.
async function seedOtp(roll: string, code: string, opts: {
  attempts?: number; expiresAt?: Date; email?: string; name?: string;
} = {}): Promise<void> {
  const bcrypt = await import('bcryptjs');
  const codeHash = await bcrypt.hash(code, 10);
  await query(
    `INSERT INTO student_otps (roll_number, email, code_hash, name, expires_at, attempts)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (roll_number)
     DO UPDATE SET email=EXCLUDED.email, code_hash=EXCLUDED.code_hash,
                   name=EXCLUDED.name, expires_at=EXCLUDED.expires_at, attempts=EXCLUDED.attempts`,
    [
      roll,
      opts.email ?? 'test.student@iitk.ac.in',
      codeHash,
      opts.name ?? 'Test Student',
      (opts.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000)).toISOString(),
      opts.attempts ?? 0,
    ]
  );
}

describe('Student OTP auth flow', () => {
  it('registers a new student: request-otp requires name+email, verify-otp issues a token and creates the session', async () => {
    const roll = '23xyz01';

    const reqRes = await request(app)
      .post('/api/auth/student/request-otp')
      .send({ rollNumber: roll, name: 'Ada Lovelace', email: 'ada@iitk.ac.in' });
    expect(reqRes.status).toBe(200);
    expect(reqRes.body).toMatchObject({ sent: true, isNew: true });
    expect(reqRes.body.email).toMatch(/^a\*+@iitk\.ac\.in$/);

    // Overwrite with a known code so we can verify without reversing the hash
    // that request-otp just wrote (this only replaces code_hash/expiry, not
    // the roll/email/name association already correctly created above).
    await seedOtp(roll.toUpperCase(), '123456', { email: 'ada@iitk.ac.in', name: 'Ada Lovelace' });

    const verifyRes = await request(app)
      .post('/api/auth/student/verify-otp')
      .send({ rollNumber: roll, code: '123456' });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.isNew).toBe(true);
    expect(verifyRes.body.token).toEqual(expect.any(String));
    expect(verifyRes.body.session).toMatchObject({
      rollNumber: roll.toUpperCase(),
      name: 'Ada Lovelace',
      email: 'ada@iitk.ac.in',
    });
    expect(verifyRes.body.session.uniqueId).toMatch(new RegExp(`^IITK-DnA-${roll.toUpperCase()}-`));
    expect(verifyRes.body.progress).toEqual({ watchedVideos: [], completedQuizzes: [] });

    // The OTP is consumed (deleted) on successful verify — replay must fail.
    const replay = await request(app)
      .post('/api/auth/student/verify-otp')
      .send({ rollNumber: roll, code: '123456' });
    expect(replay.status).toBe(400);
  });

  it('rejects a request-otp for a new roll number with no name/email', async () => {
    const res = await request(app)
      .post('/api/auth/student/request-otp')
      .send({ rollNumber: '23abc02' });
    expect(res.status).toBe(400);
  });

  it('rejects an incorrect code without consuming the OTP, and increments attempts', async () => {
    const roll = '23ABC03';
    await seedOtp(roll, '111111');

    const wrong = await request(app)
      .post('/api/auth/student/verify-otp')
      .send({ rollNumber: roll, code: '999999' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/incorrect/i);

    const rows = await query<{ attempts: number }>(
      'SELECT attempts FROM student_otps WHERE roll_number = $1', [roll]
    );
    expect(rows[0].attempts).toBe(1);

    // The correct code, now that one wrong attempt has been recorded, must
    // still succeed — a single wrong guess should not lock the student out.
    const right = await request(app)
      .post('/api/auth/student/verify-otp')
      .send({ rollNumber: roll, code: '111111' });
    expect(right.status).toBe(200);
  });

  it('locks out verification after OTP_MAX_ATTEMPTS (5) incorrect codes, even with the right code on the next try', async () => {
    const roll = '23ABC04';
    await seedOtp(roll, '222222');

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/student/verify-otp')
        .send({ rollNumber: roll, code: '000000' });
      expect(res.status).toBe(400);
    }

    // The 6th attempt — even with the CORRECT code — must be rejected because
    // the OTP row was deleted once attempts reached the cap.
    const lockedOut = await request(app)
      .post('/api/auth/student/verify-otp')
      .send({ rollNumber: roll, code: '222222' });
    expect(lockedOut.status).toBe(429);

    const rows = await query('SELECT 1 FROM student_otps WHERE roll_number = $1', [roll]);
    expect(rows).toHaveLength(0);
  });

  it('rejects an expired OTP and deletes the stale row', async () => {
    const roll = '23ABC05';
    await seedOtp(roll, '333333', { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(app)
      .post('/api/auth/student/verify-otp')
      .send({ rollNumber: roll, code: '333333' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);

    const rows = await query('SELECT 1 FROM student_otps WHERE roll_number = $1', [roll]);
    expect(rows).toHaveLength(0);
  });

  it('returning students: request-otp ignores client-supplied name/email and sends to the address on file', async () => {
    const roll = '23ABC06';
    await query(
      `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [roll, `IITK-DnA-${roll}-AAAA`, '01 Jan 2026', 'Real Name', 'real.email@iitk.ac.in']
    );

    const res = await request(app)
      .post('/api/auth/student/request-otp')
      .send({ rollNumber: roll, name: 'Spoofed Name', email: 'attacker@iitk.ac.in' });

    expect(res.status).toBe(200);
    expect(res.body.isNew).toBe(false);
    expect(res.body.email).toMatch(/^r\*+@iitk\.ac\.in$/); // masked "real.email"

    const rows = await query<{ email: string }>(
      'SELECT email FROM student_otps WHERE roll_number = $1', [roll]
    );
    expect(rows[0].email).toBe('real.email@iitk.ac.in');
  });

  it('rejects a roll number that fails the format regex', async () => {
    const res = await request(app)
      .post('/api/auth/student/request-otp')
      .send({ rollNumber: 'not-a-roll!', name: 'X', email: 'x@iitk.ac.in' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-IITK email on registration', async () => {
    const res = await request(app)
      .post('/api/auth/student/request-otp')
      .send({ rollNumber: '23xyz09', name: 'X', email: 'x@gmail.com' });
    expect(res.status).toBe(400);
  });
});

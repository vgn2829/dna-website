import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Student identity is carried in a signed JWT (Authorization: Bearer <token>),
// NOT in a client-supplied X-Roll-Number header. The roll number is a claim in
// the token and is therefore trustworthy once the signature verifies.

// Longer session = fewer OTP re-sends against the Resend free-tier quota
// (see mailer.ts's quota gate). 90 days trades a bit more stale-session
// exposure on a lost/shared device for a meaningful cut in login frequency.
const STUDENT_TOKEN_TTL = '90d';

// Bypass-issued tokens are deliberately much shorter-lived than normal (90d)
// sessions: this is the mechanism that makes turning the bypass flag back off
// actually mean something. A student who logged in via bypass stays signed in
// for at most 1 day, then must sign in again — at which point, if the flag is
// off, only real OTP verification will succeed. See routes/auth.ts's
// bypass-login route and the otp_bypass column (audit trail only, not
// re-checked per-request — this TTL is the real enforcement).
const BYPASS_TOKEN_TTL = '1d';

export interface StudentClaims {
  typ: 'student';
  roll: string;
  bypass?: true;
}

export function signStudentToken(roll: string): string {
  return jwt.sign(
    { typ: 'student', roll: roll.trim().toUpperCase() } satisfies StudentClaims,
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: STUDENT_TOKEN_TTL }
  );
}

export function signBypassStudentToken(roll: string): string {
  return jwt.sign(
    { typ: 'student', roll: roll.trim().toUpperCase(), bypass: true } satisfies StudentClaims,
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: BYPASS_TOKEN_TTL }
  );
}

function extractRoll(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as Partial<StudentClaims>;
    if (payload.typ !== 'student' || typeof payload.roll !== 'string') return null;
    return payload.roll.trim().toUpperCase();
  } catch {
    return null;
  }
}

/** Requires a valid student token; sets req.studentRoll or responds 401. */
export function requireStudent(req: Request, res: Response, next: NextFunction): void {
  const roll = extractRoll(req);
  if (!roll) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  req.studentRoll = roll;
  next();
}

/** Sets req.studentRoll if a valid student token is present; never blocks. */
export function optionalStudent(req: Request, _res: Response, next: NextFunction): void {
  const roll = extractRoll(req);
  if (roll) req.studentRoll = roll;
  next();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      studentRoll?: string;
    }
  }
}

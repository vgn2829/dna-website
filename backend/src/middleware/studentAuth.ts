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
  identityVerified?: true;
}

export function signStudentToken(roll: string): string {
  return jwt.sign(
    // Production caller: successful /student/verify-otp only. Legacy tokens
    // remain valid for ordinary routes, but cannot mutate designer identity.
    { typ: 'student', roll: roll.trim().toUpperCase(), identityVerified: true } satisfies StudentClaims,
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

// Exported (not just used via extractRoll below) so non-Express contexts —
// currently the realtime WS upgrade handler, which has no req/res and no
// Express middleware chain to run requireStudent through — can verify the
// same token the same way, rather than reimplementing JWT verification.
export function verifyStudentClaims(token: string): StudentClaims | null {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as Partial<StudentClaims>;
    if (payload.typ !== 'student' || typeof payload.roll !== 'string') return null;
    const roll = payload.roll.trim().toUpperCase();
    if (!roll) return null;
    // Copy only understood, signature-verified claims. Never infer OTP
    // verification merely from the absence of the bypass marker.
    return {
      typ: 'student', roll,
      ...(payload.bypass === true ? { bypass: true as const } : {}),
      ...(payload.identityVerified === true ? { identityVerified: true as const } : {}),
    };
  } catch {
    return null;
  }
}

export function verifyStudentToken(token: string): string | null {
  return verifyStudentClaims(token)?.roll ?? null;
}

/** Identity mutations require an explicit OTP-issued claim, not account flags. */
export function requireVerifiedStudent(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith('Bearer ') ? verifyStudentClaims(auth.slice(7)) : null;
  if (!claims) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  if (claims.identityVerified !== true || claims.bypass === true) {
    res.status(403).json({ error: 'Verify your identity with email OTP before changing account identity' });
    return;
  }
  req.studentRoll = claims.roll;
  next();
}

function extractRoll(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyStudentToken(auth.slice(7));
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

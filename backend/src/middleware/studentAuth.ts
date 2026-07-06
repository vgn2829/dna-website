import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Student identity is carried in a signed JWT (Authorization: Bearer <token>),
// NOT in a client-supplied X-Roll-Number header. The roll number is a claim in
// the token and is therefore trustworthy once the signature verifies.

const STUDENT_TOKEN_TTL = '30d';

export interface StudentClaims {
  typ: 'student';
  roll: string;
}

export function signStudentToken(roll: string): string {
  return jwt.sign(
    { typ: 'student', roll: roll.trim().toUpperCase() } satisfies StudentClaims,
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: STUDENT_TOKEN_TTL }
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

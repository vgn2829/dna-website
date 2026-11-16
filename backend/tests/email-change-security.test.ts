import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';
import { sendOtpEmail } from '../src/services/mailer';
import { localRequest } from './localServer';

// Only delivery is mocked. Routing, JWT verification, OTP hashing and all
// persistence use the real implementations against the disposable test DB.
vi.mock('../src/services/mailer', () => ({
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));

const app = createApp();
const local = localRequest(app);
let clientNumber = 0;
let clientIp: string;
// Keep the real rate limiters enabled. Each scenario gets a separate
// documentation-range IP so one test cannot exhaust another's quota.
const request = (target: typeof app) => {
  const client = local(target);
  return {
    post: (url: string) => client.post(url).set('X-Forwarded-For', clientIp),
    patch: (url: string) => client.patch(url).set('X-Forwarded-For', clientIp),
    get: (url: string) => client.get(url).set('X-Forwarded-For', clientIp),
  };
};
const ROLL = '239901';
const ORIGINAL = 'original.synthetic@iitk.ac.in';
const REPLACEMENT = 'replacement.synthetic@iitk.ac.in';
const CHANGE_CODE = '246810';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const email = async () => (await query<{ email: string }>('SELECT email FROM student_sessions WHERE roll_number=$1', [ROLL]))[0].email;
const pending = () => query('SELECT * FROM student_email_change_otps WHERE roll_number=$1', [ROLL]);
const legacy = () => jwt.sign({ typ: 'student', roll: ROLL }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1h' });

beforeEach(async () => {
  vi.clearAllMocks();
  clientIp = `192.0.2.${++clientNumber}`;
  await query(`INSERT INTO student_sessions(roll_number,unique_id,registered_at,name,email)
    VALUES($1,'synthetic-email-change-account','01 Jan 2026','Synthetic Designer',$2)`, [ROLL, ORIGINAL]);
});
afterEach(() => vi.restoreAllMocks());

async function bypassLogin(): Promise<string> {
  const previous = (await query<{ value: string }>(
    "SELECT value FROM app_settings WHERE key='student_otp_bypass_enabled'"))[0].value;
  // This fixture changes only the isolated test DB and restores its setting
  // immediately. No deployment setting or process environment is changed.
  await query("UPDATE app_settings SET value='true' WHERE key='student_otp_bypass_enabled'");
  try {
    const response = await request(app).post('/api/auth/student/bypass-login').send({ rollNumber: ROLL });
    expect(response.status).toBe(200);
    return response.body.token;
  } finally {
    await query("UPDATE app_settings SET value=$1 WHERE key='student_otp_bypass_enabled'", [previous]);
  }
}

async function seedPendingChange(): Promise<void> {
  const hash = await bcrypt.hash(CHANGE_CODE, 10);
  await query(`INSERT INTO student_email_change_otps(roll_number,new_email,code_hash,expires_at,attempts)
    VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes',0)`, [ROLL, REPLACEMENT, hash]);
}

async function verifiedLogin(): Promise<string> {
  const hash = await bcrypt.hash('135791', 10);
  await query(`INSERT INTO student_otps(roll_number,email,code_hash,name,expires_at,attempts)
    VALUES($1,$2,$3,'Synthetic Designer',NOW()+INTERVAL '10 minutes',0)`, [ROLL, ORIGINAL, hash]);
  const response = await request(app).post('/api/auth/student/verify-otp').send({ rollNumber: ROLL, code: '135791' });
  expect(response.status).toBe(200);
  return response.body.token;
}

async function profile(): Promise<Record<string, unknown>> {
  const response = await request(app).post('/api/designers/me').set(bearer(signStudentToken(ROLL)))
    .send({ handle: 'email-security-designer', displayName: 'Synthetic Designer' });
  expect(response.status).toBe(201);
  return response.body;
}

describe('verified identity required for email changes (PR1-01)', () => {
  it('rejects a real bypass session before creating a challenge or sending email', async () => {
    const token = await bypassLogin();
    const response = await request(app).post('/api/auth/student/change-email/request').set(bearer(token))
      .send({ email: REPLACEMENT });
    expect(response.status).toBe(403);
    expect(await email()).toBe(ORIGINAL);
    expect(await pending()).toHaveLength(0);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it('independently rejects bypass verification of a pre-existing valid challenge', async () => {
    await seedPendingChange();
    const before = await pending();
    const token = await bypassLogin();
    const response = await request(app).post('/api/auth/student/change-email/verify').set(bearer(token))
      .send({ code: CHANGE_CODE });
    expect(response.status).toBe(403);
    expect(await email()).toBe(ORIGINAL);
    expect(await pending()).toEqual(before); // not consumed or otherwise mutated
  });

  it('blocks the complete bypass → email replacement → OTP re-login → designer-write chain', async () => {
    const originalProfile = await profile();
    const token = await bypassLogin();
    await seedPendingChange(); // models a challenge that predates the guard
    const challengeBefore = await pending();

    // Continue the ENTIRE attack path before asserting, so the test proves
    // where re-login sends its OTP and whether any new write token is issued.
    const changeRequest = await request(app).post('/api/auth/student/change-email/request').set(bearer(token))
      .send({ email: REPLACEMENT });
    // Before the fix a successful request replaces the pending challenge.
    // Use that newly delivered code if the request is ever allowed again;
    // otherwise exercise the valid challenge that already existed.
    const changeCode = changeRequest.status === 200
      ? vi.mocked(sendOtpEmail).mock.calls.at(-1)?.[1] : CHANGE_CODE;
    const changeVerify = await request(app).post('/api/auth/student/change-email/verify').set(bearer(token))
      .send({ code: changeCode });
    // Deterministic login OTP differs from the pending change code. Mocking
    // delivery lets the oracle inspect the destination without reading mail.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const loginRequest = await request(app).post('/api/auth/student/request-otp').send({ rollNumber: ROLL, email: REPLACEMENT });
    random.mockRestore();
    const delivered = vi.mocked(sendOtpEmail).mock.calls.at(-1);
    const destination = delivered?.[0];
    // Model mailbox access: the attacker can read mail at the replacement
    // address, but cannot use the original mailbox's login code.
    const attackerCode = destination === REPLACEMENT ? delivered?.[1] : CHANGE_CODE;
    const loginVerify = await request(app).post('/api/auth/student/verify-otp')
      .send({ rollNumber: ROLL, code: attackerCode });
    const resultingToken = typeof loginVerify.body.token === 'string' ? loginVerify.body.token : null;
    const protectedWrite = request(app).patch('/api/designers/me');
    if (resultingToken) protectedWrite.set(bearer(resultingToken));
    const writeResponse = await protectedWrite.send({ displayName: 'Unauthorized replacement' });

    expect({
      changeRequest: changeRequest.status, changeVerify: changeVerify.status,
      deliveredToOriginal: destination === ORIGINAL, otpLogin: loginVerify.status,
      issuedToken: resultingToken !== null, protectedWrite: writeResponse.status,
    }).toEqual({ changeRequest: 403, changeVerify: 403, deliveredToOriginal: true,
      otpLogin: 400, issuedToken: false, protectedWrite: 401 });
    expect(await pending()).toEqual(challengeBefore);
    expect(await email()).toBe(ORIGINAL);
    expect(loginRequest.status).toBe(200);
    expect(destination).toBe(ORIGINAL);
    expect(loginVerify.status).toBe(400);
    expect(resultingToken === null).toBe(true); // never print a token on failure
    expect(writeResponse.status).toBe(401);
    expect((await request(app).get('/api/designers/me').set(bearer(token))).body).toEqual(originalProfile);
  });

  it('rejects legacy and client-forged verification claims on both endpoints without changing pending state', async () => {
    await seedPendingChange();
    const before = await pending();
    const token = legacy();
    const forged = { verified: true, identityVerified: true, bypass: false, ownerRoll: ROLL };
    for (const endpoint of ['request', 'verify']) {
      const response = await request(app).post(`/api/auth/student/change-email/${endpoint}?identityVerified=true&bypass=false`)
        .set(bearer(token)).set('X-Identity-Verified', 'true')
        .send(endpoint === 'request' ? { email: REPLACEMENT, ...forged } : { code: CHANGE_CODE, ...forged });
      expect(response.status).toBe(403);
    }
    expect(await pending()).toEqual(before);
    expect(await email()).toBe(ORIGINAL);
    expect(sendOtpEmail).not.toHaveBeenCalled();
    // Ordinary authenticated access remains available to old sessions.
    expect((await request(app).get('/api/designers/me').set(bearer(token))).status).toBe(200);
    expect((await request(app).get(`/api/students/${ROLL}/progress`).set(bearer(token))).status).toBe(200);
  });

  it('preserves signature and expiry rejection on both email-change endpoints', async () => {
    const tokens = [null, 'malformed-token',
      jwt.sign({ typ: 'student', roll: ROLL, identityVerified: true }, 'synthetic-wrong-signing-material', { expiresIn: '1h' }),
      jwt.sign({ typ: 'student', roll: ROLL, identityVerified: true }, process.env.JWT_SECRET!, { algorithm: 'HS256', expiresIn: -1 }),
    ];
    for (const token of tokens) {
      for (const endpoint of ['request', 'verify']) {
        const req = request(app).post(`/api/auth/student/change-email/${endpoint}`);
        if (token) req.set(bearer(token));
        expect((await req.send(endpoint === 'request' ? { email: REPLACEMENT } : { code: CHANGE_CODE })).status).toBe(401);
      }
    }
    expect(await email()).toBe(ORIGINAL);
    expect(await pending()).toHaveLength(0);
  });

  it('preserves the complete legitimate email-change flow for an OTP-verified session', async () => {
    const token = await verifiedLogin();
    const changeRequest = await request(app).post('/api/auth/student/change-email/request').set(bearer(token))
      .send({ email: REPLACEMENT });
    expect(changeRequest.status).toBe(200);
    expect(await email()).toBe(ORIGINAL); // request alone does not change identity
    const code = vi.mocked(sendOtpEmail).mock.calls.at(-1)?.[1];
    expect(typeof code === 'string').toBe(true);
    const verification = await request(app).post('/api/auth/student/change-email/verify').set(bearer(token)).send({ code });
    expect(verification.status).toBe(200);
    expect(await email()).toBe(REPLACEMENT);
    expect(await pending()).toHaveLength(0);
    expect((await request(app).get('/api/designers/me').set(bearer(token))).status).toBe(200);
    await request(app).post('/api/auth/student/request-otp').send({ rollNumber: ROLL });
    expect(vi.mocked(sendOtpEmail).mock.calls.at(-1)?.[0]).toBe(REPLACEMENT);
  });
});

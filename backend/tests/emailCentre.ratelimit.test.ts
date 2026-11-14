import { describe, it, expect, beforeAll } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';

// Separate file = separate module registry = fresh in-memory rate-limit counters.
delete process.env.EMAIL_CENTRE_RATE_MULTIPLIER;

const app = createApp();
const request = localRequest(app);
let token = '';

describe('Email Centre rate limiting', () => {
  beforeAll(async () => {
    token = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token;
  });

  it('throttles the send-capable endpoints (10/min) and returns 429 afterwards', async () => {
    const payload = { mode: 'normal', subject: { default: 's' }, doc: { type: 'doc', content: [] }, recipients: [] };
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await request(app).post('/api/email/test').set('Authorization', `Bearer ${token}`).send({ payload, testEmail: 'not-an-email' })).status);
    }
    expect(statuses.slice(0, 10).every(s => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

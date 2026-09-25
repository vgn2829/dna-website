import { describe, it, expect } from 'vitest';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { signStudentToken } from '../src/middleware/studentAuth';

// ─────────────────────────────────────────────────────────────────────────
// V3.2.2 — CORS preflights are cacheable (Access-Control-Max-Age), and
// nothing about WHAT is allowed changed: same origins, methods, headers,
// no credentials, disallowed origins still rejected.
// ─────────────────────────────────────────────────────────────────────────

const app = createApp();
// One loopback (127.0.0.1) server for this file — see tests/localServer.ts.
const request = localRequest(app);
const ALLOWED = 'http://localhost:5173'; // tests/env.ts CORS_ORIGINS

const preflight = (origin: string, method = 'GET', headers = 'authorization,content-type') =>
  request(app).options('/api/workspaces')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', method)
    .set('Access-Control-Request-Headers', headers);

describe('CORS preflight caching', () => {
  it('an allowed-origin preflight succeeds and is cacheable for 10 minutes', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await preflight(ALLOWED, method);
      expect(res.status, method).toBe(204);
      expect(res.headers['access-control-max-age']).toBe('600');
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS');
      expect(res.headers['access-control-allow-headers']).toBe('Content-Type,Authorization');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      expect(res.headers.vary).toMatch(/Origin/);
    }
  });

  it('a disallowed origin is still rejected (and gets no max-age)', async () => {
    const res = await preflight('https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-max-age']).toBeUndefined();
  });

  it('actual requests are unchanged: allow-origin set, no max-age on non-preflight responses', async () => {
    const res = await request(app).get('/api/workspaces')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${signStudentToken('CORS1')}`);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-max-age']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

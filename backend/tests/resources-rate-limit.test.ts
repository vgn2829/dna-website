import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';

// Kept in its own file: submitLimiter (like every rate limiter in this
// codebase, e.g. artworks.ts's commentLimiter) is a module-level singleton
// shared across every createApp() call in one process, and its MemoryStore
// keys by IP — so any test running in the same file/process before this one
// that hits POST /api/resources (even with an invalid payload that gets
// rejected, since rejected requests still count) pushes this test closer to
// its own limit before it even starts. A separate file gives it the cleanest
// possible run.
const app = createApp();

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4)
     ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student RateLimit`, 'ratelimit@iitk.ac.in']
  );
}

const validSubmission = {
  title: 'Rate Limit Probe',
  url: 'https://example.com/probe',
  author: 'Test',
  type: 'video' as const,
  level: 'Beginner' as const,
  durationLabel: '5m',
  tags: [],
};

describe('Resources: submission rate limit', () => {
  it('allows up to 10 submissions per minute, then blocks the 11th', async () => {
    await registerStudent('23RATELIMIT');
    const token = signStudentToken('23RATELIMIT');

    const results: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/resources')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validSubmission, title: `Submission ${i}` });
      results.push(res.status);
    }

    expect(results.slice(0, 10).every(s => s === 201)).toBe(true);
    expect(results[10]).toBe(429);
  });
});

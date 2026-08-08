import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { signStudentToken } from '../src/middleware/studentAuth';

const app = createApp();

async function createEvent(capacity: number): Promise<string> {
  const id = `evt-test-${Math.random().toString(36).slice(2, 8)}`;
  await query(
    `INSERT INTO events (id,title,date,time,location,content,capacity,registered_count)
     VALUES ($1,'Test Event','2026-12-01','5 PM','LHC','desc',$2,0)`,
    [id, capacity]
  );
  return id;
}

async function registerStudent(roll: string): Promise<void> {
  await query(
    `INSERT INTO student_sessions(roll_number, unique_id, registered_at, name, email)
     VALUES ($1, $2, '01 Jan 2026', $3, $4)
     ON CONFLICT (roll_number) DO NOTHING`,
    [roll, `IITK-DnA-${roll}-AAAA`, `Student ${roll}`, `${roll.toLowerCase()}@iitk.ac.in`]
  );
}

function tokenFor(roll: string): string {
  return signStudentToken(roll);
}

describe('Event RSVP capacity handling', () => {
  it('allows RSVP while under capacity and reports the updated count', async () => {
    const eventId = await createEvent(2);
    await registerStudent('23CAP01');

    const res = await request(app)
      .post(`/api/events/${eventId}/rsvp`)
      .set('Authorization', `Bearer ${tokenFor('23CAP01')}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ registeredCount: 1, isRegistered: true });
  });

  it('toggles off an existing RSVP and decrements the count', async () => {
    const eventId = await createEvent(5);
    await registerStudent('23CAP02');
    const auth = { Authorization: `Bearer ${tokenFor('23CAP02')}` };

    const first = await request(app).post(`/api/events/${eventId}/rsvp`).set(auth).send({});
    expect(first.body).toEqual({ registeredCount: 1, isRegistered: true });

    const second = await request(app).post(`/api/events/${eventId}/rsvp`).set(auth).send({});
    expect(second.body).toEqual({ registeredCount: 0, isRegistered: false });
  });

  it('rejects RSVP once the event is at capacity', async () => {
    const eventId = await createEvent(1);
    await registerStudent('23CAP03');
    await registerStudent('23CAP04');

    const first = await request(app)
      .post(`/api/events/${eventId}/rsvp`)
      .set('Authorization', `Bearer ${tokenFor('23CAP03')}`)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.registeredCount).toBe(1);

    const second = await request(app)
      .post(`/api/events/${eventId}/rsvp`)
      .set('Authorization', `Bearer ${tokenFor('23CAP04')}`)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/at capacity/i);

    const rows = await query<{ registered_count: number }>(
      'SELECT registered_count FROM events WHERE id = $1', [eventId]
    );
    expect(rows[0].registered_count).toBe(1);
  });

  // The route wraps the capacity check + insert + counter update in a single
  // transaction with `SELECT ... FOR UPDATE` on the event row specifically so
  // concurrent RSVPs at the capacity boundary can't both pass the check and
  // together overshoot capacity. This is the concrete race the audit report
  // flagged as needing coverage — verify it holds under real concurrency, not
  // just sequential calls.
  it('never overshoots capacity when many students RSVP concurrently for the last spot', async () => {
    const CAPACITY = 3;
    const CONCURRENT_STUDENTS = 10;
    const eventId = await createEvent(CAPACITY);

    const rolls = Array.from({ length: CONCURRENT_STUDENTS }, (_, i) => `23RACE${String(i).padStart(2, '0')}`);
    await Promise.all(rolls.map(registerStudent));

    const responses = await Promise.all(
      rolls.map(roll =>
        request(app)
          .post(`/api/events/${eventId}/rsvp`)
          .set('Authorization', `Bearer ${tokenFor(roll)}`)
          .send({})
      )
    );

    const succeeded = responses.filter(r => r.status === 200 && r.body.isRegistered === true);
    const rejected = responses.filter(r => r.status === 409);

    expect(succeeded).toHaveLength(CAPACITY);
    expect(rejected).toHaveLength(CONCURRENT_STUDENTS - CAPACITY);

    const rows = await query<{ registered_count: number }>(
      'SELECT registered_count FROM events WHERE id = $1', [eventId]
    );
    expect(rows[0].registered_count).toBe(CAPACITY);

    const rsvpRows = await query('SELECT roll_number FROM event_rsvps WHERE event_id = $1', [eventId]);
    expect(rsvpRows).toHaveLength(CAPACITY);
  });

  it('rejects RSVP without a valid student token', async () => {
    const eventId = await createEvent(5);
    const res = await request(app).post(`/api/events/${eventId}/rsvp`).send({});
    expect(res.status).toBe(401);
  });

  it('returns 404 for RSVP against a nonexistent event', async () => {
    const res = await request(app)
      .post('/api/events/evt-does-not-exist/rsvp')
      .set('Authorization', `Bearer ${tokenFor('23CAP99')}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('rejects a new RSVP after the two-hour post-start window', async () => {
    const eventId = `evt-past-${Math.random().toString(36).slice(2, 8)}`;
    await query(
      `INSERT INTO events (id,title,date,time,location,content,capacity,registered_count,starts_at)
       VALUES ($1,'Past Event','2026-08-07','6 PM','LHC','desc',5,0,'2026-08-07T18:00:00+05:30')`,
      [eventId]
    );
    await registerStudent('23PAST01');

    const res = await request(app)
      .post(`/api/events/${eventId}/rsvp`)
      .set('Authorization', `Bearer ${tokenFor('23PAST01')}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no longer accepting/i);
  });

  it('preserves registrations when an admin edits event details', async () => {
    const eventId = await createEvent(3);
    await registerStudent('23EDIT01');
    const studentAuth = { Authorization: `Bearer ${tokenFor('23EDIT01')}` };
    const rsvp = await request(app).post(`/api/events/${eventId}/rsvp`).set(studentAuth).send({});
    expect(rsvp.body).toMatchObject({ registeredCount: 1, isRegistered: true });

    const adminLogin = await request(app)
      .post('/api/auth/admin/login')
      .send({ password: process.env.ADMIN_PASSWORD });
    const res = await request(app)
      .put(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({ date: '2026-12-02', time: '6:30 PM', startsAt: '2026-12-02T18:30:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body.registeredCount).toBe(1);
    const rows = await query<{ registered_count: number }>('SELECT registered_count FROM events WHERE id=$1', [eventId]);
    expect(rows[0].registered_count).toBe(1);
  });

  it("admin cannot lower an event's capacity below its current registration count", async () => {
    const eventId = await createEvent(2);
    await registerStudent('23CAP10');
    await registerStudent('23CAP11');
    await request(app).post(`/api/events/${eventId}/rsvp`).set('Authorization', `Bearer ${tokenFor('23CAP10')}`).send({});
    await request(app).post(`/api/events/${eventId}/rsvp`).set('Authorization', `Bearer ${tokenFor('23CAP11')}`).send({});

    // Manually ensure registered_count is updated on the event record
    await query('UPDATE events SET registered_count = 2 WHERE id = $1', [eventId]);

    const adminLogin = await request(app)
      .post('/api/auth/admin/login')
      .send({ password: process.env.ADMIN_PASSWORD });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.token;

    const res = await request(app)
      .put(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot be below current registrations/i);
  });
});

import { describe, it, expect } from 'vitest';
import { query } from '../src/db/client';
import { deriveBatch, selectTargetRecipients, getAvailableBatches } from '../src/services/activityService';

describe('Activity Engine & Batch Derivation', () => {
  it('derives batch accurately from roll numbers', () => {
    expect(deriveBatch('260012')).toBe('Y26');
    expect(deriveBatch('250106')).toBe('Y25');
    expect(deriveBatch('240007')).toBe('Y24');
    expect(deriveBatch('231140')).toBe('Y23');
    expect(deriveBatch('190001')).toBe('Other');
    expect(deriveBatch('999999')).toBe('Other');
  });

  it('selects and ranks active users deterministically with dynamic batch filter', async () => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Insert test users
    await query(`
      INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email, last_login)
      VALUES
        ('260001', 'u1', $1, 'Active Y26 Student A', 'a26@iitk.ac.in', $2::timestamptz),
        ('260002', 'u2', $1, 'Less Active Y26 Student B', 'b26@iitk.ac.in', $3::timestamptz),
        ('250001', 'u3', $1, 'Active Y25 Student C', 'c25@iitk.ac.in', $2::timestamptz)
    `, [tenDaysAgo, dayAgo, tenDaysAgo]);

    // Add extra activity for 260001 (RSVP and login event)
    await query(`INSERT INTO login_events (id, roll_number, logged_in_at) VALUES ('le-unique-' || gen_random_uuid()::text, '260001', NOW())`);

    const availableBatches = await getAvailableBatches();
    expect(availableBatches).toContain('Y25');
    expect(availableBatches).toContain('Y26');

    // Query Y26 users
    const resultY26 = await selectTargetRecipients({
      audienceType: 'active',
      batch: 'Y26',
      limit: 10,
    });

    expect(resultY26.totalEligible).toBe(2);
    expect(resultY26.candidates.length).toBe(2);
    expect(resultY26.candidates[0].rollNumber).toBe('260001');
    expect(resultY26.candidates[0].activityScore).toBeGreaterThan(resultY26.candidates[1].activityScore);
  });

  it('correctly handles deduplication exclusions by status', async () => {
    const regTime = new Date().toISOString();
    const loginTime = new Date();
    await query(`
      INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email, last_login)
      VALUES
        ('260100', 'u100', $1, 'User 1', 'u100@iitk.ac.in', $2),
        ('260200', 'u200', $1, 'User 2', 'u200@iitk.ac.in', $2)
    `, [regTime, loginTime]);

    await query(`
      INSERT INTO events (id, title, date, time, location, content, capacity)
      VALUES ('evt-photoshop', 'Photoshop Workshop', '2026-08-08', '10:00 AM', 'LHC', 'Content', 100)
    `);

    await query(`
      INSERT INTO email_campaigns (id, event_id, title, subject, audience_type, requested_limit, status)
      VALUES ('cmp-photoshop', 'evt-photoshop', 'Photoshop Campaign', 'Subject', 'active', 50, 'completed')
    `);

    // User 1 has status 'sent' (should be excluded)
    // User 2 has status 'queued' (should NOT be excluded)
    await query(`
      INSERT INTO email_recipients (campaign_id, event_id, roll_number, email, status)
      VALUES
        ('cmp-photoshop', 'evt-photoshop', '260100', 'u100@iitk.ac.in', 'sent'),
        ('cmp-photoshop', 'evt-photoshop', '260200', 'u200@iitk.ac.in', 'queued')
    `);

    const result = await selectTargetRecipients({
      audienceType: 'active',
      batch: 'Y26',
      limit: 10,
      excludeEventIds: ['evt-photoshop'],
    });

    const rollNumbers = result.candidates.map(c => c.rollNumber);
    expect(rollNumbers).not.toContain('260100'); // 'sent' is excluded
    expect(rollNumbers).toContain('260200');     // 'queued' is NOT excluded
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { query } from '../src/db/client';

const app = createApp();

let adminToken: string;

describe('Campaign & Recipient Targeting API', () => {
  beforeAll(async () => {
    // Authenticate as admin to get token
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ password: process.env.ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    adminToken = res.body.token;
  });

  it('GET /api/notify/batches returns available student batches', async () => {
    await query(`
      INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email)
      VALUES
        ('260001', 'u1', NOW()::text, 'Student 26', 's26@iitk.ac.in'),
        ('250001', 'u2', NOW()::text, 'Student 25', 's25@iitk.ac.in')
    `);

    const res = await request(app)
      .get('/api/notify/batches')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.batches).toContain('Y25');
    expect(res.body.batches).toContain('Y26');
  });

  it('GET /api/notify/usage returns daily quota status', async () => {
    const res = await request(app)
      .get('/api/notify/usage')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.dailyLimit).toBe(100);
    expect(res.body.broadcastBudget).toBeGreaterThanOrEqual(0);
  });

  it('POST /api/notify/preview computes read-only ranking and quota check without mutating DB', async () => {
    await query(`
      INSERT INTO events (id, title, date, time, location, content, capacity)
      VALUES ('evt-test-1', 'Test Event 1', '2026-08-08', '10:00 AM', 'LHC', 'Details', 100)
    `);

    const res = await request(app)
      .post('/api/notify/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        eventId: 'evt-test-1',
        audienceType: 'active',
        batch: 'Y26',
        limit: 10,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalEligible');
    expect(res.body).toHaveProperty('quotaStatus');
    expect(Array.isArray(res.body.candidates)).toBe(true);

    // Verify DB has no campaign created during preview
    const campaigns = await query('SELECT COUNT(*)::int AS count FROM email_campaigns');
    expect(campaigns[0].count).toBe(0);
  });

  it('POST /api/notify/event/:id executes transactional campaign send and creates recipient logs', async () => {
    await query(`
      INSERT INTO events (id, title, date, time, location, content, capacity)
      VALUES ('evt-ps', 'Photoshop Workshop', '2026-08-08', '10:00 AM', 'LHC', 'Details', 100)
    `);

    await query(`
      INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email, last_login)
      VALUES
        ('260010', 'u10', NOW()::text, 'Alice', 'alice@iitk.ac.in', NOW()),
        ('260011', 'u11', NOW()::text, 'Bob', 'bob@iitk.ac.in', NOW())
    `);

    const res = await request(app)
      .post('/api/notify/event/evt-ps')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        audienceType: 'active',
        batch: 'Y26',
        limit: 50,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sentNow).toBe(2);

    const recipients = await query<{ roll_number: string; status: string }>(
      'SELECT roll_number, status FROM email_recipients WHERE event_id = $1',
      ['evt-ps']
    );
    expect(recipients.length).toBe(2);
    expect(recipients[0].status).toBe('sent');
  });

  it('POST /api/notify/webhooks/resend updates recipient delivery status', async () => {
    // Create an email recipient entry with mock provider_message_id
    const msgId = 'msg_test_webhook_123';
    await query(`
      INSERT INTO events (id, title, date, time, location, content, capacity)
      VALUES ('evt-wh', 'Webhook Test Event', '2026-08-08', '10:00 AM', 'LHC', 'Details', 100)
    `);
    await query(`
      INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email)
      VALUES ('260999', 'u999', NOW()::text, 'Test User', 'test999@iitk.ac.in')
    `);
    await query(`
      INSERT INTO email_campaigns (id, event_id, title, subject, audience_type, requested_limit, status)
      VALUES ('cmp-wh', 'evt-wh', 'Webhook Campaign', 'Subject', 'all', 50, 'completed')
    `);
    await query(`
      INSERT INTO email_recipients (campaign_id, event_id, roll_number, email, status, provider_message_id)
      VALUES ('cmp-wh', 'evt-wh', '260999', 'test999@iitk.ac.in', 'sent', $1)
    `, [msgId]);

    // Send delivery webhook notification
    const res = await request(app)
      .post('/api/notify/webhooks/resend')
      .send({
        type: 'email.delivered',
        data: {
          email_id: msgId,
          recipient: 'test999@iitk.ac.in',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.handled).toBe(true);

    const updated = await query<{ status: string }>(
      'SELECT status FROM email_recipients WHERE provider_message_id = $1',
      [msgId]
    );
    expect(updated[0].status).toBe('delivered');
  });

  it('simulates Photoshop -> Blender workflow with sent, delivered, queued, failed, bounced, suppressed status rules', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Create 60 mock Y26 students with varying activity levels (roll numbers 260001 to 260060)
    for (let i = 1; i <= 60; i++) {
      const roll = `2600${i < 10 ? '0' + i : i}`;
      const email = `student${i}@iitk.ac.in`;

      await query(
        `INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email, last_login)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
        [roll, `u-${i}`, tenDaysAgo, `Student ${i}`, email, tenDaysAgo]
      );

      // Add login activity proportional to index (student 1 highest score)
      if (i <= 50) {
        await query(
          `INSERT INTO login_events (id, roll_number, logged_in_at) VALUES ('le-ps-' || gen_random_uuid()::text, $1, NOW())`,
          [roll]
        );
      }
    }

    // 2. Setup Photoshop event and campaign
    await query(`
      INSERT INTO events (id, title, date, time, location, content, capacity)
      VALUES ('evt-photoshop', 'Photoshop Workshop', '2026-08-08', '10:00 AM', 'LHC', 'Details', 100)
    `);

    await query(`
      INSERT INTO email_campaigns (id, event_id, title, subject, audience_type, requested_limit, status)
      VALUES ('cmp-photoshop', 'evt-photoshop', 'Photoshop Campaign', 'Subject', 'active', 50, 'completed')
    `);

    // 3. Populate email_recipients for Photoshop with specific statuses:
    // 260001 to 260040: delivered / sent
    // 260041 to 260045: queued
    // 260046 to 260048: failed
    // 260049: bounced
    // 260050: suppressed
    for (let i = 1; i <= 50; i++) {
      const roll = `2600${i < 10 ? '0' + i : i}`;
      let status = 'sent';
      if (i <= 35) status = 'delivered';
      else if (i <= 40) status = 'sent';
      else if (i <= 45) status = 'queued';
      else if (i <= 48) status = 'failed';
      else if (i === 49) status = 'bounced';
      else if (i === 50) status = 'suppressed';

      await query(
        `INSERT INTO email_recipients (campaign_id, event_id, roll_number, email, status, activity_score)
         VALUES ('cmp-photoshop', 'evt-photoshop', $1, $2, $3, 80)`,
        [roll, `student${i}@iitk.ac.in`, status]
      );
    }

    // 4. Day 2: Setup Blender Workshop notification with Exclude: Photoshop Workshop
    await query(`
      INSERT INTO events (id, title, date, time, location, content, capacity)
      VALUES ('evt-blender', 'Blender Workshop', '2026-08-09', '10:00 AM', 'LHC', 'Details', 100)
    `);

    const previewRes = await request(app)
      .post('/api/notify/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        eventId: 'evt-blender',
        audienceType: 'active',
        batch: 'Y26',
        limit: 50,
        excludeEventIds: ['evt-photoshop'],
      });

    expect(previewRes.status).toBe(200);

    const selectedRolls: string[] = previewRes.body.candidates.map((c: any) => c.rollNumber);

    // VERIFICATIONS:
    // A1-A40 (delivered/sent): EXCLUDED
    for (let i = 1; i <= 40; i++) {
      const roll = `2600${i < 10 ? '0' + i : i}`;
      expect(selectedRolls).not.toContain(roll);
    }

    // A49 (bounced) & A50 (suppressed): EXCLUDED
    expect(selectedRolls).not.toContain('260049');
    expect(selectedRolls).not.toContain('260050');

    // A41-A45 (queued) & A46-A48 (failed): ELIGIBLE
    for (let i = 41; i <= 48; i++) {
      const roll = `2600${i}`;
      expect(selectedRolls).toContain(roll);
    }

    // Next ranked active users (A51-A60): ELIGIBLE & SELECTED
    for (let i = 51; i <= 60; i++) {
      const roll = `2600${i}`;
      expect(selectedRolls).toContain(roll);
    }
  });
});

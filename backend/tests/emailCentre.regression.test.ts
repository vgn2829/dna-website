import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Regression guard: the Email Centre was added alongside the legacy email paths and must
// not have changed them. Resend is mocked — no real mail is ever sent.
const sends = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn(async (payload: Record<string, unknown>) => { sends.push(payload); return { data: { id: 'mock_id' }, error: null }; }) };
    batch = { send: vi.fn(async (batch: Record<string, unknown>[]) => { sends.push(...batch); return { data: { data: batch.map((_, i) => ({ id: `b${i}` })) }, error: null }; }) };
  },
}));

import { query } from '../src/db/client';
import {
  sendOtpEmail, sendWelcomeEmail, sendEventNotification, sendArtworkNotification, sendCustomAnnouncement,
  sendEventReminders, drainMailQueue, broadcastBudgetRemaining, renderOtpHtml,
} from '../src/services/mailer';
import { createAndExecuteCampaign, getPastCampaigns } from '../src/services/campaignService';
import { handleResendWebhook } from '../src/services/campaignService';

const prevKey = process.env.RESEND_API_KEY;
beforeAll(() => { process.env.RESEND_API_KEY = 're_test_key'; });
afterAll(() => { if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey; });
beforeEach(() => { sends.length = 0; });

const usage = async () => (await query<{ sent_count: number }>(`SELECT sent_count FROM mail_usage WHERE day = (NOW() AT TIME ZONE 'UTC')::date`))[0]?.sent_count ?? 0;

async function seedStudents(n: number) {
  for (let i = 0; i < n; i++) {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ($1,$2,NOW()::text,$3,$4)`,
      [`2500${String(i).padStart(2, '0')}`, `u${i}`, `Student ${i}`, `s${i}@iitk.ac.in`]);
  }
}

describe('legacy email paths still behave as before', () => {
  it('OTP email: single send to the student, OTP template, counted in usage', async () => {
    await sendOtpEmail('otp@iitk.ac.in', '123456');
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ to: 'otp@iitk.ac.in', subject: 'Your DnA Club verification code' });
    expect(sends[0].html).toBe(renderOtpHtml('123456'));
    expect(await usage()).toBe(1);
  });

  it('OTP email without a key still no-ops (dev flow)', async () => {
    delete process.env.RESEND_API_KEY;
    try { await sendOtpEmail('dev@iitk.ac.in', '654321'); expect(sends).toHaveLength(0); }
    finally { process.env.RESEND_API_KEY = 're_test_key'; }
  });

  it('welcome email: personalised, reports success so callers can stamp it', async () => {
    expect(await sendWelcomeEmail('Aarav Sharma', 'aarav@iitk.ac.in')).toBe(true);
    expect(sends[0]).toMatchObject({ to: 'aarav@iitk.ac.in' });
    expect(String(sends[0].html)).toContain('Aarav Sharma');
  });

  it('event notification: BCC broadcast in 50-chunks through the quota gate', async () => {
    await seedStudents(3);
    const res = await sendEventNotification({ id: 'e1', title: 'Figma Sprint', date: '2026-06-12', venue: 'LHC-3', description: 'd' });
    expect(res).toEqual({ sentNow: 3, queued: 0 });
    expect(sends).toHaveLength(1);
    expect((sends[0].bcc as string[]).sort()).toEqual(['s0@iitk.ac.in', 's1@iitk.ac.in', 's2@iitk.ac.in']);
    expect(String(sends[0].subject)).toContain('Figma Sprint');
    expect(await usage()).toBe(4); // 3 BCC + the fixed `to:` recipient
  });

  it('artwork notification and custom announcement still broadcast', async () => {
    await seedStudents(2);
    expect(await sendArtworkNotification({ title: 'Ethereal', artist: 'Vikram', domain: '3D' })).toEqual({ sentNow: 2, queued: 0 });
    expect(String(sends[0].subject)).toContain('Ethereal');
    const ann = await sendCustomAnnouncement('Hello all', '<p>hi</p>', ['a@x.com', 'b@x.com']);
    expect(ann).toEqual({ sentNow: 2, queued: 0 });
    expect(sends[1]).toMatchObject({ subject: 'Hello all' });
    expect(String(sends[1].html)).toContain('<p>hi</p>');
  });

  it('announcements beyond today\'s budget are queued in mail_queue and drained later', async () => {
    const budget = await broadcastBudgetRemaining();
    const emails = Array.from({ length: budget + 5 }, (_, i) => `q${i}@x.com`);
    const res = await sendCustomAnnouncement('Big', '<p>x</p>', emails);
    expect(res.queued).toBeGreaterThan(0);
    expect((await query('SELECT 1 FROM mail_queue WHERE completed_at IS NULL')).length).toBe(1);
    await query('UPDATE mail_usage SET sent_count = 0');
    await drainMailQueue();
    expect((await query('SELECT 1 FROM mail_queue WHERE completed_at IS NULL')).length).toBe(0);
  });

  it('event reminders: one personalised email per RSVP', async () => {
    const out = await sendEventReminders([
      { eventId: 'e1', rollNumber: '250001', email: 'a@x.com', name: 'Asha', title: 'Sprint', date: '2026-06-12', time: '6pm', venue: 'LHC' },
      { eventId: 'e1', rollNumber: '250002', email: 'b@x.com', name: null, title: 'Sprint', date: '2026-06-12', time: '6pm', venue: 'LHC' },
    ]);
    expect(out.sent).toHaveLength(2);
    expect(sends.map(s => s.to)).toEqual(['a@x.com', 'b@x.com']);
    expect(String(sends[0].html)).toContain('Asha');
    expect(String(sends[1].html)).toContain('there');
  });

  it('campaign dispatch + history + webhook tracking are intact', async () => {
    await seedStudents(3);
    const result = await createAndExecuteCampaign({ audienceType: 'all', limit: 50 }, { title: 'Legacy campaign', subject: 'S', html: '<p>h</p>' });
    expect(result).toMatchObject({ success: true, sentNow: 3, queued: 0 });
    const past = await getPastCampaigns();
    expect(past.map(c => c.title)).toContain('Legacy campaign');
    expect(await handleResendWebhook({ type: 'email.delivered', data: { email_id: 'b0' } })).toBe(true);
    expect((await query(`SELECT 1 FROM email_recipients WHERE status='delivered'`)).length).toBeGreaterThan(0);
  });

  it('legacy templates API is untouched (separate table from the Email Centre ones)', async () => {
    const legacy = await query<{ id: string }>('SELECT id FROM email_templates ORDER BY id');
    expect(legacy.map(r => r.id)).toEqual(expect.arrayContaining(['welcome', 'new_event', 'new_artwork']));
    const ec = await query<{ id: string }>('SELECT id FROM ec_templates');
    expect(ec.every(r => r.id.startsWith('tpl_'))).toBe(true);
  });
});

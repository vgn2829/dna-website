import { Resend } from 'resend';
import { pool } from '../db/client';

// From-address for all outgoing mail (imported by routes/notify.ts too).
// Set MAIL_FROM to an address on a Resend-VERIFIED domain, e.g.
// "DnA Club IITK <no-reply@dnaiitk.site>". If unset, we fall back to Resend's
// shared sandbox address, which only delivers to the Resend account owner
// (every other recipient returns 403) — fine for local dev, not production.
const SANDBOX_FROM = 'DnA Club IITK <onboarding@resend.dev>';
export const MAIL_FROM = process.env.MAIL_FROM ?? SANDBOX_FROM;

if (!process.env.MAIL_FROM) {
  console.warn(
    'MAIL_FROM not set — falling back to the Resend sandbox address. Delivery is ' +
    'limited to the Resend account owner; set MAIL_FROM to a verified-domain address.'
  );
}

// Construct the Resend client lazily. Its constructor throws when the key is
// missing, so building it at import time would crash the whole app on boot in
// dev (where email is optional and OTP codes are logged to the console instead).
// Callers only reach resendClient() after checking RESEND_API_KEY is set.
let _resend: Resend | null = null;
function resendClient(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

if (process.env.RESEND_API_KEY) {
  console.log('Email service ready (Resend)');
} else {
  console.warn('RESEND_API_KEY not set — emails will not be sent (OTP codes log to console)');
}

async function getAllStudentEmails(): Promise<string[]> {
  try {
    const result = await pool.query(
      'SELECT email FROM student_sessions WHERE email IS NOT NULL'
    );
    return result.rows
      .map((r: { email: string }) => r.email)
      .filter(Boolean);
  } catch (err) {
    console.error('Failed to fetch student emails:', err);
    return [];
  }
}

// Only students who RSVP'd to this specific event — used when the admin
// chooses "Registered only" instead of the default "All students" audience.
async function getRegisteredStudentEmails(eventId: string): Promise<string[]> {
  try {
    const result = await pool.query(`
      SELECT ss.email FROM event_rsvps r
      JOIN student_sessions ss ON ss.roll_number = r.roll_number
      WHERE r.event_id = $1 AND ss.email IS NOT NULL
    `, [eventId]);
    return result.rows
      .map((r: { email: string }) => r.email)
      .filter(Boolean);
  } catch (err) {
    console.error('Failed to fetch registered student emails:', err);
    return [];
  }
}

// ── Quota gate ──────────────────────────────────────────────────────────────
// Resend free tier: 100 emails/day, 3,000/month, and every To/CC/BCC recipient
// counts separately. OTP and welcome mail must never be blocked by this gate —
// they call resendClient() directly and always increment usage after sending.
// Broadcast sends (event/artwork notify, announcements, reminders) call
// broadcastBudgetRemaining() first, which reads (not reserves) how much
// headroom is left for OTP/welcome, scaling with the current roster size, so
// a big notify send on a busy login day can't starve logins. This is a read,
// not a lock — two broadcasts started concurrently could both see the same
// budget and together exceed it slightly; acceptable here since sends are
// admin-triggered one at a time in practice, not high-concurrency.
const DAILY_QUOTA = 100;
const MONTHLY_QUOTA = 3000;
const MONTHLY_SAFETY_BUFFER = 100; // stop broadcasts before hard-hitting 3000

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getDailySent(day: string): Promise<number> {
  const rows = await pool.query<{ sent_count: number }>(
    'SELECT sent_count FROM mail_usage WHERE day = $1', [day]
  );
  return rows.rows[0]?.sent_count ?? 0;
}

async function getMonthSent(): Promise<number> {
  const monthStart = `${todayUtc().slice(0, 7)}-01`;
  const rows = await pool.query<{ total: string }>(
    'SELECT COALESCE(SUM(sent_count),0) AS total FROM mail_usage WHERE day >= $1', [monthStart]
  );
  return parseInt(rows.rows[0]?.total ?? '0', 10);
}

// Increments today's usage counter. Called after every actual send (OTP,
// welcome, and broadcast batches alike) so the gate always sees real usage.
async function recordSent(count: number): Promise<void> {
  if (count <= 0) return;
  await pool.query(`
    INSERT INTO mail_usage (day, sent_count) VALUES ($1, $2)
    ON CONFLICT (day) DO UPDATE SET sent_count = mail_usage.sent_count + $2
  `, [todayUtc(), count]);
}

// Reserve = half the roster, capped at 60, floored at a small constant so it's
// never zero for a tiny roster. Scales automatically as students are added.
async function otpReserve(): Promise<number> {
  const rows = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM student_sessions WHERE email IS NOT NULL'
  );
  const studentCount = parseInt(rows.rows[0]?.count ?? '0', 10);
  return Math.max(5, Math.min(60, Math.ceil(studentCount * 0.5)));
}

// How many more broadcast recipients can be sent today without endangering
// the OTP reserve or the monthly cap. Never negative.
export async function broadcastBudgetRemaining(): Promise<number> {
  const [sentToday, sentMonth, reserve] = await Promise.all([
    getDailySent(todayUtc()), getMonthSent(), otpReserve(),
  ]);
  const dailyRoom = Math.max(0, (DAILY_QUOTA - reserve) - sentToday);
  const monthlyRoom = Math.max(0, (MONTHLY_QUOTA - MONTHLY_SAFETY_BUFFER) - sentMonth);
  return Math.min(dailyRoom, monthlyRoom);
}

async function getTemplate(id: string): Promise<{ subject: string; body: string } | null> {
  try {
    const result = await pool.query(
      'SELECT subject, body FROM email_templates WHERE id = $1',
      [id]
    );
    return result.rows.length > 0 ? (result.rows[0] as { subject: string; body: string }) : null;
  } catch (err) {
    console.error(`Failed to fetch template "${id}":`, err);
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Single-pass {{placeholder}} substitution. Because each placeholder is replaced
// exactly once from the map, a value that itself contains "{{other}}" cannot be
// re-expanded. When `escape` is set (HTML bodies), values are HTML-escaped so
// user-supplied fields (name, title, …) can't inject markup.
function resolve(template: string, vars: Record<string, string>, escape = false): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const val = vars[`{{${key}}}`];
    if (val === undefined) return match;
    return escape ? escapeHtml(val) : val;
  });
}

function getBaseTemplate(content: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;
      background:#0a0a0a;color:#ffffff;border-radius:12px;
      overflow:hidden;border:1px solid #1a1a1a;">
      <div style="background:#E91E8C;padding:24px 32px;">
        <h1 style="margin:0;font-size:20px;font-weight:700;color:#fff;
          letter-spacing:-0.5px;">
          Design & Animation Club, IIT Kanpur
        </h1>
      </div>
      <div style="padding:32px;">
        ${content}
        <a href="https://www.dnaiitk.site"
          style="display:inline-block;margin-top:24px;padding:12px 24px;
            background:#E91E8C;color:#fff;text-decoration:none;
            border-radius:100px;font-weight:600;font-size:14px;">
          Visit Website
        </a>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #1a1a1a;
        color:#555;font-size:12px;">
        Design & Animation Club, IIT Kanpur ·
        <a href="https://www.dnaiitk.site"
          style="color:#E91E8C;text-decoration:none;">
          www.dnaiitk.site
        </a>
      </div>
    </div>
  `;
}

// ── Single source of truth for the shell decision ────────────────────────────
// Which template ids ship as a standalone HTML document (NO getBaseTemplate
// shell). Both the send path and the admin preview consult this, so they can't
// drift. To make a future template standalone, add its id here — nothing else.
export const STANDALONE_TEMPLATE_IDS = new Set<string>(['welcome', 'new_artwork', 'new_event']);

export function renderTemplateHtml(templateId: string, resolvedBody: string): string {
  return STANDALONE_TEMPLATE_IDS.has(templateId) ? resolvedBody : getBaseTemplate(resolvedBody);
}

// Sample values for the accurate admin preview — the real placeholders each
// template substitutes. The keys also define each template's variable list.
export const TEMPLATE_SAMPLE_VARS: Record<string, Record<string, string>> = {
  welcome:     { '{{name}}': 'Aarav Sharma' },
  new_artwork: { '{{title}}': 'Ethereal Solitude', '{{artist}}': 'Vikram Aditya', '{{domain}}': '3D Animation' },
  new_event:   { '{{title}}': 'Figma UI Sprint', '{{date}}': '12 Jun 2026', '{{venue}}': 'LHC-3', '{{description}}': 'A hands-on masterclass on structural glassmorphism and adaptive layouts.' },
  event_reminder: { '{{name}}': 'Aarav Sharma', '{{title}}': 'Figma UI Sprint', '{{date}}': '12 Jun 2026', '{{time}}': '6:00 PM – 8:30 PM', '{{venue}}': 'LHC-3' },
};

export function templateVariables(templateId: string): string[] {
  return Object.keys(TEMPLATE_SAMPLE_VARS[templateId] ?? {});
}

// Produce the EXACT html that would be sent for a template + draft body (same
// resolve() + wrap/bypass as the real send path), for an accurate admin preview.
export function renderTemplatePreview(templateId: string, subject: string, body: string): { subject: string; html: string } {
  const vars = TEMPLATE_SAMPLE_VARS[templateId] ?? {};
  return {
    subject: resolve(subject, vars),
    html: renderTemplateHtml(templateId, resolve(body, vars, true)),
  };
}

// Sends the rendered template to a SINGLE admin-supplied address for testing.
// Deliberately does NOT call getAllStudentEmails / the broadcast list — it emails
// exactly `toEmail`, using the same render as the preview. Subject is prefixed
// [TEST] so it's obvious in the inbox.
export async function sendTemplateTest(templateId: string, toEmail: string, subject: string, body: string): Promise<void> {
  const rendered = renderTemplatePreview(templateId, subject, body);
  await resendClient().emails.send({
    from: MAIL_FROM,
    replyTo: 'designandanimationclub.iitk@gmail.com',
    to: toEmail,
    subject: `[TEST] ${rendered.subject}`,
    html: rendered.html,
  });
  await recordSent(1);
}

// Sends pre-rendered html as-is (the caller decides shell vs. standalone via
// renderTemplateHtml), so batch notifications share the same shell logic.
// Chunks into groups of 50 BCC recipients per Resend API call (delivery-side
// limit). Each call also carries a fixed `to:` address that Resend counts as
// its own recipient — so each chunk costs (chunk.length + 1) against the
// quota, not chunk.length. Callers pass how many recipients they're willing
// to spend budget on; sendInBatches only sends as many emails as fit within
// that after accounting for the +1-per-chunk overhead, and returns the count
// actually sent so callers know how many to treat as "done" vs. still queued.
async function sendInBatches(
  emails: string[], subject: string, html: string, maxBudget: number
): Promise<{ sent: number; budgetUsed: number }> {
  let sent = 0;
  let budgetUsed = 0;
  let budget = maxBudget;
  for (let i = 0; i < emails.length; i += 50) {
    if (budget <= 1) break; // need room for the chunk's +1 `to:` overhead too
    const chunk = emails.slice(i, i + Math.min(50, budget - 1));
    if (chunk.length === 0) break;
    await resendClient().emails.send({
      from: MAIL_FROM,
      replyTo: 'designandanimationclub.iitk@gmail.com',
      bcc: chunk,
      to: 'designandanimationclub.iitk@gmail.com',
      subject,
      html,
    });
    const cost = chunk.length + 1;
    await recordSent(cost);
    budget -= cost;
    budgetUsed += cost;
    sent += chunk.length;
  }
  return { sent, budgetUsed };
}

// Broadcast entry point: sends up to `broadcastBudgetRemaining()` recipients
// now and queues the rest in mail_queue for later ticks to drain. Returns how
// many were sent immediately and how many were queued, so callers (routes)
// can tell the admin the real outcome instead of implying an instant full send.
async function sendBroadcast(
  kind: string, emails: string[], subject: string, html: string
): Promise<{ sentNow: number; queued: number }> {
  if (emails.length === 0) return { sentNow: 0, queued: 0 };

  const budget = await broadcastBudgetRemaining();
  // sendInBatches decides how many of `emails` actually fit once the +1-per-
  // chunk `to:` overhead is accounted for — don't pre-slice by raw budget,
  // that undercounts real Resend usage by one recipient per 50-chunk.
  const { sent: sentNow } = budget > 0
    ? await sendInBatches(emails, subject, html, budget)
    : { sent: 0 };
  const toQueue = emails.slice(sentNow);

  if (toQueue.length > 0) {
    await pool.query(`
      INSERT INTO mail_queue (id, kind, subject, html, remaining, total_count)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [`mq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind, subject, html, toQueue, toQueue.length]);
  }
  return { sentNow, queued: toQueue.length };
}

// Drains queued broadcast mail, respecting today's remaining budget. Called
// from the scheduler tick. Processes oldest-first so nothing starves; a
// partially-drained row keeps its remaining recipients for the next call.
export async function drainMailQueue(): Promise<void> {
  let budget = await broadcastBudgetRemaining();
  if (budget <= 0) return;

  const rows = await pool.query<{ id: string; subject: string; html: string; remaining: string[] }>(
    'SELECT id, subject, html, remaining FROM mail_queue WHERE completed_at IS NULL ORDER BY created_at ASC'
  );

  for (const row of rows.rows) {
    if (budget <= 0) break;

    const { sent: sentCount, budgetUsed } = await sendInBatches(row.remaining, row.subject, row.html, budget);
    budget -= budgetUsed;

    const stillRemaining = row.remaining.slice(sentCount);
    if (stillRemaining.length === 0) {
      await pool.query('UPDATE mail_queue SET remaining = $1, completed_at = NOW() WHERE id = $2', [stillRemaining, row.id]);
    } else {
      await pool.query('UPDATE mail_queue SET remaining = $1 WHERE id = $2', [stillRemaining, row.id]);
    }
  }
}

const OTP_WEBSITE_URL = 'https://www.dnaiitk.site';

// Standalone OTP email (bypasses getBaseTemplate — CSS inlined for email
// clients). Hardcoded rather than an editable template because it's
// login-critical; the code is injected directly (digits only) and the link
// points at the site. Exported so the preview harness renders the exact output.
export function renderOtpHtml(code: string): string {
  const safeCode = code.replace(/[^0-9]/g, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your verification code — DnA Club</title>
</head>
<body style="margin:0; padding:0; background-color:#222; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#222; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:40px 20px;">

      <div style="background-color:#dced3e; padding:20px 20px 40px 20px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.6); max-width:450px; width:100%; margin:0 auto; text-align:left;">
        <div style="background-color:#f4f4f0; padding:45px 35px; box-shadow:2px 2px 10px rgba(0,0,0,0.1); position:relative; background-image:radial-gradient(#aaa 1px, transparent 1px); background-size:20px 20px; background-position:0 0;">
          <div style="font-family:monospace; font-size:16px; border-bottom:1.5px solid #222; display:inline-block; margin-bottom:35px; color:#222; text-transform:lowercase;">auth_request</div>

          <h1 style="font-size:45px; font-weight:800; color:#111; line-height:1.05; margin:0 0 25px 0; letter-spacing:-1.5px;">Your verification code</h1>

          <p style="font-size:16px; line-height:1.6; color:#333; margin:0; font-weight:500;">
            Use this code to sign in to DnA Club. It expires in 10 minutes.
          </p>

          <div style="background-color:#e5e5e5; padding:20px; text-align:center; border-radius:6px; margin:25px 0; font-size:35px; font-weight:800; letter-spacing:4px; color:#333;">
            ${safeCode}
          </div>

          <p style="font-size:13px; color:#888; margin-top:20px;">
            If you did not request this, you can ignore this email.
          </p>

          <a href="${OTP_WEBSITE_URL}" style="display:inline-block; background-color:#e64298; color:#ffffff; padding:12px 24px; text-decoration:none; font-weight:bold; border-radius:25px; margin-top:15px;">Visit Website</a>
        </div>

        <div style="margin-top:25px; font-size:35px; font-weight:800; color:#111; text-align:center; letter-spacing:-1px;">Get creative.</div>
        <div style="text-align:center; color:#555; font-size:14px; margin-top:15px; font-weight:500; letter-spacing:0.5px;">designed by venugopal</div>
      </div>

    </td>
  </tr>
</table>

</body>
</html>`;
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    // In dev without email configured, surface the code in logs so the flow is testable.
    console.log(`[DEV] OTP for ${email}: ${code}`);
    return;
  }

  try {
    await resendClient().emails.send({
      from: MAIL_FROM,
      replyTo: 'designandanimationclub.iitk@gmail.com',
      to: email,
      subject: 'Your DnA Club verification code',
      html: renderOtpHtml(code),
    });
    await recordSent(1);
    console.log(`OTP email sent to ${email}`);
  } catch (err) {
    console.error('Failed to send OTP email:', err);
    throw err;
  }
}

// Returns true only if the email was actually sent, so callers can record that
// it happened (e.g. set welcome_email_sent_at) exactly once.
export async function sendWelcomeEmail(name: string, email: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;

  const tpl = await getTemplate('welcome');
  const subject = tpl?.subject ?? 'Welcome to Design and Animation Club, IIT Kanpur';
  const body = tpl?.body ?? '<p>Welcome to DnA Club, {{name}}</p>';

  const vars = { '{{name}}': name };

  try {
    await resendClient().emails.send({
      from: MAIL_FROM,
      replyTo: 'designandanimationclub.iitk@gmail.com',
      to: email,
      subject: resolve(subject, vars),
      // renderTemplateHtml bypasses the shell for standalone templates (welcome).
      html: renderTemplateHtml('welcome', resolve(body, vars, true)),
    });
    await recordSent(1);
    console.log(`Welcome email sent to ${email}`);
    return true;
  } catch (err) {
    console.error('Failed to send welcome email:', err);
    return false;
  }
}

// Number of students who would receive a broadcast — surfaced to the admin
// confirm dialog so "Notify Students" states the real recipient count up front.
export async function getAudienceEmailCount(): Promise<number> {
  return (await getAllStudentEmails()).length;
}

export type EventNotifyAudience = 'all' | 'registered';

// Same as getAudienceEmailCount, but for an event's "Registered only" choice
// — counts just the RSVP'd students rather than every student on file.
export async function getEventAudienceEmailCount(eventId: string, audience: EventNotifyAudience): Promise<number> {
  const emails = audience === 'registered' ? await getRegisteredStudentEmails(eventId) : await getAllStudentEmails();
  return emails.length;
}

// Build the EXACT subject + html a student would receive for an event, using the
// live template (with hardcoded fallbacks). Shared by the send path and the admin
// preview so the confirm-dialog preview can't drift from what actually goes out.
export async function buildEventEmail(event: {
  title: string;
  date?: string;
  venue?: string;
  description?: string;
}): Promise<{ subject: string; html: string }> {
  const tpl = await getTemplate('new_event');
  const subject = tpl?.subject ?? 'New Event: {{title}} — DnA Club IITK';
  const body = tpl?.body ?? '<h2>{{title}}</h2><p>{{date}}</p><p>{{description}}</p>';

  const vars: Record<string, string> = {
    '{{title}}':       event.title ?? '',
    '{{date}}':        event.date ?? '',
    '{{venue}}':       event.venue ?? '',
    '{{description}}': event.description ?? '',
  };

  return {
    subject: resolve(subject, vars),
    html: renderTemplateHtml('new_event', resolve(body, vars, true)),
  };
}

export async function buildArtworkEmail(artwork: {
  title: string;
  artist: string;
  domain?: string;
}): Promise<{ subject: string; html: string }> {
  const tpl = await getTemplate('new_artwork');
  const subject = tpl?.subject ?? 'New Artwork: {{title}} — DnA Club IITK';
  const body = tpl?.body ?? '<h2>{{title}}</h2><p>by {{artist}}</p>';

  const vars: Record<string, string> = {
    '{{title}}':  artwork.title ?? '',
    '{{artist}}': artwork.artist ?? '',
    '{{domain}}': artwork.domain ?? '',
  };

  return {
    subject: resolve(subject, vars),
    html: renderTemplateHtml('new_artwork', resolve(body, vars, true)),
  };
}

// Result of a broadcast attempt: how many recipients got mail immediately vs.
// were queued for later ticks because today's quota-gated budget ran out.
export type BroadcastResult = { sentNow: number; queued: number };

export async function sendEventNotification(
  event: { id: string; title: string; date?: string; venue?: string; description?: string },
  audience: EventNotifyAudience = 'all'
): Promise<BroadcastResult> {
  if (!process.env.RESEND_API_KEY) return { sentNow: 0, queued: 0 };
  const emails = audience === 'registered'
    ? await getRegisteredStudentEmails(event.id)
    : await getAllStudentEmails();
  if (emails.length === 0) return { sentNow: 0, queued: 0 };

  const { subject, html } = await buildEventEmail(event);

  try {
    const result = await sendBroadcast('event', emails, subject, html);
    console.log(`Event notification (${audience}): ${result.sentNow} sent now, ${result.queued} queued`);
    return result;
  } catch (err) {
    console.error('Failed to send event notification:', err);
    return { sentNow: 0, queued: 0 };
  }
}

export async function sendArtworkNotification(artwork: {
  title: string;
  artist: string;
  domain?: string;
}): Promise<BroadcastResult> {
  if (!process.env.RESEND_API_KEY) return { sentNow: 0, queued: 0 };
  const emails = await getAllStudentEmails();
  if (emails.length === 0) return { sentNow: 0, queued: 0 };

  const { subject, html } = await buildArtworkEmail(artwork);

  try {
    const result = await sendBroadcast('artwork', emails, subject, html);
    console.log(`Artwork notification: ${result.sentNow} sent now, ${result.queued} queued`);
    return result;
  } catch (err) {
    console.error('Failed to send artwork notification:', err);
    return { sentNow: 0, queued: 0 };
  }
}

export async function sendCustomAnnouncement(
  subject: string,
  html: string,
  emails: string[]
): Promise<BroadcastResult> {
  if (!process.env.RESEND_API_KEY) return { sentNow: 0, queued: 0 };
  if (emails.length === 0) return { sentNow: 0, queued: 0 };

  try {
    // Custom announcements are not a stored template; they always use the shell.
    const result = await sendBroadcast('announcement', emails, subject, renderTemplateHtml('custom', html));
    console.log(`Announcement: ${result.sentNow} sent now, ${result.queued} queued`);
    return result;
  } catch (err) {
    console.error('Failed to send custom announcement:', err);
    throw err;
  }
}

// A single RSVP due for its ~1-hour-before reminder (see routes/internal.ts,
// which queries event_rsvps JOIN events/student_sessions for the due window).
export interface DueReminder {
  eventId: string;
  rollNumber: string;
  email: string;
  name: string | null;
  title: string;
  date: string;
  time: string;
  venue: string;
}

// Sends one personalized reminder per RSVP (not a BCC broadcast — each email
// has a different {{name}}), respecting the same quota gate as broadcasts.
// Recipients beyond today's remaining budget are simply skipped and left with
// reminder_sent_at still NULL, so the next tick retries them automatically —
// no separate queue table needed here since the due-window query IS the queue.
// Returns how many were actually sent so the caller knows which to stamp.
export async function sendEventReminders(due: DueReminder[]): Promise<{ sent: DueReminder[] }> {
  if (!process.env.RESEND_API_KEY || due.length === 0) return { sent: [] };

  const tpl = await getTemplate('event_reminder');
  const subjectTpl = tpl?.subject ?? 'Reminder: {{title}} starts soon — DnA Club IITK';
  const bodyTpl = tpl?.body ?? '<p>Hi {{name}}, {{title}} starts soon.</p>';

  let budget = await broadcastBudgetRemaining();
  const sent: DueReminder[] = [];

  for (const r of due) {
    if (budget <= 0) break;
    const vars: Record<string, string> = {
      '{{name}}': r.name ?? 'there',
      '{{title}}': r.title,
      '{{date}}': r.date,
      '{{time}}': r.time,
      '{{venue}}': r.venue,
    };
    try {
      await resendClient().emails.send({
        from: MAIL_FROM,
        replyTo: 'designandanimationclub.iitk@gmail.com',
        to: r.email,
        subject: resolve(subjectTpl, vars),
        html: renderTemplateHtml('event_reminder', resolve(bodyTpl, vars, true)),
      });
      await recordSent(1);
      budget -= 1;
      sent.push(r);
    } catch (err) {
      console.error(`Failed to send event reminder for event ${r.eventId} to roll ${r.rollNumber}:`, err);
      // Don't decrement budget or mark sent — leaves reminder_sent_at NULL so
      // this recipient is retried on the next tick rather than silently lost.
    }
  }

  console.log(`Event reminders: ${sent.length} sent, ${due.length - sent.length} deferred to next tick`);
  return { sent };
}

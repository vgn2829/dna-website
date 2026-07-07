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
        <a href="https://dna-website-two.vercel.app"
          style="display:inline-block;margin-top:24px;padding:12px 24px;
            background:#E91E8C;color:#fff;text-decoration:none;
            border-radius:100px;font-weight:600;font-size:14px;">
          Visit Website
        </a>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #1a1a1a;
        color:#555;font-size:12px;">
        Design & Animation Club, IIT Kanpur ·
        <a href="https://dna-website-two.vercel.app"
          style="color:#E91E8C;text-decoration:none;">
          dna-website-two.vercel.app
        </a>
      </div>
    </div>
  `;
}

async function sendInBatches(emails: string[], subject: string, html: string): Promise<void> {
  const chunks: string[][] = [];
  for (let i = 0; i < emails.length; i += 50) {
    chunks.push(emails.slice(i, i + 50));
  }
  for (const chunk of chunks) {
    await resendClient().emails.send({
      from: MAIL_FROM,
      replyTo: 'designandanimationclub.iitk@gmail.com',
      bcc: chunk,
      to: 'designandanimationclub.iitk@gmail.com',
      subject,
      html: getBaseTemplate(html),
    });
  }
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    // In dev without email configured, surface the code in logs so the flow is testable.
    console.log(`[DEV] OTP for ${email}: ${code}`);
    return;
  }

  const content = `
    <h2 style="margin:0 0 12px;font-size:22px;color:#ffffff;">Your verification code</h2>
    <p style="margin:0 0 16px;color:#cccccc;font-size:15px;line-height:1.7;">
      Use this code to sign in to DnA Club. It expires in 10 minutes.
    </p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#ffffff;
      background:#1a1a1a;border-radius:8px;padding:16px 24px;text-align:center;">
      ${code.replace(/[^0-9]/g, '')}
    </div>
    <p style="margin:16px 0 0;color:#777;font-size:13px;line-height:1.6;">
      If you did not request this, you can ignore this email.
    </p>`;

  try {
    await resendClient().emails.send({
      from: MAIL_FROM,
      replyTo: 'designandanimationclub.iitk@gmail.com',
      to: email,
      subject: 'Your DnA Club verification code',
      html: getBaseTemplate(content),
    });
    console.log(`OTP email sent to ${email}`);
  } catch (err) {
    console.error('Failed to send OTP email:', err);
    throw err;
  }
}

export async function sendWelcomeEmail(name: string, email: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

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
      html: getBaseTemplate(resolve(body, vars, true)),
    });
    console.log(`Welcome email sent to ${email}`);
  } catch (err) {
    console.error('Failed to send welcome email:', err);
  }
}

export async function sendEventNotification(event: {
  title: string;
  date?: string;
  venue?: string;
  description?: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const emails = await getAllStudentEmails();
  if (emails.length === 0) return;

  const tpl = await getTemplate('new_event');
  const subject = tpl?.subject ?? 'New Event: {{title}} — DnA Club IITK';
  const body = tpl?.body ?? '<h2>{{title}}</h2><p>{{date}}</p><p>{{description}}</p>';

  const vars: Record<string, string> = {
    '{{title}}':       event.title ?? '',
    '{{date}}':        event.date ?? '',
    '{{venue}}':       event.venue ?? '',
    '{{description}}': event.description ?? '',
  };

  try {
    await sendInBatches(emails, resolve(subject, vars), resolve(body, vars, true));
    console.log(`Event notification sent to ${emails.length} students`);
  } catch (err) {
    console.error('Failed to send event notification:', err);
  }
}

export async function sendArtworkNotification(artwork: {
  title: string;
  artist: string;
  domain?: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const emails = await getAllStudentEmails();
  if (emails.length === 0) return;

  const tpl = await getTemplate('new_artwork');
  const subject = tpl?.subject ?? 'New Artwork: {{title}} — DnA Club IITK';
  const body = tpl?.body ?? '<h2>{{title}}</h2><p>by {{artist}}</p>';

  const vars: Record<string, string> = {
    '{{title}}':  artwork.title ?? '',
    '{{artist}}': artwork.artist ?? '',
    '{{domain}}': artwork.domain ?? '',
  };

  try {
    await sendInBatches(emails, resolve(subject, vars), resolve(body, vars, true));
    console.log(`Artwork notification sent to ${emails.length} students`);
  } catch (err) {
    console.error('Failed to send artwork notification:', err);
  }
}

export async function sendCustomAnnouncement(
  subject: string,
  html: string,
  emails: string[]
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  if (emails.length === 0) return;

  try {
    await sendInBatches(emails, subject, html);
    console.log(`Custom announcement sent to ${emails.length} students`);
  } catch (err) {
    console.error('Failed to send custom announcement:', err);
    throw err;
  }
}

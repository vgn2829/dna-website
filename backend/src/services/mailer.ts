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
}

// Sends pre-rendered html as-is (the caller decides shell vs. standalone via
// renderTemplateHtml), so batch notifications share the same shell logic.
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
      html,
    });
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

export async function sendEventNotification(event: {
  title: string;
  date?: string;
  venue?: string;
  description?: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const emails = await getAllStudentEmails();
  if (emails.length === 0) return;

  const { subject, html } = await buildEventEmail(event);

  try {
    await sendInBatches(emails, subject, html);
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

  const { subject, html } = await buildArtworkEmail(artwork);

  try {
    await sendInBatches(emails, subject, html);
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
    // Custom announcements are not a stored template; they always use the shell.
    await sendInBatches(emails, subject, renderTemplateHtml('custom', html));
    console.log(`Custom announcement sent to ${emails.length} students`);
  } catch (err) {
    console.error('Failed to send custom announcement:', err);
    throw err;
  }
}

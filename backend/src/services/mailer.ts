import { Resend } from 'resend';
import { pool } from '../db/client';

const resend = new Resend(process.env.RESEND_API_KEY);

if (process.env.RESEND_API_KEY) {
  console.log('Email service ready (Resend)');
} else {
  console.warn('RESEND_API_KEY not set — emails will not be sent');
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

function resolve(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(k, v), template);
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
    await resend.emails.send({
      from: 'DnA Club IITK <onboarding@resend.dev>',
      bcc: chunk,
      to: 'designandanimationclub.iitk@gmail.com',
      subject,
      html: getBaseTemplate(html),
    });
  }
}

export async function sendWelcomeEmail(name: string, email: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const tpl = await getTemplate('welcome');
  const subject = tpl?.subject ?? 'Welcome to Design and Animation Club, IIT Kanpur';
  const body = tpl?.body ?? '<p>Welcome to DnA Club, {{name}}</p>';

  const vars = { '{{name}}': name };

  try {
    await resend.emails.send({
      from: 'DnA Club IITK <onboarding@resend.dev>',
      to: email,
      subject: resolve(subject, vars),
      html: getBaseTemplate(resolve(body, vars)),
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
    await sendInBatches(emails, resolve(subject, vars), resolve(body, vars));
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
    await sendInBatches(emails, resolve(subject, vars), resolve(body, vars));
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

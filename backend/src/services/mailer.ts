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

export async function sendWelcomeEmail(
  name: string,
  email: string
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const content = `
    <h2 style="margin:0 0 12px;font-size:22px;color:#ffffff;">
      Welcome to DnA Club, ${name}
    </h2>
    <p style="margin:0 0 12px;color:#cccccc;font-size:15px;line-height:1.7;">
      You are now part of the Design and Animation Club family at IIT Kanpur.
    </p>
    <p style="margin:0 0 12px;color:#cccccc;font-size:15px;line-height:1.7;">
      We are a community of designers, animators, and creative thinkers.
      Explore our gallery, attend our events, and be part of the creative
      journey at IITK.
    </p>
    <p style="margin:0;color:#cccccc;font-size:15px;line-height:1.7;">
      Stay tuned for updates on workshops, exhibitions, and events.
      We are glad to have you with us.
    </p>
  `;

  try {
    await resend.emails.send({
      from: 'DnA Club IITK <onboarding@resend.dev>',
      to: email,
      subject: 'Welcome to Design and Animation Club, IIT Kanpur',
      html: getBaseTemplate(content),
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

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#ffffff;">
      New Event: ${event.title}
    </h2>
    ${event.date ? `<p style="margin:0 0 4px;color:#999;font-size:14px;">
      Date: ${event.date}</p>` : ''}
    ${event.venue ? `<p style="margin:0 0 16px;color:#999;font-size:14px;">
      Venue: ${event.venue}</p>` : ''}
    ${event.description ? `<p style="margin:16px 0;color:#cccccc;
      font-size:15px;line-height:1.7;">${event.description}</p>` : ''}
  `;

  try {
    const chunks: string[][] = [];
    for (let i = 0; i < emails.length; i += 50) {
      chunks.push(emails.slice(i, i + 50));
    }
    for (const chunk of chunks) {
      await resend.emails.send({
        from: 'DnA Club IITK <onboarding@resend.dev>',
        bcc: chunk,
        to: 'designandanimationclub.iitk@gmail.com',
        subject: `New Event: ${event.title} — DnA Club IITK`,
        html: getBaseTemplate(content),
      });
    }
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

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#ffffff;">
      New Artwork: ${artwork.title}
    </h2>
    <p style="margin:0 0 4px;color:#999;font-size:14px;">
      by ${artwork.artist}
    </p>
    ${artwork.domain ? `<p style="margin:0;color:#999;font-size:14px;">
      ${artwork.domain}</p>` : ''}
  `;

  try {
    const chunks: string[][] = [];
    for (let i = 0; i < emails.length; i += 50) {
      chunks.push(emails.slice(i, i + 50));
    }
    for (const chunk of chunks) {
      await resend.emails.send({
        from: 'DnA Club IITK <onboarding@resend.dev>',
        bcc: chunk,
        to: 'designandanimationclub.iitk@gmail.com',
        subject: `New Artwork: ${artwork.title} by ${artwork.artist} — DnA Club`,
        html: getBaseTemplate(content),
      });
    }
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
    console.log(`Custom announcement sent to ${emails.length} students`);
  } catch (err) {
    console.error('Failed to send custom announcement:', err);
    throw err;
  }
}

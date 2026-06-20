import nodemailer from 'nodemailer';
import { pool } from '../db/client';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

transporter.verify((error) => {
  if (error) {
    console.error('Email service error:', error);
  } else {
    console.log('Email service ready');
  }
});

async function getAllStudentEmails(): Promise<string[]> {
  try {
    const result = await pool.query(
      'SELECT email FROM student_sessions WHERE email IS NOT NULL'
    );
    return (result.rows as { email: string }[])
      .map(r => r.email)
      .filter(Boolean);
  } catch (err) {
    console.error('Failed to fetch student emails:', err);
    return [];
  }
}

export async function sendEventNotification(event: {
  title: string;
  date: string;
  venue?: string;
  description?: string;
}): Promise<void> {
  const emails = await getAllStudentEmails();
  if (emails.length === 0) return;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;
      background:#0a0a0a;color:#ffffff;border-radius:12px;overflow:hidden;">
      <div style="background:#E91E8C;padding:24px 32px;">
        <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">
          🎨 DnA Club — New Event
        </h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 8px;font-size:24px;color:#ffffff;">
          ${event.title}
        </h2>
        ${event.date ? `
          <p style="margin:0 0 4px;color:#999;font-size:14px;">
            📅 ${event.date}
          </p>` : ''}
        ${event.venue ? `
          <p style="margin:0 0 16px;color:#999;font-size:14px;">
            📍 ${event.venue}
          </p>` : ''}
        ${event.description ? `
          <p style="margin:16px 0;color:#cccccc;font-size:15px;
            line-height:1.6;">
            ${event.description}
          </p>` : ''}
        <a href="https://dna-website-two.vercel.app/events"
          style="display:inline-block;margin-top:16px;padding:12px 24px;
            background:#E91E8C;color:#fff;text-decoration:none;
            border-radius:100px;font-weight:600;font-size:14px;">
          View Event →
        </a>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #222;
        color:#666;font-size:12px;">
        Design & Animation Club, IIT Kanpur ·
        <a href="https://dna-website-two.vercel.app"
          style="color:#E91E8C;text-decoration:none;">
          dna-website-two.vercel.app
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"DnA Club IITK" <${process.env.GMAIL_USER}>`,
      bcc: emails,
      subject: `🎨 New Event: ${event.title} — DnA Club IITK`,
      html,
    });
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
  const emails = await getAllStudentEmails();
  if (emails.length === 0) return;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;
      background:#0a0a0a;color:#ffffff;border-radius:12px;overflow:hidden;">
      <div style="background:#E91E8C;padding:24px 32px;">
        <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">
          🖼 DnA Club — New Artwork
        </h1>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 8px;font-size:24px;color:#ffffff;">
          ${artwork.title}
        </h2>
        <p style="margin:0 0 4px;color:#999;font-size:14px;">
          by ${artwork.artist}
        </p>
        ${artwork.domain ? `
          <p style="margin:0 0 16px;color:#999;font-size:14px;">
            ${artwork.domain}
          </p>` : ''}
        <a href="https://dna-website-two.vercel.app/gallery"
          style="display:inline-block;margin-top:16px;padding:12px 24px;
            background:#E91E8C;color:#fff;text-decoration:none;
            border-radius:100px;font-weight:600;font-size:14px;">
          View Gallery →
        </a>
      </div>
      <div style="padding:16px 32px;border-top:1px solid #222;
        color:#666;font-size:12px;">
        Design & Animation Club, IIT Kanpur ·
        <a href="https://dna-website-two.vercel.app"
          style="color:#E91E8C;text-decoration:none;">
          dna-website-two.vercel.app
        </a>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"DnA Club IITK" <${process.env.GMAIL_USER}>`,
      bcc: emails,
      subject: `🖼 New Artwork: ${artwork.title} by ${artwork.artist} — DnA Club`,
      html,
    });
    console.log(`Artwork notification sent to ${emails.length} students`);
  } catch (err) {
    console.error('Failed to send artwork notification:', err);
  }
}

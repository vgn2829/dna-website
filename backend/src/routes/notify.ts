import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth';
import { sendEventNotification, sendArtworkNotification, sendCustomAnnouncement, MAIL_FROM, renderTemplatePreview, templateVariables, sendTemplateTest, buildEventEmail, buildArtworkEmail, getAudienceEmailCount } from '../services/mailer';
import { pool } from '../db/client';

const router = Router();

const MAX_SUBJECT = 300;
const MAX_HTML = 100_000; // ~100 KB of email markup is plenty

const templateSchema = z.object({
  subject: z.string().min(1).max(MAX_SUBJECT),
  body: z.string().min(1).max(MAX_HTML),
});

const announceSchema = z.object({
  subject: z.string().min(1).max(MAX_SUBJECT),
  html: z.string().min(1).max(MAX_HTML),
});

router.get('/test-email', requireAdmin, async (req, res) => {
  try {
    console.log('=== EMAIL TEST ===');
    console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'SET' : 'NOT SET');

    if (!process.env.RESEND_API_KEY) {
      res.status(500).json({ error: 'RESEND_API_KEY not set in environment variables' });
      return;
    }

    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: MAIL_FROM,
      to: 'designandanimationclub.iitk@gmail.com',
      subject: 'DnA Club — Email Test',
      html: '<p>Email is working correctly via Resend.</p>',
    });

    console.log('Test email sent:', result);
    res.json({ success: true, message: 'Test email sent', result });
  } catch (err) {
    console.error('Email test failed:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

type EventRow = { id: string; title: string; date: string; location: string; content: string; notified_at: string | null };
type ArtworkRow = { id: string; title: string; artist: string; domain: string; notified_at: string | null };

// Preview the actual email a given event would send, plus the recipient count,
// so the admin confirm dialog shows exactly what goes out and to how many.
router.get('/event/:id/preview', requireAdmin, async (req, res) => {
  try {
    const rows = await pool.query<EventRow>('SELECT * FROM events WHERE id=$1', [req.params.id]);
    if (rows.rows.length === 0) { res.status(404).json({ error: 'Event not found' }); return; }
    const e = rows.rows[0];
    const { subject, html } = await buildEventEmail({ title: e.title, date: e.date, venue: e.location, description: e.content });
    res.json({ subject, html, recipientCount: await getAudienceEmailCount() });
  } catch (err) {
    console.error('Notify event preview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send the event notification to all registered students and stamp notified_at,
// which drives the Sent/Not-Sent badge. Re-sending is allowed (admin-confirmed);
// notified_at is refreshed to the latest send.
router.post('/event/:id', requireAdmin, async (req, res) => {
  try {
    const rows = await pool.query<EventRow>('SELECT * FROM events WHERE id=$1', [req.params.id]);
    if (rows.rows.length === 0) { res.status(404).json({ error: 'Event not found' }); return; }
    const e = rows.rows[0];
    await sendEventNotification({ title: e.title, date: e.date, venue: e.location, description: e.content });
    const upd = await pool.query<{ notified_at: string }>(
      'UPDATE events SET notified_at=NOW() WHERE id=$1 RETURNING notified_at', [req.params.id]
    );
    res.json({ success: true, notifiedAt: upd.rows[0].notified_at });
  } catch (err) {
    console.error('Notify event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/artwork/:id/preview', requireAdmin, async (req, res) => {
  try {
    const rows = await pool.query<ArtworkRow>('SELECT * FROM artworks WHERE id=$1', [req.params.id]);
    if (rows.rows.length === 0) { res.status(404).json({ error: 'Artwork not found' }); return; }
    const a = rows.rows[0];
    const { subject, html } = await buildArtworkEmail({ title: a.title, artist: a.artist, domain: a.domain });
    res.json({ subject, html, recipientCount: await getAudienceEmailCount() });
  } catch (err) {
    console.error('Notify artwork preview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/artwork/:id', requireAdmin, async (req, res) => {
  try {
    const rows = await pool.query<ArtworkRow>('SELECT * FROM artworks WHERE id=$1', [req.params.id]);
    if (rows.rows.length === 0) { res.status(404).json({ error: 'Artwork not found' }); return; }
    const a = rows.rows[0];
    await sendArtworkNotification({ title: a.title, artist: a.artist, domain: a.domain });
    const upd = await pool.query<{ notified_at: string }>(
      'UPDATE artworks SET notified_at=NOW() WHERE id=$1 RETURNING notified_at', [req.params.id]
    );
    res.json({ success: true, notifiedAt: upd.rows[0].notified_at });
  } catch (err) {
    console.error('Notify artwork error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/templates', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM email_templates ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Get templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/templates/:id', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM email_templates WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Renders the EXACT html a template would send (shell-wrapped or standalone,
// per the mailer's single source of truth) for the given DRAFT subject/body, so
// the admin preview always matches the real email. Returns the variable list too.
router.post('/templates/:id/preview', requireAdmin, async (req, res) => {
  try {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Subject and body are required (subject ≤ 300, body ≤ 100 KB)' });
      return;
    }
    const rendered = renderTemplatePreview(req.params.id, parsed.data.subject, parsed.data.body);
    res.json({
      subject: rendered.subject,
      html: rendered.html,
      variables: templateVariables(req.params.id),
    });
  } catch (err) {
    console.error('Template preview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sends the rendered draft to a SINGLE admin-supplied address — never the
// broadcast list — so a template can be checked in a real inbox safely.
const testSendSchema = z.object({
  email: z.string().email().max(200),
  subject: z.string().min(1).max(MAX_SUBJECT),
  body: z.string().min(1).max(MAX_HTML),
});

router.post('/templates/:id/test', requireAdmin, async (req, res) => {
  try {
    const parsed = testSendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid email, subject and body are required' });
      return;
    }
    if (!process.env.RESEND_API_KEY) {
      res.status(503).json({ error: 'Email service is not configured (RESEND_API_KEY unset)' });
      return;
    }
    await sendTemplateTest(req.params.id, parsed.data.email, parsed.data.subject, parsed.data.body);
    res.json({ success: true, sentTo: parsed.data.email });
  } catch (err) {
    console.error('Template test send error:', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to send test email' });
  }
});

router.put('/templates/:id', requireAdmin, async (req, res) => {
  try {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Subject and body are required (subject ≤ 300, body ≤ 100 KB)' });
      return;
    }
    const { subject, body } = parsed.data;
    const result = await pool.query(
      `UPDATE email_templates SET subject = $1, body = $2, updated_at = $3 WHERE id = $4 RETURNING *`,
      [subject, body, new Date().toISOString(), req.params.id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/announce', requireAdmin, async (req, res) => {
  try {
    const parsed = announceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Subject and html are required (subject ≤ 300, html ≤ 100 KB)' });
      return;
    }
    const { subject, html } = parsed.data;

    const result = await pool.query(
      'SELECT email FROM student_sessions WHERE email IS NOT NULL'
    );
    const emails = (result.rows as { email: string }[])
      .map(r => r.email)
      .filter(Boolean);

    if (emails.length === 0) {
      res.json({ success: true, message: 'No registered students to notify', sent: 0 });
      return;
    }

    await sendCustomAnnouncement(subject, html, emails);

    res.json({
      success: true,
      message: `Announcement sent to ${emails.length} students`,
      sent: emails.length,
    });
  } catch (err) {
    console.error('Announce error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send' });
  }
});

export default router;

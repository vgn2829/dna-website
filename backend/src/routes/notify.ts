import { Router } from 'express';
import { requireAdmin } from '../middleware/adminAuth';
import { sendEventNotification, sendArtworkNotification, sendCustomAnnouncement } from '../services/mailer';
import { pool } from '../db/client';

const router = Router();

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
      from: 'DnA Club IITK <onboarding@resend.dev>',
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

router.post('/event', requireAdmin, async (req, res) => {
  try {
    const { title, date, venue, description } = req.body as Record<string, string>;
    if (!title) {
      res.status(400).json({ error: 'Event title is required' });
      return;
    }
    sendEventNotification({ title, date, venue, description });
    res.json({ success: true, message: 'Notification queued' });
  } catch (err) {
    console.error('Notify event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/artwork', requireAdmin, async (req, res) => {
  try {
    const { title, artist, domain } = req.body as Record<string, string>;
    if (!title || !artist) {
      res.status(400).json({ error: 'Title and artist are required' });
      return;
    }
    sendArtworkNotification({ title, artist, domain });
    res.json({ success: true, message: 'Notification queued' });
  } catch (err) {
    console.error('Notify artwork error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/announce', requireAdmin, async (req, res) => {
  try {
    const { subject, html } = req.body as Record<string, string>;
    if (!subject || !html) {
      res.status(400).json({ error: 'Subject and html are required' });
      return;
    }

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

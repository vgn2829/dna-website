import { Router } from 'express';
import { requireAdmin } from '../middleware/adminAuth';
import { sendEventNotification, sendArtworkNotification } from '../services/mailer';

const router = Router();

router.get('/test-email', requireAdmin, async (req, res) => {
  try {
    const nodemailer = await import('nodemailer');

    console.log('=== EMAIL TEST ===');
    console.log('GMAIL_USER:', process.env.GMAIL_USER ? 'SET' : 'NOT SET');
    console.log('GMAIL_APP_PASSWORD:', process.env.GMAIL_APP_PASSWORD ? 'SET' : 'NOT SET');

    const transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    await transporter.verify();
    console.log('Transporter verified OK');

    await transporter.sendMail({
      from: `"DnA Club IITK" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: 'DnA Club — Email Test',
      html: '<p>Email is working correctly.</p>',
    });

    console.log('Test email sent successfully');
    res.json({
      success: true,
      message: 'Test email sent to ' + process.env.GMAIL_USER,
      gmail_user: process.env.GMAIL_USER ? 'configured' : 'MISSING',
      gmail_pass: process.env.GMAIL_APP_PASSWORD ? 'configured' : 'MISSING',
    });
  } catch (err) {
    console.error('Email test failed:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
      gmail_user: process.env.GMAIL_USER ? 'configured' : 'MISSING',
      gmail_pass: process.env.GMAIL_APP_PASSWORD ? 'configured' : 'MISSING',
    });
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

export default router;

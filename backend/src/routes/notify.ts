import { Router } from 'express';
import { requireAdmin } from '../middleware/adminAuth';
import { sendEventNotification, sendArtworkNotification } from '../services/mailer';

const router = Router();

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

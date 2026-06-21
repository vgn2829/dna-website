import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { authRouter }    from './routes/auth';
import { eventsRouter }  from './routes/events';
import { artworksRouter } from './routes/artworks';
import { domainsRouter } from './routes/domains';
import { studentsRouter } from './routes/students';
import { teamRouter }    from './routes/team';
import notifyRouter      from './routes/notify';
import liveSessionsRouter from './routes/liveSessions';
import boardsRouter from './routes/boards';
import settingsRouter from './routes/settings';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map(s => s.trim());

  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) cb(null, true);
      else {
        const err = Object.assign(new Error('Origin not allowed'), { status: 403 });
        cb(err as Error);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Roll-Number'],
  }));

  // Serve uploaded files for local dev storage.
  // Content-Disposition: attachment forces a download so uploaded PDFs / HTML
  // cannot execute script in this origin.
  app.use('/uploads',
    (_req, res, next) => {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    express.static(path.join(__dirname, '../uploads'))
  );

  app.use(express.json({ limit: '256kb' }));

  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please slow down' },
    skip: (req) => req.path === '/api/health',
  });
  app.use(globalLimiter);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth',     authRouter);
  app.use('/api/events',   eventsRouter);
  app.use('/api/artworks', artworksRouter);
  app.use('/api/domains',  domainsRouter);
  app.use('/api/students', studentsRouter);
  app.use('/api/team',     teamRouter);
  app.use('/api/notify',        notifyRouter);
  app.use('/api/live-sessions', liveSessionsRouter);
  app.use('/api/boards',       boardsRouter);
  app.use('/api/settings',     settingsRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err: Error & { status?: number; type?: string; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status ?? 500;
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File exceeds 50 MB limit' });
    } else if (err.code?.startsWith('LIMIT_')) {
      res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON in request body' });
    } else if (status === 403) {
      res.status(403).json({ error: err.message });
    } else if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
}

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
import coordinatorsRouter from './routes/coordinators';
import internalRouter from './routes/internal';
import realtimeStatusRouter from './routes/realtime';
import { createVersionsRouter } from './routes/versions';
import { createCommentsRouter } from './routes/comments';
import type { VersionHistoryService } from './realtime/history/versionHistoryService';
import type { RestoreService } from './realtime/history/restoreService';
import type { CommentBroadcaster } from './realtime/comments/commentBroadcaster';

// Generic over SessionMeta so this accepts whatever concrete
// RoomManager<SessionMeta>-backed services server.ts actually constructed
// (RoomManager<StudentSessionMeta> today) — see versionHistoryService.ts's
// own comment on why VersionHistoryService/RestoreService are generic for
// the same reason. createVersionsRouter itself never reads SessionMeta
// (its handlers only call checkpointExplicit/restore, neither of which
// exposes it), so this generic exists purely to make assignment from
// server.ts's real instances sound, not because routes/versions.ts cares.
//
// commentBroadcaster (Commit 6) is NOT generic over SessionMeta — it has
// no dependency on RoomManager/TLSocketRoom at all (see its own header
// comment), so it's a concrete, non-generic type here.
export interface RealtimeAppServices<SessionMeta = unknown> {
  versionHistoryService: VersionHistoryService<SessionMeta>;
  restoreService: RestoreService<SessionMeta>;
  commentBroadcaster: CommentBroadcaster;
}

// Optional — only server.ts's real boot path constructs and passes this
// (it needs a live RoomManager, which needs a real Postgres connection and
// the WS transport wired up). Every test call site (tests/setup.ts,
// otp-auth.test.ts, rsvp-capacity.test.ts) calls createApp() with no
// arguments and gets an app with no version-history routes mounted at
// all — correct, since there is no RoomManager behind them to test against
// in that context (see routes/versions.ts's own comment on where THAT
// logic's tests live instead).
export function createApp<SessionMeta = unknown>(realtime?: RealtimeAppServices<SessionMeta>) {
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
    allowedHeaders: ['Content-Type', 'Authorization'],
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

  // Small global JSON limit to cap request-body DoS. Routes that legitimately
  // carry large JSON (board canvas state, admin email HTML) get their own
  // larger parser first — express.json() short-circuits once a body has been
  // parsed, so the first matching limit wins.
  //
  // Board canvas_data used to need a much larger allowance (6mb) because
  // Tldraw's default asset store inlines dropped/pasted images as base64
  // data URLs directly in the snapshot. Images now upload to Supabase Storage
  // via canvas-files and only their (short) URLs land in canvas_data, so a
  // clean, URL-only board needs barely more than shape/style metadata.
  //
  // 3mb (not 1mb) is deliberate safety margin, not a leftover: boards created
  // before this fix (or the client-side legacy-asset migration in
  // TldrawCanvas.tsx) can still have base64-embedded images in canvas_data
  // for a window after load, while that migration re-uploads them in the
  // background. Without this margin, a save that lands mid-migration (or
  // from a client that hasn't picked up the migration code yet) would 413
  // and silently drop the whole edit — worse than a slightly larger limit.
  app.use('/api/boards', express.json({ limit: '3mb' }));
  app.use('/api/notify', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({
    extended: true,
    limit: '100kb',
  }));

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
  app.use('/api/boards',        boardsRouter);
  if (realtime) {
    app.use('/api/boards', createVersionsRouter(realtime));
    app.use('/api/boards', createCommentsRouter(realtime.commentBroadcaster));
  }
  app.use('/api/settings',      settingsRouter);
  app.use('/api/coordinators',  coordinatorsRouter);
  app.use('/api/internal',      internalRouter);
  // Shares the /api/realtime prefix with the WS upgrade path
  // (REALTIME_PATH_PREFIX in realtime/server.ts) without colliding: WS
  // upgrades are intercepted via a raw http.Server 'upgrade' listener
  // (see server.ts), which never reaches Express routing at all — only
  // normal GET/POST/etc. requests (like this one) go through here.
  app.use('/api/realtime',      realtimeStatusRouter);

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

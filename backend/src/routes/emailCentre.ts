import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAdmin } from '../middleware/adminAuth';
import { param } from '../routeParams';
import { MAIL_FROM, broadcastBudgetRemaining } from '../services/mailer';
import { handleResendWebhook } from '../services/campaignService';
import { getAvailableBatches } from '../services/activityService';
import { OPERATORS, VARIABLE_CATALOG, type DocNode } from '../services/emailCentre/engine';
import {
  CSV_MAX_BYTES, buildCsvPreview, listGroups, lookupStudentsByEmail, parseEmailList, searchStudents,
} from '../services/emailCentre/recipients';
import { deriveBatch } from '../services/activityService';
import {
  EmailCentreError, LIMITS, cancelMessage, handleProviderEvent, kickQueue, prepareMessage, quotaPreview,
  renderPreview, retryFailed, sendMessage, sendTest, wrapShell, type MessagePayload,
} from '../services/emailCentre/service';
import { providerIsLive, REPLY_TO, verifySvixSignature } from '../services/emailCentre/provider';
import * as store from '../services/emailCentre/store';

const router = Router();

// ── Schemas ────────────────────────────────────────────────────────────────
const docSchema = z.custom<DocNode>(v => typeof v === 'object' && v !== null && (v as DocNode).type === 'doc', 'Invalid email content')
  .refine(v => JSON.stringify(v).length <= LIMITS.maxDocBytes, 'Email content is too large');

const subjectSchema = z.object({
  default: z.string().max(500),
  variants: z.array(z.object({ when: z.unknown(), subject: z.string().max(500) })).max(10).optional(),
});

const recipientSchema = z.object({
  email: z.string().max(320),
  name: z.string().max(200).nullish(),
  source: z.enum(['manual', 'student', 'group', 'csv']),
  data: z.record(z.string(), z.unknown()).optional(),
  excluded: z.boolean().optional(),
  groupRef: z.object({ id: z.string().max(100), name: z.string().max(200) }).nullish(),
});

// Header/footer wording + per-email footer controls (sign-off = `tagline`, design credit = `credit`).
const shellOptionsSchema = z.object({
  labelLeft: z.string().max(40).nullish(), labelRight: z.string().max(40).nullish(), tagline: z.string().max(40).nullish(),
  showSignoff: z.boolean().nullish(), showCredit: z.boolean().nullish(), credit: z.string().max(60).nullish(),
}).nullish();

const shared = {
  mode: z.enum(['normal', 'individual']),
  recipients: z.array(recipientSchema).max(LIMITS.maxRecipients).default([]),
  groups: z.array(z.string().max(120)).max(50).default([]),
  cc: z.array(z.string().max(320)).max(50).default([]),
  bcc: z.array(z.string().max(320)).max(50).default([]),
  sharedData: z.record(z.string(), z.string().max(500)).default({}),
  fallbacks: z.record(z.string(), z.string().max(500)).default({}),
  eventId: z.string().max(100).nullish(),
  shell: z.enum(['dna', 'plain']).default('dna'),
  shellOptions: shellOptionsSchema,
  templateId: z.string().max(100).nullish(),
  templateVersion: z.number().int().nullish(),
};

const payloadSchema = z.object({
  ...shared,
  subject: subjectSchema,
  doc: docSchema,
  attachmentIds: z.array(z.string().max(60)).max(20).default([]),
});

const draftSchema = z.object({
  ...shared,
  title: z.string().max(200).nullish(),
  subject: subjectSchema.optional(),
  doc: docSchema.optional(),
}).partial();

const templateBodySchema = z.object({
  mode: z.enum(['normal', 'individual']).default('individual'),
  subject: subjectSchema,
  doc: docSchema,
  settings: z.object({
    sharedData: z.record(z.string(), z.string().max(500)).optional(),
    fallbacks: z.record(z.string(), z.string().max(500)).optional(),
    shell: z.enum(['dna', 'plain']).optional(),
    shellOptions: shellOptionsSchema,
  }).default({}),
});

const groupFilterSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all_members') }),
  z.object({ type: z.literal('active_members'), days: z.number().int().min(1).max(365).optional() }),
  z.object({ type: z.literal('batch'), batch: z.string().min(1).max(10) }),
  z.object({ type: z.literal('event_registrants'), eventId: z.string().min(1).max(100) }),
]);

const memberSchema = z.object({ email: z.string().max(320), name: z.string().max(200).nullish(), data: z.record(z.string(), z.string().max(500)).optional() });

// ── Helpers ────────────────────────────────────────────────────────────────
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (err) {
      if (err instanceof EmailCentreError) {
        res.status(err.status).json({ error: err.message, ...(err.details && typeof err.details === 'object' ? err.details : {}) });
      } else if (err instanceof z.ZodError) {
        const first = err.issues[0];
        res.status(400).json({ error: `${first?.path.join('.') || 'request'}: ${first?.message ?? 'invalid'}` });
      } else if (err instanceof Error && /^Too many recipients/.test(err.message)) {
        res.status(400).json({ error: err.message });
      } else {
        console.error('Email Centre error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}

const limiterOpts = { standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests — slow down' } };
// Per-minute caps (read per request so tests can lift them via EMAIL_CENTRE_RATE_MULTIPLIER).
const cap = (n: number) => () => n * Math.max(1, Number(process.env.EMAIL_CENTRE_RATE_MULTIPLIER ?? 1));
const sendLimiter = rateLimit({ windowMs: 60_000, max: cap(10), ...limiterOpts });
const heavyLimiter = rateLimit({ windowMs: 60_000, max: cap(60), ...limiterOpts });
const uploadLimiter = rateLimit({ windowMs: 60_000, max: cap(30), ...limiterOpts });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.maxAttachmentBytes, files: 1 } });

// ── Webhook (provider-authenticated, NOT admin-authenticated) ──────────────
// app.ts mounts express.raw() for this path: the signature covers the exact bytes.
router.post('/webhooks/resend', handle(async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) { res.status(503).json({ error: 'RESEND_WEBHOOK_SECRET is not configured' }); return; }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const ok = verifySvixSignature(raw, {
    id: req.header('svix-id') ?? undefined,
    timestamp: req.header('svix-timestamp') ?? undefined,
    signature: req.header('svix-signature') ?? undefined,
  }, secret);
  if (!ok) { res.status(401).json({ error: 'Invalid signature' }); return; }

  let event: { type?: string; data?: Record<string, unknown> };
  try { event = JSON.parse(raw); } catch { res.status(400).json({ error: 'Invalid JSON' }); return; }
  if (!event.type) { res.status(400).json({ error: 'Missing event type' }); return; }

  const result = await handleProviderEvent(req.header('svix-id') ?? null, event as Parameters<typeof handleProviderEvent>[1]);
  // One Resend webhook URL can serve both systems: events for messages this
  // module doesn't own fall through to the legacy campaign tracker.
  let legacy = false;
  if (!result.matched) legacy = await handleResendWebhook(event as Parameters<typeof handleResendWebhook>[0]).catch(() => false);
  res.json({ received: true, handled: result.matched || legacy, duplicate: result.duplicate });
}));

router.use(requireAdmin);

// ── Meta ───────────────────────────────────────────────────────────────────
router.get('/meta', handle(async (_req, res) => {
  const [budget, batches] = await Promise.all([broadcastBudgetRemaining(), getAvailableBatches()]);
  res.json({
    variables: VARIABLE_CATALOG, operators: OPERATORS, limits: LIMITS, attachmentAccept: store.ATTACHMENT_ACCEPT,
    sender: MAIL_FROM, replyTo: REPLY_TO, providerLive: providerIsLive(), broadcastBudget: budget, batches,
  });
}));

// ── Recipients ─────────────────────────────────────────────────────────────
router.get('/recipients/search', heavyLimiter, handle(async (req, res) => {
  const hits = await searchStudents({
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    batch: typeof req.query.batch === 'string' && req.query.batch ? req.query.batch : undefined,
    active: req.query.active === '1' || req.query.active === 'true',
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json({ students: hits });
}));

// Parse pasted text and match each address against the student directory.
router.post('/recipients/parse', heavyLimiter, handle(async (req, res) => {
  const { text } = z.object({ text: z.string().max(200_000) }).parse(req.body);
  const { entries, invalid } = parseEmailList(text);
  const students = await lookupStudentsByEmail(entries.map(e => e.email));
  res.json({
    entries: entries.map(e => {
      const s = students.get(e.email.toLowerCase());
      return {
        email: e.email, name: e.name ?? s?.name ?? null, matchedStudent: Boolean(s),
        student: s ? { rollNumber: s.roll_number, name: s.name, batch: deriveBatch(s.roll_number) } : null,
      };
    }),
    invalid,
  });
}));

// ── Groups ─────────────────────────────────────────────────────────────────
router.get('/groups', handle(async (_req, res) => { res.json({ groups: await listGroups() }); }));

router.get('/groups/:id', handle(async (req, res) => { res.json(await store.getGroupMembers(param(req.params.id))); }));

router.post('/groups', handle(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(1).max(120), description: z.string().max(500).nullish(),
    kind: z.enum(['static', 'dynamic']), filter: groupFilterSchema.nullish(),
    members: z.array(memberSchema).max(LIMITS.maxRecipients).optional(),
  }).parse(req.body);
  const id = await store.createGroup(b);
  res.status(201).json({ id });
}));

router.put('/groups/:id', handle(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).nullish(),
    filter: groupFilterSchema.nullish(), members: z.array(memberSchema).max(LIMITS.maxRecipients).optional(),
  }).parse(req.body);
  await store.updateGroup(param(req.params.id), b);
  res.json({ success: true });
}));

router.delete('/groups/:id', handle(async (req, res) => {
  const ok = await store.deleteGroup(param(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Group not found' }); return; }
  res.json({ success: true });
}));

// ── CSV import ─────────────────────────────────────────────────────────────
router.post('/import/preview', heavyLimiter, handle(async (req, res) => {
  const b = z.object({
    csv: z.string().min(1).max(CSV_MAX_BYTES),
    mapping: z.object({
      email: z.string(), name: z.string().nullish(),
      fields: z.array(z.object({ column: z.string(), key: z.string().max(60) })).max(30).optional(),
    }).optional(),
  }).parse(req.body);
  try { res.json(buildCsvPreview(b.csv, b.mapping ? { ...b.mapping, name: b.mapping.name ?? null } : undefined)); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : 'Could not read the CSV' }); }
}));

// ── Drafts ─────────────────────────────────────────────────────────────────
router.get('/drafts', handle(async (_req, res) => { res.json({ drafts: await store.listDrafts() }); }));

router.post('/drafts', handle(async (req, res) => {
  const p = draftSchema.parse(req.body ?? {});
  res.status(201).json(await store.createDraft(p as store.DraftPayload));
}));

router.get('/drafts/:id', handle(async (req, res) => { res.json(await store.getDraft(param(req.params.id))); }));

router.patch('/drafts/:id', handle(async (req, res) => {
  const b = z.object({ revision: z.number().int().optional(), payload: draftSchema }).parse(req.body);
  res.json(await store.updateDraft(param(req.params.id), b.payload as store.DraftPayload, b.revision));
}));

router.delete('/drafts/:id', handle(async (req, res) => {
  const ok = await store.deleteDraft(param(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ success: true });
}));

// ── Attachments ────────────────────────────────────────────────────────────
router.post('/attachments', uploadLimiter, upload.single('file'), handle(async (req, res) => {
  const messageId = z.string().min(1).max(60).parse(req.body?.messageId);
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  const att = await store.addAttachment(messageId, req.file, req.body?.inline === 'true');
  res.status(201).json(att);
}));

router.delete('/attachments/:id', handle(async (req, res) => {
  const ok = await store.removeAttachment(param(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Attachment not found (or already sent)' }); return; }
  res.json({ success: true });
}));

// ── Preview / validate / send ──────────────────────────────────────────────
router.post('/preview', heavyLimiter, handle(async (req, res) => {
  const b = z.object({ payload: payloadSchema, index: z.number().int().min(0).optional(), useSample: z.boolean().optional() }).parse(req.body);
  const r = await renderPreview(b.payload as MessagePayload, { index: b.index, useSample: b.useSample });
  res.json({ ...r, html: wrapShell(r.bodyHtml, b.payload.shell, undefined, b.payload.shellOptions) });
}));

router.post('/send/preview', heavyLimiter, handle(async (req, res) => {
  const b = z.object({ payload: payloadSchema, draftId: z.string().max(60).nullish() }).parse(req.body);
  const p = await prepareMessage(b.payload as MessagePayload, { messageId: b.draftId });
  const budget = await broadcastBudgetRemaining();
  res.json({
    mode: p.mode, counts: p.counts, blockers: p.blockers, groupErrors: p.groupErrors, templateIssues: p.templateIssues,
    attachments: p.attachments, known: p.known, quota: quotaPreview(budget, p.counts.quotaCost), sender: MAIL_FROM,
    requiresCountConfirmation: p.counts.messages >= LIMITS.largeSend,
    items: p.items.map(i => ({
      index: i.index, email: i.email, name: i.name, source: i.source, matchedStudent: i.matchedStudent, studentRoll: i.studentRoll,
      groupRef: i.groupRef, state: i.state, note: i.note ?? null, missing: i.missing, data: i.data,
      issues: i.issues.map(x => ({ code: x.code, severity: x.severity, message: x.message })),
    })),
  });
}));

router.post('/send', sendLimiter, handle(async (req, res) => {
  const b = z.object({
    payload: payloadSchema,
    idempotencyKey: z.string().min(8).max(100),
    draftId: z.string().max(60).nullish(),
    confirmedCount: z.number().int().optional(),
    acknowledgeCopies: z.boolean().optional(),
  }).parse(req.body);
  const out = await sendMessage(b.payload as MessagePayload, {
    idempotencyKey: b.idempotencyKey, draftId: b.draftId ?? null, confirmedCount: b.confirmedCount, acknowledgeCopies: b.acknowledgeCopies,
  });
  if (!out.duplicate && process.env.EMAIL_CENTRE_AUTO_PROCESS !== 'false') kickQueue();
  res.status(out.duplicate ? 200 : 202).json(out);
}));

router.post('/test', sendLimiter, handle(async (req, res) => {
  const b = z.object({
    payload: payloadSchema, testEmail: z.string().max(320),
    recipientIndex: z.number().int().min(0).optional(), useSample: z.boolean().optional(),
  }).parse(req.body);
  res.json(await sendTest(b.payload as MessagePayload, { testEmail: b.testEmail, recipientIndex: b.recipientIndex, useSample: b.useSample }));
}));

// ── Activity ───────────────────────────────────────────────────────────────
router.get('/activity', handle(async (req, res) => {
  res.json({
    messages: await store.listActivity({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    }),
  });
}));

router.get('/activity/:id', handle(async (req, res) => { res.json(await store.getActivity(param(req.params.id))); }));

router.post('/activity/:id/retry', sendLimiter, handle(async (req, res) => {
  const out = await retryFailed(param(req.params.id));
  if (out.requeued > 0 && process.env.EMAIL_CENTRE_AUTO_PROCESS !== 'false') kickQueue();
  res.json(out);
}));

router.post('/activity/:id/cancel', handle(async (req, res) => { res.json(await cancelMessage(param(req.params.id))); }));

// ── Templates ──────────────────────────────────────────────────────────────
router.get('/templates', handle(async (req, res) => {
  res.json({ templates: await store.listTemplates(req.query.archived === '1') });
}));

// Gallery thumbnail: the template rendered with sample data through the SAME pipeline as
// preview/test/send (renderPreview + wrapShell). Message variables a template expects get a
// visible sample so the thumbnail isn't full of "missing" markers.
router.get('/templates/:id/preview', handle(async (req, res) => {
  const t = await store.getTemplate(param(req.params.id), req.query.version ? Number(req.query.version) : undefined);
  const shared = Object.fromEntries(Object.entries(t.body.settings.sharedData ?? {}).map(([k, v]) => [k, v || `Sample ${k.replace(/_/g, ' ')}`]));
  const shell = t.body.settings.shell ?? 'dna';
  const r = await renderPreview({
    mode: t.body.mode, subject: t.body.subject, doc: t.body.doc, recipients: [], groups: [], cc: [], bcc: [],
    sharedData: shared, fallbacks: t.body.settings.fallbacks ?? {}, eventId: null, shell, shellOptions: t.body.settings.shellOptions ?? null, attachmentIds: [],
  }, { useSample: true });
  res.json({ ok: r.ok, subject: r.subject, html: wrapShell(r.bodyHtml, shell, undefined, t.body.settings.shellOptions), issues: r.issues });
}));

router.get('/templates/:id', handle(async (req, res) => {
  res.json(await store.getTemplate(param(req.params.id), req.query.version ? Number(req.query.version) : undefined));
}));

router.post('/templates', handle(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).nullish(), category: z.string().max(40).optional(), body: templateBodySchema }).parse(req.body);
  const id = await store.createTemplate(b, b.body as store.TemplateBody);
  res.status(201).json({ id });
}));

router.put('/templates/:id', handle(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).nullish(), body: templateBodySchema }).parse(req.body);
  const version = await store.saveTemplateVersion(param(req.params.id), b, b.body as store.TemplateBody);
  res.json({ version });
}));

router.post('/templates/:id/duplicate', handle(async (req, res) => { res.status(201).json({ id: await store.duplicateTemplate(param(req.params.id)) }); }));
router.post('/templates/:id/archive', handle(async (req, res) => { await store.setTemplateArchived(param(req.params.id), true); res.json({ success: true }); }));
router.post('/templates/:id/unarchive', handle(async (req, res) => { await store.setTemplateArchived(param(req.params.id), false); res.json({ success: true }); }));

export default router;

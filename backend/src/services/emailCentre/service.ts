// Email Centre orchestration: prepare (resolve + validate + render) → send
// (snapshot + enqueue) → process (atomic quota reservation + dispatch) →
// retry / cancel / webhook outcomes. Previews and real sends share the same
// prepare() and the same engine, so they can't drift.

import crypto from 'crypto';
import { pool } from '../../db/client';
import { lockQuotaBudget, addQuotaUsage, broadcastBudgetRemaining } from '../mailer';
import { dnaShell, type ShellOptions } from './emailShell';
import {
  CATALOG_NAMES, KEY_RE, SHARED_ONLY_NAMES, renderMessage, sampleData, validateTemplate,
  type DocNode, type Issue, type RecipientData, type RenderResult, type SubjectConfig,
} from './engine';
import {
  isValidEmail, resolveRecipients, cleanCustomData,
  type RecipientInput, type ResolvedRecipient,
} from './recipients';
import { getEmailProvider, type ProviderAttachment, type ProviderResult } from './provider';

// ── Limits ──────────────────────────────────────────────────────────────────
export const LIMITS = {
  maxRecipients: 1000,
  /** Resend allows at most 50 recipients (to+cc+bcc) in one API request. */
  maxNormalRecipients: 50,
  maxIndividualCopies: 3,
  /** Sends producing this many separate messages need an explicit count confirmation. */
  largeSend: 20,
  maxAttachmentBytes: 10 * 1024 * 1024,
  /** Raw bytes per message; Resend caps the base64-encoded email at 40 MB. */
  maxTotalAttachmentBytes: 15 * 1024 * 1024,
  maxDocBytes: 400_000,
} as const;

const SITE_URL = 'https://www.dnaiitk.site';
const STALE_LOCK_MINUTES = 10;

export type Mode = 'normal' | 'individual';
export type Shell = 'dna' | 'plain';

export interface MessagePayload {
  mode: Mode;
  subject: SubjectConfig;
  doc: DocNode;
  recipients: RecipientInput[];
  groups: string[];
  cc: string[];
  bcc: string[];
  sharedData: Record<string, string>;
  fallbacks: Record<string, string>;
  eventId?: string | null;
  shell: Shell;
  /** Header/footer wording for the DNA layout (e.g. a two-label header). */
  shellOptions?: ShellOptions | null;
  attachmentIds: string[];
  templateId?: string | null;
  templateVersion?: number | null;
}

export class EmailCentreError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) { super(message); }
}

// ── Shell ───────────────────────────────────────────────────────────────────
export function wrapShell(bodyHtml: string, shell: Shell, banner?: string, options?: ShellOptions | null): string {
  if (shell === 'plain') {
    const inner = banner ? `${banner}${bodyHtml}` : bodyHtml;
    return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111;font-size:15px">${inner}</div>`;
  }
  // 'dna': the unified DNA layout (see emailShell.ts), used by every built-in template.
  return dnaShell(bodyHtml, { banner, ...(options ?? {}) });
}

export const TEST_BANNER = (who: string) =>
  `<div style="background:#fde68a;color:#7c2d12;padding:8px 12px;margin-bottom:16px;border-radius:6px;font:12px/1.4 Arial,sans-serif">TEST EMAIL — rendered for ${who}. It was NOT sent to your audience.</div>`;

// ── Event / shared data ─────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatEventDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : d ?? '';
}

async function loadEventVars(eventId: string): Promise<Record<string, string> | null> {
  const r = await pool.query<{ title: string; date: string; location: string; registration_form_url: string | null }>(
    'SELECT title, date, location, registration_form_url FROM events WHERE id = $1', [eventId]);
  const e = r.rows[0];
  if (!e) return null;
  return {
    event_name: e.title,
    event_date: formatEventDate(e.date),
    event_venue: e.location,
    event_link: e.registration_form_url || `${SITE_URL}/events`,
  };
}

function cleanShared(raw: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cleanCustomData(raw))) if (KEY_RE.test(k)) out[k] = v;
  return out;
}

function mergeData(shared: Record<string, string>, own: RecipientData): RecipientData {
  const out: RecipientData = { ...shared };
  for (const [k, v] of Object.entries(own)) {
    if (v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '')) out[k] = v;
    else if (!(k in out)) out[k] = v;
  }
  return out;
}

// ── Attachments ─────────────────────────────────────────────────────────────
export interface AttachmentMeta { id: string; filename: string; mimeType: string; sizeBytes: number; inline: boolean }

async function loadAttachmentMeta(ids: string[], messageId?: string | null): Promise<AttachmentMeta[]> {
  if (ids.length === 0) return [];
  const r = await pool.query<{ id: string; filename: string; mime_type: string; size_bytes: number; inline: boolean; message_id: string | null }>(
    'SELECT id, filename, mime_type, size_bytes, inline, message_id FROM ec_attachments WHERE id = ANY($1::text[])', [ids]);
  // Attachments are uploaded onto a draft, so a send may only use its own draft's files
  // (or files not yet attached to anything) — never another message's.
  for (const row of r.rows) {
    if (row.message_id && row.message_id !== messageId) {
      throw new EmailCentreError('An attachment belongs to a different message', 400);
    }
  }
  const found = new Set(r.rows.map(x => x.id));
  const missing = ids.filter(i => !found.has(i));
  if (missing.length) throw new EmailCentreError('An attachment no longer exists — remove it and upload again', 400);
  return r.rows.map(x => ({ id: x.id, filename: x.filename, mimeType: x.mime_type, sizeBytes: x.size_bytes, inline: x.inline }));
}

async function loadAttachmentBytes(messageId: string): Promise<ProviderAttachment[]> {
  const r = await pool.query<{ id: string; filename: string; mime_type: string; inline: boolean; content: Buffer }>(
    'SELECT id, filename, mime_type, inline, content FROM ec_attachments WHERE message_id = $1 ORDER BY created_at', [messageId]);
  return r.rows.map(a => ({
    filename: a.filename, content: a.content, contentType: a.mime_type,
    ...(a.inline ? { contentId: a.id } : {}),
  }));
}

// ── Prepare ─────────────────────────────────────────────────────────────────
export type ItemState = 'valid' | 'missing_data' | 'invalid_email' | 'render_error' | 'excluded';

export interface PreparedItem {
  index: number;
  email: string;
  name: string | null;
  source: ResolvedRecipient['source'];
  matchedStudent: boolean;
  studentRoll: string | null;
  groupRef: { id: string; name: string } | null;
  state: ItemState;
  note?: string;
  issues: Issue[];
  missing: string[];
  data: RecipientData;
  render?: RenderResult;
}

export interface Prepared {
  mode: Mode;
  items: PreparedItem[];
  /** Normal mode: the one shared render. */
  shared?: RenderResult;
  templateIssues: Issue[];
  groupErrors: string[];
  blockers: string[];
  attachments: AttachmentMeta[];
  counts: {
    total: number; valid: number; invalid: number; excluded: number; missingData: number; renderError: number;
    messages: number; ccCount: number; bccCount: number; extraCopies: number; quotaCost: number;
  };
  known: string[];
}

function dedupeEmails(list: string[]): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>(); const valid: string[] = []; const invalid: string[] = [];
  for (const raw of list ?? []) {
    const e = String(raw).trim();
    if (!e) continue;
    if (!isValidEmail(e)) { invalid.push(e); continue; }
    if (!seen.has(e.toLowerCase())) { seen.add(e.toLowerCase()); valid.push(e); }
  }
  return { valid, invalid };
}

export async function prepareMessage(payload: MessagePayload, opts: { messageId?: string | null } = {}): Promise<Prepared> {
  const blockers: string[] = [];
  const { recipients, groupErrors } = await resolveRecipients(payload.recipients ?? [], payload.groups ?? []);
  blockers.push(...groupErrors);

  const shared: Record<string, string> = {};
  if (payload.eventId) {
    const ev = await loadEventVars(payload.eventId);
    if (!ev) blockers.push('The selected event no longer exists');
    else Object.assign(shared, ev);
  }
  Object.assign(shared, cleanShared(payload.sharedData));

  const cc = dedupeEmails(payload.cc); const bcc = dedupeEmails(payload.bcc);
  if (cc.invalid.length) blockers.push(`Invalid CC address: ${cc.invalid.slice(0, 3).join(', ')}`);
  if (bcc.invalid.length) blockers.push(`Invalid BCC address: ${bcc.invalid.slice(0, 3).join(', ')}`);

  const attachments = await loadAttachmentMeta(payload.attachmentIds ?? [], opts.messageId);
  const totalBytes = attachments.reduce((s, a) => s + a.sizeBytes, 0);
  if (totalBytes > LIMITS.maxTotalAttachmentBytes) {
    blockers.push(`Attachments total ${(totalBytes / 1048576).toFixed(1)} MB; the limit is ${LIMITS.maxTotalAttachmentBytes / 1048576} MB per message`);
  }

  const active = recipients.filter(r => r.state === 'ok');

  // Variables usable in this message.
  const known = new Set<string>(Object.keys(shared));
  if (payload.mode === 'individual') {
    for (const n of CATALOG_NAMES) known.add(n);
    for (const r of active) for (const k of Object.keys(r.data)) if (KEY_RE.test(k)) known.add(k);
  } else {
    for (const n of SHARED_ONLY_NAMES) known.add(n);
  }

  const templateIssues = validateTemplate(payload.subject, payload.doc, known);
  const tplErrors = templateIssues.filter(i => i.severity === 'error');
  // In Normal mode a per-person variable is not "unknown" — it is unavailable; a dedicated,
  // clearer blocker is added below instead of the generic unknown-variable message.
  const personalHere = (i: Issue) => payload.mode === 'normal' && i.code === 'unknown_variable'
    && Boolean(i.variable) && CATALOG_NAMES.has(i.variable!) && !SHARED_ONLY_NAMES.has(i.variable!);
  const reportable = tplErrors.filter(i => !personalHere(i));
  if (reportable.length) blockers.push(...reportable.map(i => i.message));

  const items: PreparedItem[] = [];
  let shared_: RenderResult | undefined;

  if (payload.mode === 'normal') {
    shared_ = renderMessage({ subject: payload.subject, doc: payload.doc, fallbacks: payload.fallbacks, known, data: shared });
    for (const i of shared_.issues) {
      // unknown_variable is already reported by validateTemplate (or by the personal-variable blocker below).
      if (i.severity === 'error' && i.code !== 'unknown_variable') blockers.push(i.message);
    }
    const personal = [...new Set([...(shared_.issues.filter(i => i.code === 'unknown_variable').map(i => i.variable!))])]
      .filter(n => CATALOG_NAMES.has(n) && !SHARED_ONLY_NAMES.has(n));
    if (personal.length) blockers.push(`Personal variables (${personal.map(n => `{{${n}}}`).join(', ')}) only work in Individual mode — every recipient would get the same email`);
  }

  recipients.forEach((r, index) => {
    const base: PreparedItem = {
      index, email: r.email, name: r.displayName, source: r.source, matchedStudent: r.matchedStudent,
      studentRoll: r.studentRoll, groupRef: r.groupRef, state: 'valid', note: r.note, issues: [], missing: [], data: r.data,
    };
    if (r.state === 'invalid_email') base.state = 'invalid_email';
    else if (r.state === 'excluded') base.state = 'excluded';
    else if (payload.mode === 'individual') {
      const render = renderMessage({ subject: payload.subject, doc: payload.doc, fallbacks: payload.fallbacks, known, data: mergeData(shared, r.data) });
      base.render = render;
      base.issues = render.issues;
      base.missing = [...new Set(render.issues.filter(i => i.code === 'missing_data').map(i => i.variable!))];
      if (!render.ok) base.state = base.missing.length ? 'missing_data' : 'render_error';
    }
    items.push(base);
  });

  const count = (s: ItemState) => items.filter(i => i.state === s).length;
  const valid = count('valid');
  const ccCount = cc.valid.length; const bccCount = bcc.valid.length;
  const copies = ccCount + bccCount;

  if (payload.mode === 'normal') {
    if (valid === 0) blockers.push('Add at least one To recipient');
    const total = valid + copies;
    if (total > LIMITS.maxNormalRecipients) {
      blockers.push(`Normal mode sends one email to everyone and is limited to ${LIMITS.maxNormalRecipients} recipients (To+CC+BCC); you have ${total}. Use Individual mode instead.`);
    }
  } else {
    if (valid === 0) blockers.push('Add at least one recipient');
    if (copies > LIMITS.maxIndividualCopies) {
      blockers.push(`In Individual mode every CC/BCC address receives a copy of EVERY email; the limit is ${LIMITS.maxIndividualCopies} such addresses`);
    }
  }
  const needAttention = count('missing_data') + count('render_error') + count('invalid_email');
  if (needAttention > 0) blockers.push(`${needAttention} recipient${needAttention === 1 ? ' needs' : 's need'} attention — fix or exclude ${needAttention === 1 ? 'it' : 'them'} before sending`);

  const messages = payload.mode === 'normal' ? (valid > 0 ? 1 : 0) : valid;
  const quotaCost = payload.mode === 'normal' ? (valid > 0 ? valid + copies : 0) : valid * (1 + copies);

  return {
    mode: payload.mode, items, shared: shared_, templateIssues, groupErrors,
    blockers: [...new Set(blockers)], attachments, known: [...known].sort(),
    counts: {
      total: items.length, valid, invalid: count('invalid_email'), excluded: count('excluded'),
      missingData: count('missing_data'), renderError: count('render_error'),
      messages, ccCount, bccCount, extraCopies: payload.mode === 'individual' ? valid * copies : 0, quotaCost,
    },
  };
}

export function quotaPreview(budget: number, cost: number) {
  return { budgetNow: budget, cost, sendNow: Math.min(cost, budget), deferred: Math.max(0, cost - budget) };
}

// ── Send ────────────────────────────────────────────────────────────────────
export interface SendOptions {
  idempotencyKey: string;
  draftId?: string | null;
  confirmedCount?: number;
  acknowledgeCopies?: boolean;
  actor?: string;
}

export interface SendOutcome {
  messageId: string;
  duplicate: boolean;
  status: string;
  messages: number;
  quotaCost: number;
}

function newId(prefix: string): string { return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`; }

function stableJson(v: unknown): string { return JSON.stringify(v); }

export async function sendMessage(payload: MessagePayload, opts: SendOptions): Promise<SendOutcome> {
  // Same key → same message. Returns the first attempt instead of sending twice.
  const existing = await pool.query<{ id: string; status: string; total_recipients: number }>(
    'SELECT id, status, total_recipients FROM ec_messages WHERE idempotency_key = $1', [opts.idempotencyKey]);
  if (existing.rows[0]) {
    return { messageId: existing.rows[0].id, duplicate: true, status: existing.rows[0].status, messages: existing.rows[0].total_recipients, quotaCost: 0 };
  }

  const prepared = await prepareMessage(payload, { messageId: opts.draftId });
  if (prepared.blockers.length > 0) {
    throw new EmailCentreError('This message cannot be sent yet', 422, { blockers: prepared.blockers });
  }
  const { counts } = prepared;
  if (counts.messages >= LIMITS.largeSend && opts.confirmedCount !== counts.messages) {
    throw new EmailCentreError(
      `This sends ${counts.messages} separate emails. Confirm the exact count to proceed.`, 409,
      { requiresConfirmation: true, messages: counts.messages });
  }
  if (payload.mode === 'individual' && counts.ccCount + counts.bccCount > 0 && !opts.acknowledgeCopies) {
    throw new EmailCentreError(
      `Each of the ${counts.valid} emails will also be copied to ${counts.ccCount + counts.bccCount} address(es) (${counts.extraCopies} extra deliveries). Acknowledge to proceed.`,
      409, { requiresCopyAcknowledgement: true });
  }

  const cc = dedupeEmails(payload.cc).valid; const bcc = dedupeEmails(payload.bcc).valid;
  const messageId = opts.draftId ?? newId('msg');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const contentHash = crypto.createHash('sha256').update(stableJson([payload.subject, payload.doc, payload.mode])).digest('hex');
    const settings = { cc, bcc, sharedData: cleanShared(payload.sharedData), fallbacks: payload.fallbacks ?? {}, eventId: payload.eventId ?? null, shell: payload.shell, shellOptions: payload.shellOptions ?? null, attachmentIds: payload.attachmentIds ?? [] };
    const recipientInput = { recipients: payload.recipients, groups: payload.groups };

    if (opts.draftId) {
      const upd = await client.query(
        `UPDATE ec_messages SET status='queued', mode=$2, subject_config=$3::jsonb, doc=$4::jsonb, settings=$5::jsonb,
                recipient_input=$6::jsonb, template_id=$7, template_version=$8, idempotency_key=$9,
                content_hash=$10, total_recipients=$11, queued_at=NOW(), updated_at=NOW(), revision=revision+1
          WHERE id=$1 AND status='draft' RETURNING id`,
        [messageId, payload.mode, JSON.stringify(payload.subject), JSON.stringify(payload.doc), JSON.stringify(settings),
          JSON.stringify(recipientInput), payload.templateId ?? null, payload.templateVersion ?? null, opts.idempotencyKey,
          contentHash, counts.messages]);
      if (upd.rowCount === 0) throw new EmailCentreError('This draft was already sent or no longer exists', 409);
    } else {
      await client.query(
        `INSERT INTO ec_messages (id, status, mode, subject_config, doc, settings, recipient_input, template_id, template_version,
                                  idempotency_key, content_hash, total_recipients, created_by, queued_at)
         VALUES ($1,'queued',$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,NOW())`,
        [messageId, payload.mode, JSON.stringify(payload.subject), JSON.stringify(payload.doc), JSON.stringify(settings),
          JSON.stringify(recipientInput), payload.templateId ?? null, payload.templateVersion ?? null, opts.idempotencyKey,
          contentHash, counts.messages, opts.actor ?? 'admin']);
    }

    // Attachments referenced by the message become its own.
    if (payload.attachmentIds?.length) {
      await client.query('UPDATE ec_attachments SET message_id = $1 WHERE id = ANY($2::text[]) AND (message_id IS NULL OR message_id = $1)', [messageId, payload.attachmentIds]);
    }

    const sendable = prepared.items.filter(i => i.state === 'valid');
    let jobIds: (number | null)[] = [];

    if (payload.mode === 'individual') {
      const costEach = 1 + cc.length + bcc.length;
      const rows = sendable.map(i => ({ subject: i.render!.subject, html: wrapShell(i.render!.bodyHtml, payload.shell, undefined, payload.shellOptions), text: i.render!.text, hash: i.render!.hash, email: i.email }));
      const ins = await client.query<{ id: string }>(
        `INSERT INTO ec_send_jobs (message_id, rendered_subject, rendered_html, rendered_text, render_hash, to_emails, cc_emails, bcc_emails, quota_cost)
         SELECT $1, t.subject, t.html, t.text, t.hash, ARRAY[t.email], $2::text[], $3::text[], $4
           FROM unnest($5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) WITH ORDINALITY AS t(subject, html, text, hash, email, ord)
          ORDER BY t.ord RETURNING id`,
        [messageId, cc, bcc, costEach, rows.map(r => r.subject), rows.map(r => r.html), rows.map(r => r.text), rows.map(r => r.hash), rows.map(r => r.email)]);
      // Sequence values are allocated in ORDER BY ord order, so ascending id == recipient order.
      const ids = ins.rows.map(r => Number(r.id)).sort((a, b) => a - b);
      let n = 0;
      jobIds = prepared.items.map(i => (i.state === 'valid' ? ids[n++] : null));
    } else {
      const r = prepared.shared!;
      const html = wrapShell(r.bodyHtml, payload.shell, undefined, payload.shellOptions);
      const toEmails = sendable.map(i => i.email);
      const ins = await client.query<{ id: string }>(
        `INSERT INTO ec_send_jobs (message_id, rendered_subject, rendered_html, rendered_text, render_hash, to_emails, cc_emails, bcc_emails, quota_cost)
         VALUES ($1,$2,$3,$4,$5,$6::text[],$7::text[],$8::text[],$9) RETURNING id`,
        [messageId, r.subject, html, r.text, r.hash, toEmails, cc, bcc, toEmails.length + cc.length + bcc.length]);
      const id = Number(ins.rows[0].id);
      jobIds = prepared.items.map(i => (i.state === 'valid' ? id : null));
    }

    // Recipient snapshot — including who was excluded and why, and the exact
    // data used. A retry never re-reads the live student record.
    const it = prepared.items;
    await client.query(
      `INSERT INTO ec_message_recipients (message_id, position, role, email, display_name, source, student_roll, data, group_ref, validation, validation_note, status, job_id)
       SELECT $1, t.pos, 'to', t.email, t.name, t.source, t.roll, t.data::jsonb, t.gref::jsonb, t.validation, t.note, t.status, t.job
         FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::bigint[])
              AS t(pos, email, name, source, roll, data, gref, validation, note, status, job)`,
      [messageId, it.map(i => i.index), it.map(i => i.email), it.map(i => i.name), it.map(i => i.source), it.map(i => i.studentRoll),
        it.map(i => JSON.stringify(i.data)), it.map(i => (i.groupRef ? JSON.stringify(i.groupRef) : null)),
        it.map(i => i.state), it.map(i => i.note ?? null), it.map(i => (i.state === 'valid' ? 'queued' : 'excluded')), jobIds]);

    await client.query(
      `INSERT INTO ec_audit_logs (actor, action, entity_type, entity_id, details) VALUES ($1,'send','message',$2,$3::jsonb)`,
      [opts.actor ?? 'admin', messageId, JSON.stringify({ mode: payload.mode, messages: counts.messages, quotaCost: counts.quotaCost, excluded: counts.excluded, cc: cc.length, bcc: bcc.length })]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    // A concurrent identical request lost the race on the unique key.
    if ((err as { code?: string }).code === '23505') {
      const again = await pool.query<{ id: string; status: string; total_recipients: number }>(
        'SELECT id, status, total_recipients FROM ec_messages WHERE idempotency_key = $1', [opts.idempotencyKey]);
      if (again.rows[0]) return { messageId: again.rows[0].id, duplicate: true, status: again.rows[0].status, messages: again.rows[0].total_recipients, quotaCost: 0 };
    }
    throw err;
  } finally {
    client.release();
  }

  return { messageId, duplicate: false, status: 'queued', messages: counts.messages, quotaCost: counts.quotaCost };
}

// ── Queue processing ───────────────────────────────────────────────────────
interface JobRow {
  id: string; message_id: string; rendered_subject: string; rendered_html: string; rendered_text: string | null;
  to_emails: string[]; cc_emails: string[]; bcc_emails: string[]; quota_cost: number; quota_reserved: number;
  attempts: number; send_generation: number;
}

/**
 * Atomically claim queued jobs that fit today's broadcast budget. The mail_usage
 * row lock serialises every concurrent claimer, so reservations can never
 * exceed the budget. Jobs that don't fit stay queued (FIFO — the first job that
 * doesn't fit stops the claim so large sends can't be starved by small ones).
 */
async function claimJobs(limit: number): Promise<JobRow[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ec_send_jobs SET status='queued', locked_at=NULL, updated_at=NOW()
        WHERE status='sending' AND locked_at < NOW() - ($1 || ' minutes')::interval`, [String(STALE_LOCK_MINUTES)]);

    let budget = await lockQuotaBudget(client);
    const cand = await client.query<JobRow>(
      `SELECT j.* FROM ec_send_jobs j JOIN ec_messages m ON m.id = j.message_id
        WHERE j.status='queued' AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW())
          AND m.status IN ('queued','sending')
        ORDER BY j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED`, [limit]);

    const claimed: JobRow[] = []; let reserve = 0;
    for (const job of cand.rows) {
      const need = job.quota_reserved > 0 ? 0 : job.quota_cost; // crash-recovered jobs already hold their reservation
      if (need > budget) break;
      budget -= need; reserve += need;
      claimed.push(job);
    }
    if (claimed.length) {
      const ids = claimed.map(j => Number(j.id));
      await client.query(
        `UPDATE ec_send_jobs SET status='sending', locked_at=NOW(), attempts=attempts+1, quota_reserved=quota_cost, updated_at=NOW()
          WHERE id = ANY($1::bigint[])`, [ids]);
      await client.query(`UPDATE ec_message_recipients SET status='sending', updated_at=NOW() WHERE job_id = ANY($1::bigint[]) AND status='queued'`, [ids]);
      await client.query(`UPDATE ec_messages SET status='sending', updated_at=NOW() WHERE id = ANY($1::text[]) AND status='queued'`, [[...new Set(claimed.map(j => j.message_id))]]);
      await addQuotaUsage(client, reserve);
    }
    await client.query('COMMIT');
    return claimed;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function refreshMessageStatus(messageId: string): Promise<void> {
  const r = await pool.query<{ status: string; n: string }>(
    'SELECT status, COUNT(*) AS n FROM ec_send_jobs WHERE message_id = $1 GROUP BY status', [messageId]);
  const c: Record<string, number> = {};
  for (const row of r.rows) c[row.status] = parseInt(row.n, 10);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (total === 0) return;
  const open = (c.queued ?? 0) + (c.sending ?? 0);
  let status: string;
  if (open > 0) status = (c.accepted ?? 0) + (c.failed ?? 0) + (c.sending ?? 0) > 0 ? 'sending' : 'queued';
  else if ((c.cancelled ?? 0) === total) status = 'cancelled';
  else if ((c.failed ?? 0) + (c.cancelled ?? 0) === total) status = 'failed';
  else status = 'completed';
  await pool.query(
    `UPDATE ec_messages SET status=$2, updated_at=NOW(), completed_at = CASE WHEN $2 IN ('completed','failed','cancelled') THEN COALESCE(completed_at, NOW()) ELSE NULL END
      WHERE id=$1 AND status <> 'draft'`, [messageId, status]);
}

function idemKey(job: JobRow): string { return `ec-job-${job.id}-g${job.send_generation}`; }

async function dispatchJob(job: JobRow, attachments: ProviderAttachment[]): Promise<ProviderResult> {
  return getEmailProvider().send({
    to: job.to_emails, cc: job.cc_emails, bcc: job.bcc_emails,
    subject: job.rendered_subject, html: job.rendered_html, text: job.rendered_text ?? undefined,
    attachments: attachments.length ? attachments : undefined,
  }, { idempotencyKey: idemKey(job) });
}

async function recordResult(job: JobRow, res: ProviderResult): Promise<'sent' | 'failed' | 'deferred'> {
  if (res.ok) {
    await pool.query(
      `UPDATE ec_send_jobs SET status='accepted', provider_message_id=$2, sent_at=NOW(), locked_at=NULL, error_message=NULL, error_kind=NULL, updated_at=NOW() WHERE id=$1`,
      [job.id, res.id]);
    // Never overwrite a webhook outcome that raced ahead of us.
    await pool.query(`UPDATE ec_message_recipients SET status='sent', error_message=NULL, updated_at=NOW() WHERE job_id=$1 AND status IN ('queued','sending','failed')`, [job.id]);
    return 'sent';
  }
  if (res.kind === 'rate_limited') {
    await addQuotaUsage(pool, -job.quota_cost);
    await pool.query(
      `UPDATE ec_send_jobs SET status='queued', quota_reserved=0, locked_at=NULL, attempts=GREATEST(attempts-1,0), next_attempt_at=NOW() + INTERVAL '60 seconds', error_message=$2, updated_at=NOW() WHERE id=$1`,
      [job.id, res.message]);
    await pool.query(`UPDATE ec_message_recipients SET status='queued', updated_at=NOW() WHERE job_id=$1 AND status='sending'`, [job.id]);
    return 'deferred';
  }
  // 'rejected' and 'config': provider certainly did not send → release the reservation.
  // 'transient': it MAY have accepted the request → keep the reservation (conservative).
  if (res.kind === 'rejected' || res.kind === 'config') {
    await addQuotaUsage(pool, -job.quota_cost);
    await pool.query('UPDATE ec_send_jobs SET quota_reserved=0 WHERE id=$1', [job.id]);
  }
  await pool.query(
    `UPDATE ec_send_jobs SET status='failed', error_kind=$2, error_message=$3, locked_at=NULL, updated_at=NOW() WHERE id=$1`,
    [job.id, res.kind, res.message.slice(0, 1000)]);
  await pool.query(
    `UPDATE ec_message_recipients SET status='failed', error_message=$2, failed_at=NOW(), updated_at=NOW() WHERE job_id=$1 AND status IN ('queued','sending')`,
    [job.id, res.message.slice(0, 1000)]);
  return 'failed';
}

let processing = false;

/** Drain as much of the queue as today's budget allows. Safe to call concurrently. */
export async function processQueue(opts: { batch?: number; deadlineMs?: number; paceMs?: number } = {}): Promise<{ sent: number; failed: number; deferred: number }> {
  const out = { sent: 0, failed: 0, deferred: 0 };
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);
  const pace = opts.paceMs ?? (process.env.NODE_ENV === 'test' ? 0 : 550); // Resend default: 2 requests/second
  const attachmentCache = new Map<string, ProviderAttachment[]>();

  while (Date.now() < deadline) {
    const jobs = await claimJobs(opts.batch ?? 10);
    if (jobs.length === 0) break;
    const touched = new Set<string>();
    for (const job of jobs) {
      try {
        let atts = attachmentCache.get(job.message_id);
        if (!atts) { atts = await loadAttachmentBytes(job.message_id); attachmentCache.set(job.message_id, atts); }
        const res = await dispatchJob(job, atts);
        const r = await recordResult(job, res);
        out[r === 'sent' ? 'sent' : r === 'failed' ? 'failed' : 'deferred']++;
      } catch (err) {
        // Unexpected local failure after claim: don't lose the job.
        console.error(`Email Centre job ${job.id} crashed:`, err);
        await recordResult(job, { ok: false, kind: 'transient', message: err instanceof Error ? err.message : 'Unexpected error' }).catch(() => undefined);
        out.failed++;
      }
      touched.add(job.message_id);
      if (pace > 0) await new Promise(r => setTimeout(r, pace));
    }
    for (const m of touched) await refreshMessageStatus(m);
    if (out.deferred > 0) break; // provider is rate limiting — wait for the next tick
  }
  return out;
}

/** Fire-and-forget kick used right after a send is accepted. */
export function kickQueue(): void {
  if (processing) return;
  processing = true;
  processQueue().catch(err => console.error('Email Centre queue run failed:', err)).finally(() => { processing = false; });
}

// ── Retry / cancel ──────────────────────────────────────────────────────────
export async function retryFailed(messageId: string, actor = 'admin'): Promise<{ requeued: number; skipped: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = await client.query<{ mode: Mode; status: string }>('SELECT mode, status FROM ec_messages WHERE id=$1 FOR UPDATE', [messageId]);
    if (!m.rows[0]) throw new EmailCentreError('Message not found', 404);
    if (m.rows[0].status === 'draft') throw new EmailCentreError('A draft has nothing to retry', 400);
    const mode = m.rows[0].mode;

    // (a) the provider never accepted the job. (b) individual mode only: the
    // provider accepted it, then reported a failure for that one recipient.
    // Bounced / suppressed / complained / delivered / sent recipients are never eligible.
    const jobs = await client.query<{ id: string; error_kind: string | null; status: string }>(
      `SELECT j.id, j.error_kind, j.status FROM ec_send_jobs j
        WHERE j.message_id = $1 AND (
          j.status = 'failed'
          OR ($2 = 'individual' AND j.status = 'accepted' AND EXISTS (
                SELECT 1 FROM ec_message_recipients r WHERE r.job_id = j.id AND r.status = 'failed')))
        FOR UPDATE`, [messageId, mode]);
    const ids = jobs.rows.map(j => Number(j.id));
    if (ids.length) {
      // Rejected/accepted-then-failed sends get a fresh idempotency generation (the old
      // key may be pinned to the failed attempt); ambiguous transient failures keep the
      // key so a send the provider DID accept is not duplicated.
      await client.query(
        `UPDATE ec_send_jobs SET status='queued', locked_at=NULL, next_attempt_at=NULL, error_message=NULL,
                send_generation = send_generation + CASE WHEN (status='accepted' OR error_kind IN ('rejected','config')) THEN 1 ELSE 0 END,
                provider_message_id = CASE WHEN status='accepted' THEN NULL ELSE provider_message_id END,
                quota_reserved = CASE WHEN status='accepted' OR error_kind IN ('rejected','config') THEN 0 ELSE quota_reserved END,
                error_kind=NULL, updated_at=NOW()
          WHERE id = ANY($1::bigint[])`, [ids]);
      await client.query(`UPDATE ec_message_recipients SET status='queued', error_message=NULL, failed_at=NULL, updated_at=NOW() WHERE job_id = ANY($1::bigint[]) AND status='failed'`, [ids]);
      await client.query(`UPDATE ec_messages SET status='queued', completed_at=NULL, updated_at=NOW() WHERE id=$1`, [messageId]);
    }
    const skipped = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM ec_message_recipients WHERE message_id=$1 AND status IN ('bounced','suppressed','complained')`, [messageId]);
    await client.query(`INSERT INTO ec_audit_logs (actor, action, entity_type, entity_id, details) VALUES ($1,'retry','message',$2,$3::jsonb)`,
      [actor, messageId, JSON.stringify({ requeued: ids.length })]);
    await client.query('COMMIT');
    return { requeued: ids.length, skipped: parseInt(skipped.rows[0].n, 10) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelMessage(messageId: string, actor = 'admin'): Promise<{ cancelled: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const jobs = await client.query<{ id: string }>(
      `UPDATE ec_send_jobs SET status='cancelled', updated_at=NOW() WHERE message_id=$1 AND status='queued' RETURNING id`, [messageId]);
    const ids = jobs.rows.map(j => Number(j.id));
    if (ids.length) await client.query(`UPDATE ec_message_recipients SET status='cancelled', updated_at=NOW() WHERE job_id = ANY($1::bigint[]) AND status='queued'`, [ids]);
    await client.query(`INSERT INTO ec_audit_logs (actor, action, entity_type, entity_id, details) VALUES ($1,'cancel','message',$2,$3::jsonb)`,
      [actor, messageId, JSON.stringify({ cancelled: ids.length })]);
    await client.query('COMMIT');
    await refreshMessageStatus(messageId);
    return { cancelled: ids.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ── Test send ───────────────────────────────────────────────────────────────
export async function sendTest(
  payload: MessagePayload,
  opts: { testEmail: string; recipientIndex?: number; useSample?: boolean; actor?: string }
): Promise<{ sentTo: string; subject: string; id: string; mock: boolean }> {
  const to = opts.testEmail.trim();
  if (!isValidEmail(to)) throw new EmailCentreError('Enter a valid test email address', 400);
  const rendered = await renderPreview(payload, { index: opts.recipientIndex, useSample: opts.useSample });
  if (!rendered.ok) throw new EmailCentreError('The preview has errors — fix them before sending a test', 422, { issues: rendered.issues });

  const client = await pool.connect();
  let reserved = false;
  try {
    await client.query('BEGIN');
    const budget = await lockQuotaBudget(client);
    if (budget < 1) throw new EmailCentreError("Today's email quota is used up — try again tomorrow", 429);
    await addQuotaUsage(client, 1);
    await client.query('COMMIT');
    reserved = true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally { client.release(); }

  const atts: ProviderAttachment[] = [];
  if (payload.attachmentIds?.length) {
    const r = await pool.query<{ id: string; filename: string; mime_type: string; inline: boolean; content: Buffer }>(
      'SELECT id, filename, mime_type, inline, content FROM ec_attachments WHERE id = ANY($1::text[])', [payload.attachmentIds]);
    for (const a of r.rows) atts.push({ filename: a.filename, content: a.content, contentType: a.mime_type, ...(a.inline ? { contentId: a.id } : {}) });
  }
  const html = wrapShell(rendered.bodyHtml, payload.shell, TEST_BANNER(rendered.forLabel), payload.shellOptions);
  const subject = `[TEST] ${rendered.subject}`;
  const res = await getEmailProvider().send({ to: [to], subject, html, text: rendered.text, attachments: atts.length ? atts : undefined },
    { idempotencyKey: `ec-test-${crypto.randomUUID()}` });
  if (!res.ok) {
    if (reserved && (res.kind === 'rejected' || res.kind === 'config' || res.kind === 'rate_limited')) await addQuotaUsage(pool, -1);
    throw new EmailCentreError(res.message, 502);
  }
  await pool.query(`INSERT INTO ec_audit_logs (actor, action, entity_type, entity_id, details) VALUES ($1,'test_send','message',NULL,$2::jsonb)`,
    [opts.actor ?? 'admin', JSON.stringify({ to, subject })]);
  return { sentTo: to, subject, id: res.id, mock: Boolean(res.mock) };
}

// ── Single preview (same engine as send) ────────────────────────────────────
export interface PreviewResult extends RenderResult {
  forLabel: string;
  recipient: { email: string; name: string | null; state: ItemState } | null;
  attachments: AttachmentMeta[];
}

export async function renderPreview(
  payload: MessagePayload,
  opts: { index?: number; useSample?: boolean } = {}
): Promise<PreviewResult> {
  const prepared = await prepareMessage(payload);
  if (payload.mode === 'normal' && !opts.useSample) {
    const r = prepared.shared!;
    return { ...r, bodyHtml: r.bodyHtml, forLabel: 'all recipients (shared email)', recipient: null, attachments: prepared.attachments };
  }
  if (opts.useSample || prepared.items.length === 0) {
    // No audience yet (e.g. editing a template): preview with the catalog sample values.
    const known = new Set<string>([...CATALOG_NAMES, ...Object.keys(payload.sharedData ?? {})]);
    const data = mergeData(cleanShared(payload.sharedData), sampleData());
    const r = renderMessage({ subject: payload.subject, doc: payload.doc, fallbacks: payload.fallbacks, known, data });
    return { ...r, forLabel: 'sample data', recipient: null, attachments: prepared.attachments };
  }
  const idx = Math.min(Math.max(opts.index ?? 0, 0), prepared.items.length - 1);
  const item = prepared.items[idx];
  const render = item.render ?? {
    ok: false, subject: '', bodyHtml: '', text: '', issues: [{ code: 'invalid_condition' as const, severity: 'error' as const, message: item.note ?? item.state }],
    resolved: {}, branches: [], hash: '',
  };
  return { ...render, forLabel: item.name || item.email, recipient: { email: item.email, name: item.name, state: item.state }, attachments: prepared.attachments };
}


// ── Provider events (webhook) ───────────────────────────────────────────────
export interface ProviderEvent {
  type: string;
  created_at?: string;
  data?: { email_id?: string; to?: string[] | string; bounce?: { message?: string; type?: string }; reason?: string; failed?: { reason?: string } };
}

const DELIVERED_FROM = ['queued', 'sending', 'sent'];
const BAD_FROM = ['queued', 'sending', 'sent', 'delivered', 'failed'];

export async function handleProviderEvent(eventId: string | null, ev: ProviderEvent): Promise<{ matched: boolean; duplicate: boolean }> {
  const msgId = ev.data?.email_id?.trim();
  if (!msgId) return { matched: false, duplicate: false };

  const job = await pool.query<{ id: string; message_id: string }>(
    'SELECT id, message_id FROM ec_send_jobs WHERE provider_message_id = $1', [msgId]);
  if (!job.rows[0]) return { matched: false, duplicate: false };

  const ins = await pool.query(
    `INSERT INTO ec_delivery_events (event_id, provider_message_id, event_type, payload) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (event_id) DO NOTHING RETURNING id`,
    [eventId, msgId, ev.type, JSON.stringify(ev)]);
  if (eventId && ins.rowCount === 0) return { matched: true, duplicate: true };

  const to = (Array.isArray(ev.data?.to) ? ev.data!.to : ev.data?.to ? [ev.data.to] : []).map(s => String(s).toLowerCase());
  const filter = to.length ? 'AND lower(email) = ANY($3::text[])' : '';
  const base = [Number(job.rows[0].id)];
  const run = async (status: string, from: string[], reason?: string) => {
    const params: unknown[] = to.length ? [base[0], from, to, status, reason ?? null] : [base[0], from, status, reason ?? null];
    const sql = to.length
      ? `UPDATE ec_message_recipients SET status=$4, error_message=COALESCE($5, error_message),
                delivered_at = CASE WHEN $4='delivered' THEN NOW() ELSE delivered_at END,
                failed_at = CASE WHEN $4 <> 'delivered' THEN NOW() ELSE failed_at END, updated_at=NOW()
          WHERE job_id=$1 AND status = ANY($2::text[]) ${filter}`
      : `UPDATE ec_message_recipients SET status=$3, error_message=COALESCE($4, error_message),
                delivered_at = CASE WHEN $3='delivered' THEN NOW() ELSE delivered_at END,
                failed_at = CASE WHEN $3 <> 'delivered' THEN NOW() ELSE failed_at END, updated_at=NOW()
          WHERE job_id=$1 AND status = ANY($2::text[])`;
    await pool.query(sql, params);
  };

  switch (ev.type) {
    case 'email.delivered': await run('delivered', DELIVERED_FROM); break;
    case 'email.bounced': await run('bounced', BAD_FROM, ev.data?.bounce?.message ?? 'Bounced'); break;
    case 'email.complained': await run('complained', BAD_FROM, 'Marked as spam by the recipient'); break;
    case 'email.suppressed': await run('suppressed', BAD_FROM, ev.data?.reason ?? 'Suppressed by the provider'); break;
    case 'email.failed': await run('failed', ['queued', 'sending', 'sent'], ev.data?.failed?.reason ?? ev.data?.reason ?? 'Failed'); break;
    default: break; // sent / delivery_delayed / opened / clicked: recorded only
  }
  await refreshMessageStatus(job.rows[0].message_id);
  return { matched: true, duplicate: false };
}

export { broadcastBudgetRemaining };

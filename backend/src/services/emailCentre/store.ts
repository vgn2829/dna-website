// Persistence for the Email Centre: drafts, activity reads, templates, saved
// groups, attachments and the audit log. Sending/queue logic is in service.ts.

import crypto from 'crypto';
import { pool } from '../../db/client';
import { MAIL_FROM } from '../mailer';
import { EmailCentreError, LIMITS, type MessagePayload } from './service';
import { isValidEmail, type GroupFilter } from './recipients';
import { SEED_TEMPLATES } from './templateSeeds';
import type { DocNode, SubjectConfig } from './engine';

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export async function audit(actor: string, action: string, entityType: string | null, entityId: string | null, details: unknown = {}): Promise<void> {
  await pool.query(
    'INSERT INTO ec_audit_logs (actor, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [actor, action, entityType, entityId, JSON.stringify(details)]);
}

// ── Drafts ──────────────────────────────────────────────────────────────────
export type DraftPayload = Partial<Omit<MessagePayload, 'attachmentIds'>> & { title?: string | null };

const EMPTY_DOC: DocNode = { type: 'doc', content: [{ type: 'paragraph' }] };

function splitDraft(p: DraftPayload) {
  return {
    mode: p.mode ?? 'individual',
    title: p.title ?? null,
    subject: (p.subject ?? { default: '' }) as SubjectConfig,
    doc: (p.doc ?? EMPTY_DOC) as DocNode,
    settings: {
      cc: p.cc ?? [], bcc: p.bcc ?? [], sharedData: p.sharedData ?? {}, fallbacks: p.fallbacks ?? {},
      eventId: p.eventId ?? null, shell: p.shell ?? 'dna',
    },
    recipientInput: { recipients: p.recipients ?? [], groups: p.groups ?? [] },
    templateId: p.templateId ?? null,
    templateVersion: p.templateVersion ?? null,
  };
}

const hashOf = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

export async function createDraft(p: DraftPayload, actor = 'admin'): Promise<{ id: string; revision: number; updatedAt: string }> {
  const d = splitDraft(p);
  const draftId = id('msg');
  const r = await pool.query<{ updated_at: string }>(
    `INSERT INTO ec_messages (id, status, mode, title, subject_config, doc, settings, recipient_input, template_id, template_version, content_hash, created_by)
     VALUES ($1,'draft',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11) RETURNING updated_at`,
    [draftId, d.mode, d.title, JSON.stringify(d.subject), JSON.stringify(d.doc), JSON.stringify(d.settings),
      JSON.stringify(d.recipientInput), d.templateId, d.templateVersion, hashOf(d), actor]);
  return { id: draftId, revision: 0, updatedAt: r.rows[0].updated_at };
}

/**
 * Autosave. Skips the write entirely when nothing changed (autosave fires on
 * a debounce, so identical saves are common) and refuses to touch a message
 * that has already been sent — autosave can never trigger or alter a send.
 */
export async function updateDraft(draftId: string, p: DraftPayload, baseRevision?: number): Promise<{ revision: number; updatedAt: string; unchanged: boolean }> {
  const cur = await pool.query<{ status: string; revision: number; content_hash: string | null; updated_at: string }>(
    'SELECT status, revision, content_hash, updated_at FROM ec_messages WHERE id=$1', [draftId]);
  const row = cur.rows[0];
  if (!row) throw new EmailCentreError('Draft not found', 404);
  if (row.status !== 'draft') throw new EmailCentreError('This message has already been sent', 409);
  if (baseRevision !== undefined && baseRevision !== row.revision) {
    throw new EmailCentreError('This draft was changed elsewhere', 409, { revision: row.revision });
  }
  const d = splitDraft(p);
  const h = hashOf(d);
  if (h === row.content_hash) return { revision: row.revision, updatedAt: row.updated_at, unchanged: true };
  const r = await pool.query<{ revision: number; updated_at: string }>(
    `UPDATE ec_messages SET mode=$2, title=$3, subject_config=$4::jsonb, doc=$5::jsonb, settings=$6::jsonb, recipient_input=$7::jsonb,
            template_id=$8, template_version=$9, content_hash=$10, revision=revision+1, updated_at=NOW()
      WHERE id=$1 AND status='draft' RETURNING revision, updated_at`,
    [draftId, d.mode, d.title, JSON.stringify(d.subject), JSON.stringify(d.doc), JSON.stringify(d.settings),
      JSON.stringify(d.recipientInput), d.templateId, d.templateVersion, h]);
  if (!r.rows[0]) throw new EmailCentreError('This message has already been sent', 409);
  return { revision: r.rows[0].revision, updatedAt: r.rows[0].updated_at, unchanged: false };
}

export async function getDraft(draftId: string) {
  const r = await pool.query(
    `SELECT id, status, mode, title, subject_config, doc, settings, recipient_input, template_id, template_version, revision, updated_at
       FROM ec_messages WHERE id=$1`, [draftId]);
  const m = r.rows[0];
  if (!m) throw new EmailCentreError('Draft not found', 404);
  const atts = await listAttachments(draftId);
  return {
    id: m.id as string, status: m.status as string, revision: m.revision as number, updatedAt: m.updated_at as string,
    payload: {
      mode: m.mode, title: m.title, subject: m.subject_config, doc: m.doc,
      recipients: m.recipient_input.recipients ?? [], groups: m.recipient_input.groups ?? [],
      cc: m.settings.cc ?? [], bcc: m.settings.bcc ?? [], sharedData: m.settings.sharedData ?? {}, fallbacks: m.settings.fallbacks ?? {},
      eventId: m.settings.eventId ?? null, shell: m.settings.shell ?? 'dna',
      templateId: m.template_id, templateVersion: m.template_version,
    },
    attachments: atts,
  };
}

export async function listDrafts() {
  const r = await pool.query(
    `SELECT id, mode, title, subject_config->>'default' AS subject, updated_at,
            jsonb_array_length(COALESCE(recipient_input->'recipients','[]'::jsonb)) AS recipient_count
       FROM ec_messages WHERE status='draft' ORDER BY updated_at DESC LIMIT 50`);
  return r.rows.map(x => ({ id: x.id as string, mode: x.mode as string, title: x.title as string | null, subject: (x.subject as string) ?? '', updatedAt: x.updated_at as string, recipientCount: Number(x.recipient_count) }));
}

export async function deleteDraft(draftId: string, actor = 'admin'): Promise<boolean> {
  const r = await pool.query(`DELETE FROM ec_messages WHERE id=$1 AND status='draft'`, [draftId]);
  if ((r.rowCount ?? 0) > 0) await audit(actor, 'delete_draft', 'message', draftId);
  return (r.rowCount ?? 0) > 0;
}

// ── Attachments ─────────────────────────────────────────────────────────────
const ALLOWED: Record<string, string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], gif: ['image/gif'], webp: ['image/webp'],
  txt: ['text/plain'], csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  zip: ['application/zip', 'application/x-zip-compressed'],
};
const INLINE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
export const ATTACHMENT_ACCEPT = Object.keys(ALLOWED).map(e => `.${e}`).join(',');

function sniffOk(ext: string, buf: Buffer): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  switch (ext) {
    case 'pdf': return starts(0x25, 0x50, 0x44, 0x46);
    case 'png': return starts(0x89, 0x50, 0x4e, 0x47);
    case 'jpg': case 'jpeg': return starts(0xff, 0xd8, 0xff);
    case 'gif': return starts(0x47, 0x49, 0x46, 0x38);
    case 'webp': return buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
    case 'zip': case 'docx': case 'xlsx': case 'pptx': return starts(0x50, 0x4b);
    case 'doc': case 'xls': case 'ppt': return starts(0xd0, 0xcf, 0x11, 0xe0);
    default: return true;
  }
}

export interface AttachmentRow { id: string; filename: string; mimeType: string; sizeBytes: number; inline: boolean }

export async function listAttachments(messageId: string): Promise<AttachmentRow[]> {
  const r = await pool.query<{ id: string; filename: string; mime_type: string; size_bytes: number; inline: boolean }>(
    'SELECT id, filename, mime_type, size_bytes, inline FROM ec_attachments WHERE message_id=$1 ORDER BY created_at', [messageId]);
  return r.rows.map(x => ({ id: x.id, filename: x.filename, mimeType: x.mime_type, sizeBytes: x.size_bytes, inline: x.inline }));
}

export async function addAttachment(messageId: string, file: { originalname: string; mimetype: string; buffer: Buffer }, inline: boolean): Promise<AttachmentRow> {
  const m = await pool.query<{ status: string }>('SELECT status FROM ec_messages WHERE id=$1', [messageId]);
  if (!m.rows[0]) throw new EmailCentreError('Draft not found — save the draft first', 404);
  if (m.rows[0].status !== 'draft') throw new EmailCentreError('This message has already been sent', 409);

  const filename = file.originalname.replace(/[\\/\0\r\n]/g, '_').slice(-150) || 'attachment';
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (!ALLOWED[ext]) throw new EmailCentreError(`".${ext}" files can't be attached. Allowed: ${Object.keys(ALLOWED).join(', ')}`, 400);
  if (!sniffOk(ext, file.buffer)) throw new EmailCentreError('The file contents do not match its extension', 400);
  if (inline && !INLINE_EXT.has(ext)) throw new EmailCentreError('Only images can be inserted into the email body', 400);
  if (file.buffer.length === 0) throw new EmailCentreError('The file is empty', 400);
  if (file.buffer.length > LIMITS.maxAttachmentBytes) throw new EmailCentreError(`File exceeds the ${LIMITS.maxAttachmentBytes / 1048576} MB limit`, 413);

  const total = await pool.query<{ s: string }>('SELECT COALESCE(SUM(size_bytes),0) AS s FROM ec_attachments WHERE message_id=$1', [messageId]);
  if (parseInt(total.rows[0].s, 10) + file.buffer.length > LIMITS.maxTotalAttachmentBytes) {
    throw new EmailCentreError(`Attachments would exceed ${LIMITS.maxTotalAttachmentBytes / 1048576} MB for this message`, 413);
  }
  const attId = id('att');
  await pool.query(
    'INSERT INTO ec_attachments (id, message_id, filename, mime_type, size_bytes, inline, content) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [attId, messageId, filename, ALLOWED[ext][0], file.buffer.length, inline, file.buffer]);
  return { id: attId, filename, mimeType: ALLOWED[ext][0], sizeBytes: file.buffer.length, inline };
}

export async function removeAttachment(attId: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM ec_attachments a USING ec_messages m WHERE a.id=$1 AND m.id=a.message_id AND m.status='draft'`, [attId]);
  return (r.rowCount ?? 0) > 0;
}

// ── Activity ────────────────────────────────────────────────────────────────
export async function listActivity(opts: { limit?: number; offset?: number; status?: string }) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const params: unknown[] = [limit, Math.max(opts.offset ?? 0, 0)];
  let filter = '';
  if (opts.status && ['queued', 'sending', 'completed', 'failed', 'cancelled'].includes(opts.status)) { params.push(opts.status); filter = `AND m.status = $${params.length}`; }
  const r = await pool.query(
    `SELECT m.id, m.status, m.mode, m.subject_config->>'default' AS subject, m.created_by, m.created_at, m.queued_at, m.completed_at,
            COUNT(r.*) FILTER (WHERE r.status <> 'excluded') AS total,
            COUNT(r.*) FILTER (WHERE r.status = 'queued') AS queued,
            COUNT(r.*) FILTER (WHERE r.status = 'sending') AS sending,
            COUNT(r.*) FILTER (WHERE r.status = 'sent') AS sent,
            COUNT(r.*) FILTER (WHERE r.status = 'delivered') AS delivered,
            COUNT(r.*) FILTER (WHERE r.status IN ('bounced','suppressed','complained')) AS bounced,
            COUNT(r.*) FILTER (WHERE r.status = 'failed') AS failed,
            COUNT(r.*) FILTER (WHERE r.status = 'cancelled') AS cancelled,
            COUNT(r.*) FILTER (WHERE r.status = 'excluded') AS excluded
       FROM ec_messages m LEFT JOIN ec_message_recipients r ON r.message_id = m.id
      WHERE m.status <> 'draft' ${filter}
      GROUP BY m.id ORDER BY m.created_at DESC LIMIT $1 OFFSET $2`, params);
  const n = (v: unknown) => Number(v ?? 0);
  return r.rows.map(x => ({
    id: x.id as string, status: x.status as string, mode: x.mode as string, subject: (x.subject as string) ?? '',
    sender: MAIL_FROM, createdBy: x.created_by as string, createdAt: x.created_at as string, completedAt: x.completed_at as string | null,
    counts: { total: n(x.total), queued: n(x.queued), sending: n(x.sending), sent: n(x.sent), delivered: n(x.delivered), bounced: n(x.bounced), failed: n(x.failed), cancelled: n(x.cancelled), excluded: n(x.excluded) },
  }));
}

export async function getActivity(messageId: string) {
  const m = await pool.query(
    `SELECT id, status, mode, subject_config, settings, created_by, created_at, queued_at, completed_at, template_id, template_version
       FROM ec_messages WHERE id=$1 AND status <> 'draft'`, [messageId]);
  const msg = m.rows[0];
  if (!msg) throw new EmailCentreError('Message not found', 404);
  const recips = await pool.query(
    `SELECT r.id, r.position, r.email, r.display_name, r.source, r.student_roll, r.validation, r.validation_note, r.status, r.error_message,
            r.delivered_at, r.failed_at, r.group_ref, j.provider_message_id, j.attempts, j.error_kind, j.status AS job_status,
            j.rendered_subject
       FROM ec_message_recipients r LEFT JOIN ec_send_jobs j ON j.id = r.job_id
      WHERE r.message_id=$1 ORDER BY r.position`, [messageId]);
  const attachments = await listAttachments(messageId);
  const events = await pool.query(
    `SELECT e.event_type, e.created_at, e.provider_message_id FROM ec_delivery_events e
      WHERE e.provider_message_id IN (SELECT provider_message_id FROM ec_send_jobs WHERE message_id=$1 AND provider_message_id IS NOT NULL)
      ORDER BY e.created_at DESC LIMIT 50`, [messageId]);
  return {
    id: msg.id as string, status: msg.status as string, mode: msg.mode as string, subject: msg.subject_config as SubjectConfig,
    sender: MAIL_FROM, createdBy: msg.created_by as string, createdAt: msg.created_at as string, completedAt: msg.completed_at as string | null,
    templateId: msg.template_id as string | null, templateVersion: msg.template_version as number | null,
    cc: (msg.settings.cc ?? []) as string[], bcc: (msg.settings.bcc ?? []) as string[],
    attachments,
    recipients: recips.rows.map(x => ({
      id: Number(x.id), position: x.position as number, email: x.email as string, name: x.display_name as string | null, source: x.source as string,
      studentRoll: x.student_roll as string | null, validation: x.validation as string, note: x.validation_note as string | null,
      status: x.status as string, error: x.error_message as string | null, errorKind: x.error_kind as string | null,
      providerMessageId: x.provider_message_id as string | null, attempts: Number(x.attempts ?? 0), subject: x.rendered_subject as string | null,
      deliveredAt: x.delivered_at as string | null, failedAt: x.failed_at as string | null,
      retryable: x.status === 'failed',
    })),
    events: events.rows.map(e => ({ type: e.event_type as string, at: e.created_at as string })),
  };
}

// ── Templates ───────────────────────────────────────────────────────────────
export interface TemplateBody {
  mode: 'normal' | 'individual';
  subject: SubjectConfig;
  doc: DocNode;
  settings: { sharedData?: Record<string, string>; fallbacks?: Record<string, string>; shell?: 'dna' | 'plain' };
}

export async function seedSystemTemplates(): Promise<void> {
  for (const s of SEED_TEMPLATES) {
    const ins = await pool.query(
      `INSERT INTO ec_templates (id, name, description, category, is_system) VALUES ($1,$2,$3,$4,true) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [s.id, s.name, s.description, s.category]);
    if (ins.rowCount) {
      await pool.query(
        `INSERT INTO ec_template_versions (template_id, version, mode, subject_config, doc, settings) VALUES ($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb)`,
        [s.id, s.mode, JSON.stringify(s.subject), JSON.stringify(s.doc), JSON.stringify(s.settings)]);
    }
  }
}

export async function listTemplates(includeArchived = false) {
  const r = await pool.query(
    `SELECT t.id, t.name, t.description, t.category, t.is_system, t.archived, t.current_version, t.updated_at,
            v.subject_config->>'default' AS subject, v.mode
       FROM ec_templates t JOIN ec_template_versions v ON v.template_id=t.id AND v.version=t.current_version
      ${includeArchived ? '' : 'WHERE NOT t.archived'} ORDER BY t.is_system DESC, t.name`);
  return r.rows.map(x => ({
    id: x.id as string, name: x.name as string, description: x.description as string | null, category: x.category as string,
    isSystem: x.is_system as boolean, archived: x.archived as boolean, version: x.current_version as number,
    updatedAt: x.updated_at as string, subject: (x.subject as string) ?? '', mode: x.mode as string,
  }));
}

export async function getTemplate(tid: string, version?: number) {
  const t = await pool.query('SELECT id, name, description, category, is_system, archived, current_version FROM ec_templates WHERE id=$1', [tid]);
  if (!t.rows[0]) throw new EmailCentreError('Template not found', 404);
  const ver = version ?? t.rows[0].current_version;
  const v = await pool.query('SELECT version, mode, subject_config, doc, settings, created_at FROM ec_template_versions WHERE template_id=$1 AND version=$2', [tid, ver]);
  if (!v.rows[0]) throw new EmailCentreError('Template version not found', 404);
  const versions = await pool.query('SELECT version, created_at FROM ec_template_versions WHERE template_id=$1 ORDER BY version DESC', [tid]);
  return {
    id: t.rows[0].id as string, name: t.rows[0].name as string, description: t.rows[0].description as string | null,
    category: t.rows[0].category as string, isSystem: t.rows[0].is_system as boolean, archived: t.rows[0].archived as boolean,
    currentVersion: t.rows[0].current_version as number, version: v.rows[0].version as number,
    body: { mode: v.rows[0].mode, subject: v.rows[0].subject_config, doc: v.rows[0].doc, settings: v.rows[0].settings } as TemplateBody,
    versions: versions.rows.map(x => ({ version: x.version as number, createdAt: x.created_at as string })),
  };
}

export async function createTemplate(meta: { name: string; description?: string | null; category?: string }, body: TemplateBody, actor = 'admin'): Promise<string> {
  const tid = id('tpl');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO ec_templates (id, name, description, category) VALUES ($1,$2,$3,$4)', [tid, meta.name, meta.description ?? null, meta.category ?? 'custom']);
    await client.query('INSERT INTO ec_template_versions (template_id, version, mode, subject_config, doc, settings) VALUES ($1,1,$2,$3::jsonb,$4::jsonb,$5::jsonb)',
      [tid, body.mode, JSON.stringify(body.subject), JSON.stringify(body.doc), JSON.stringify(body.settings ?? {})]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  await audit(actor, 'create_template', 'template', tid);
  return tid;
}

/** Editing never mutates an existing version: it appends version N+1. */
export async function saveTemplateVersion(tid: string, meta: { name?: string; description?: string | null }, body: TemplateBody, actor = 'admin'): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query<{ current_version: number }>('SELECT current_version FROM ec_templates WHERE id=$1 FOR UPDATE', [tid]);
    if (!t.rows[0]) throw new EmailCentreError('Template not found', 404);
    const next = t.rows[0].current_version + 1;
    await client.query('INSERT INTO ec_template_versions (template_id, version, mode, subject_config, doc, settings) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)',
      [tid, next, body.mode, JSON.stringify(body.subject), JSON.stringify(body.doc), JSON.stringify(body.settings ?? {})]);
    await client.query('UPDATE ec_templates SET current_version=$2, name=COALESCE($3,name), description=COALESCE($4,description), updated_at=NOW() WHERE id=$1',
      [tid, next, meta.name ?? null, meta.description ?? null]);
    await client.query('COMMIT');
    await audit(actor, 'edit_template', 'template', tid, { version: next });
    return next;
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
}

export async function duplicateTemplate(tid: string, actor = 'admin'): Promise<string> {
  const src = await getTemplate(tid);
  return createTemplate({ name: `${src.name} (copy)`, description: src.description, category: src.category }, src.body, actor);
}

export async function setTemplateArchived(tid: string, archived: boolean, actor = 'admin'): Promise<void> {
  const r = await pool.query('UPDATE ec_templates SET archived=$2, updated_at=NOW() WHERE id=$1', [tid, archived]);
  if (!r.rowCount) throw new EmailCentreError('Template not found', 404);
  await audit(actor, archived ? 'archive_template' : 'unarchive_template', 'template', tid);
}

// ── Saved groups ────────────────────────────────────────────────────────────
export interface GroupMemberInput { email: string; name?: string | null; data?: Record<string, string> }

export async function createGroup(g: { name: string; description?: string | null; kind: 'static' | 'dynamic'; filter?: GroupFilter | null; members?: GroupMemberInput[] }, actor = 'admin'): Promise<string> {
  if (g.kind === 'dynamic' && !g.filter) throw new EmailCentreError('A dynamic group needs a filter', 400);
  const gid = id('grp');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO ec_groups (id, name, description, kind, filter, created_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6)',
      [gid, g.name, g.description ?? null, g.kind, g.filter ? JSON.stringify(g.filter) : null, actor]);
    if (g.kind === 'static') await writeMembers(client, gid, g.members ?? []);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  await audit(actor, 'create_group', 'group', gid, { name: g.name, kind: g.kind });
  return gid;
}

async function writeMembers(client: { query: (q: string, p?: unknown[]) => Promise<unknown> }, gid: string, members: GroupMemberInput[]) {
  const seen = new Set<string>(); const clean: GroupMemberInput[] = [];
  for (const m of members) {
    const e = m.email.trim();
    if (!isValidEmail(e)) throw new EmailCentreError(`"${e}" is not a valid email address`, 400);
    if (seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase()); clean.push({ ...m, email: e });
  }
  if (clean.length === 0) return;
  await client.query(
    `INSERT INTO ec_group_members (group_id, email, display_name, data)
     SELECT $1, t.email, t.name, t.data::jsonb FROM unnest($2::text[], $3::text[], $4::text[]) AS t(email, name, data)`,
    [gid, clean.map(m => m.email), clean.map(m => m.name?.trim() || null), clean.map(m => JSON.stringify(m.data ?? {}))]);
}

export async function updateGroup(gid: string, g: { name?: string; description?: string | null; filter?: GroupFilter | null; members?: GroupMemberInput[] }, actor = 'admin'): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ kind: string }>('SELECT kind FROM ec_groups WHERE id=$1 FOR UPDATE', [gid]);
    if (!cur.rows[0]) throw new EmailCentreError('Group not found', 404);
    await client.query('UPDATE ec_groups SET name=COALESCE($2,name), description=COALESCE($3,description), filter=COALESCE($4::jsonb,filter), updated_at=NOW() WHERE id=$1',
      [gid, g.name ?? null, g.description ?? null, g.filter ? JSON.stringify(g.filter) : null]);
    if (g.members && cur.rows[0].kind === 'static') {
      await client.query('DELETE FROM ec_group_members WHERE group_id=$1', [gid]);
      await writeMembers(client, gid, g.members);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  await audit(actor, 'update_group', 'group', gid);
}

export async function deleteGroup(gid: string, actor = 'admin'): Promise<boolean> {
  const r = await pool.query('DELETE FROM ec_groups WHERE id=$1', [gid]);
  if (r.rowCount) await audit(actor, 'delete_group', 'group', gid);
  return (r.rowCount ?? 0) > 0;
}

export async function getGroupMembers(gid: string) {
  const g = await pool.query('SELECT id, name, description, kind, filter FROM ec_groups WHERE id=$1', [gid]);
  if (!g.rows[0]) throw new EmailCentreError('Group not found', 404);
  const m = await pool.query('SELECT email, display_name, data FROM ec_group_members WHERE group_id=$1 ORDER BY added_at', [gid]);
  return { ...g.rows[0], members: m.rows.map(x => ({ email: x.email as string, name: x.display_name as string | null, data: x.data as Record<string, string> })) };
}

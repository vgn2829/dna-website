// Email Centre: typed API client + the pure logic the UI is built on.
// Everything that decides what is sent (resolution, rendering, validation,
// quota) lives on the server; this file only shapes requests and view state.

import { API_BASE, getAdminToken, clearAdminToken } from './api';

// ── Shared types (mirror backend/src/services/emailCentre) ─────────────────
export type Mode = 'normal' | 'individual';
export type Shell = 'dna' | 'plain';
export type RecipientSource = 'manual' | 'student' | 'group' | 'csv';
export type Operator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty' | 'gt' | 'lt' | 'one_of';

export interface Rule { field: string; op: Operator; value?: string | string[] }
export interface Condition { match: 'all' | 'any'; rules: Rule[] }
export interface SubjectConfig { default: string; variants?: { when: Condition; subject: string }[] }
export interface DocNode {
  type: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface VariableDef { name: string; category: 'Recipient' | 'Student' | 'Event' | 'Selection'; label: string; sample: string; scope: 'recipient' | 'shared' }

export interface Meta {
  variables: VariableDef[]; operators: Operator[];
  limits: { maxRecipients: number; maxNormalRecipients: number; maxIndividualCopies: number; largeSend: number; maxAttachmentBytes: number; maxTotalAttachmentBytes: number };
  attachmentAccept: string; sender: string; replyTo: string; providerLive: boolean; broadcastBudget: number; batches: string[];
}

export interface RecipientRow {
  key: string;
  email: string;
  name: string;
  source: RecipientSource;
  matchedStudent?: boolean;
  data: Record<string, string>;
  excluded?: boolean;
  groupRef?: { id: string; name: string } | null;
}

export interface GroupRef { id: string; name: string }

export interface AttachmentRow { id: string; filename: string; mimeType: string; sizeBytes: number; inline: boolean }

export interface ComposerState {
  draftId: string | null;
  revision: number;
  mode: Mode;
  subject: SubjectConfig;
  doc: DocNode;
  recipients: RecipientRow[];
  groups: GroupRef[];
  cc: string[];
  bcc: string[];
  sharedData: Record<string, string>;
  fallbacks: Record<string, string>;
  eventId: string | null;
  shell: Shell;
  templateId: string | null;
  templateVersion: number | null;
  attachments: AttachmentRow[];
}

export const EMPTY_DOC: DocNode = { type: 'doc', content: [{ type: 'paragraph' }] };

export function newComposer(): ComposerState {
  return {
    draftId: null, revision: 0, mode: 'individual', subject: { default: '' }, doc: EMPTY_DOC,
    recipients: [], groups: [], cc: [], bcc: [], sharedData: {}, fallbacks: {}, eventId: null,
    shell: 'dna', templateId: null, templateVersion: null, attachments: [],
  };
}

// ── API payloads ───────────────────────────────────────────────────────────
export interface ApiPayload {
  mode: Mode; subject: SubjectConfig; doc: DocNode;
  recipients: { email: string; name: string | null; source: RecipientSource; data: Record<string, string>; excluded?: boolean; groupRef?: GroupRef | null }[];
  groups: string[]; cc: string[]; bcc: string[]; sharedData: Record<string, string>; fallbacks: Record<string, string>;
  eventId: string | null; shell: Shell; attachmentIds: string[]; templateId: string | null; templateVersion: number | null;
}

/** What the server receives: UI-only fields (keys, flags) are stripped. */
export function buildPayload(s: ComposerState): ApiPayload {
  return {
    mode: s.mode,
    subject: s.subject,
    doc: s.doc,
    recipients: s.recipients.map(r => ({
      email: r.email.trim(), name: r.name.trim() || null, source: r.source,
      data: Object.fromEntries(Object.entries(r.data).filter(([, v]) => v !== undefined)),
      ...(r.excluded ? { excluded: true } : {}),
      ...(r.groupRef ? { groupRef: r.groupRef } : {}),
    })),
    groups: s.groups.map(g => g.id),
    cc: s.cc, bcc: s.bcc,
    sharedData: cleanMap(s.sharedData), fallbacks: cleanMap(s.fallbacks),
    eventId: s.eventId, shell: s.shell,
    attachmentIds: s.attachments.map(a => a.id),
    templateId: s.templateId, templateVersion: s.templateVersion,
  };
}

/** Draft = the same payload minus attachment ids (those are owned by the draft server-side). */
export function buildDraftPayload(s: ComposerState): Omit<ApiPayload, 'attachmentIds'> {
  const { attachmentIds: _drop, ...rest } = buildPayload(s);
  void _drop;
  return rest;
}

function cleanMap(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) if (k.trim()) out[k.trim()] = v;
  return out;
}

// ── Pure helpers ───────────────────────────────────────────────────────────
/** Same rule as the server's normalizeKey: "Team Name" → team_name. */
export function normalizeKeyClient(raw: string): string {
  let k = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (k && !/^[a-z]/.test(k)) k = `f_${k}`;
  return k.slice(0, 41);
}

let keySeq = 0;
export const newKey = () => `r${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function mergeRecipients(existing: RecipientRow[], incoming: Omit<RecipientRow, 'key'>[]): { rows: RecipientRow[]; added: number; skipped: number } {
  const seen = new Set(existing.map(r => r.email.trim().toLowerCase()));
  const rows = [...existing]; let added = 0; let skipped = 0;
  for (const r of incoming) {
    const k = r.email.trim().toLowerCase();
    if (!k || seen.has(k)) { skipped++; continue; }
    seen.add(k); added++;
    rows.push({ ...r, key: newKey() });
  }
  return { rows, added, skipped };
}

/** Marks/unmarks a person as excluded. For people who only exist via a group, an explicit row is added. */
export function setExcluded(rows: RecipientRow[], email: string, excluded: boolean, base?: Partial<RecipientRow>): RecipientRow[] {
  const k = email.trim().toLowerCase();
  const i = rows.findIndex(r => r.email.trim().toLowerCase() === k);
  if (i >= 0) return rows.map((r, j) => (j === i ? { ...r, excluded } : r));
  if (!excluded) return rows;
  return [...rows, { key: newKey(), email, name: '', source: 'group', data: {}, ...base, excluded: true }];
}

/** Edits a person's name / custom fields for this communication only (never the student record). */
export function overrideRecipient(rows: RecipientRow[], email: string, patch: { name?: string; data?: Record<string, string> }, base?: Partial<RecipientRow>): RecipientRow[] {
  const k = email.trim().toLowerCase();
  const i = rows.findIndex(r => r.email.trim().toLowerCase() === k);
  if (i >= 0) {
    return rows.map((r, j) => (j === i ? { ...r, ...(patch.name !== undefined ? { name: patch.name } : {}), data: { ...r.data, ...(patch.data ?? {}) } } : r));
  }
  return [...rows, { key: newKey(), email, name: patch.name ?? '', source: 'manual', data: patch.data ?? {}, ...base }];
}

export const OPERATOR_LABELS: Record<Operator, string> = {
  equals: 'equals', not_equals: 'does not equal', contains: 'contains', not_contains: 'does not contain',
  is_empty: 'is empty', is_not_empty: 'is not empty', gt: 'is greater than', lt: 'is less than', one_of: 'is one of',
};

export type FieldType = 'text' | 'number';

/** A field is numeric only if every non-empty value in the audience is a number. */
export function fieldType(field: string, rows: RecipientRow[]): FieldType {
  const vals = rows.map(r => (r.data[field] ?? '').trim()).filter(Boolean);
  return vals.length > 0 && vals.every(v => Number.isFinite(Number(v))) ? 'number' : 'text';
}

/** Only operators that make sense for the field's data type (greater/less than are numeric-only). */
export function operatorsFor(type: FieldType, all: Operator[]): Operator[] {
  return all.filter(op => type === 'number' || (op !== 'gt' && op !== 'lt'));
}

export const needsValue = (op: Operator) => op !== 'is_empty' && op !== 'is_not_empty';

export interface VariableOption { name: string; label: string; category: string; sample?: string; custom?: boolean }

/** Variables worth offering for this message: built-ins that apply + custom fields actually present. */
export function availableVariables(meta: Meta | null, s: ComposerState): VariableOption[] {
  const out: VariableOption[] = [];
  const individual = s.mode === 'individual';
  const hasStudents = s.recipients.some(r => r.matchedStudent) || s.groups.length > 0;
  const seen = new Set<string>();
  for (const v of meta?.variables ?? []) {
    if (!individual && v.scope === 'recipient') continue; // one shared email: no per-person values
    if (v.category === 'Student' && v.name !== 'department' && !hasStudents && individual) {
      // roll number / batch exist only for matched students
      if (!s.recipients.some(r => r.data[v.name])) continue;
    }
    if (v.name === 'department' && !s.recipients.some(r => r.data.department) && !s.sharedData.department) continue;
    out.push({ name: v.name, label: v.label, category: v.category, sample: v.sample });
    seen.add(v.name);
  }
  const custom = new Set<string>(Object.keys(s.sharedData));
  if (individual) for (const r of s.recipients) for (const k of Object.keys(r.data)) custom.add(k);
  for (const k of [...custom].sort()) if (!seen.has(k)) out.push({ name: k, label: k, category: 'Custom', custom: true });
  return out;
}

export function groupByCategory(opts: VariableOption[]): [string, VariableOption[]][] {
  const order = ['Recipient', 'Student', 'Event', 'Selection', 'Custom'];
  const map = new Map<string, VariableOption[]>();
  for (const o of opts) map.set(o.category, [...(map.get(o.category) ?? []), o]);
  return order.filter(c => map.has(c)).map(c => [c, map.get(c)!]);
}

export function describeCondition(c: Condition): string {
  return c.rules.map(r => `${r.field} ${OPERATOR_LABELS[r.op]}${needsValue(r.op) ? ` “${Array.isArray(r.value) ? r.value.join(', ') : r.value ?? ''}”` : ''}`)
    .join(c.match === 'all' ? ' and ' : ' or ');
}

export const newRule = (field = ''): Rule => ({ field, op: 'equals', value: '' });
export const newCondition = (field = ''): Condition => ({ match: 'all', rules: [newRule(field)] });

export function docIsEmpty(doc: DocNode): boolean {
  const walk = (n: DocNode): boolean => {
    if (n.type === 'text') return !(n.text ?? '').trim();
    if (n.type === 'image' || n.type === 'button' || n.type === 'conditionalBlock') return false;
    return (n.content ?? []).every(walk);
  };
  return walk(doc);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function firstName(name: string): string { return name.trim().split(/\s+/)[0] ?? ''; }

/** Client-side readiness hints (the server is authoritative; these only gate buttons). */
export function composerProblems(s: ComposerState): string[] {
  const p: string[] = [];
  if (!s.subject.default.trim()) p.push('Add a subject');
  if (docIsEmpty(s.doc)) p.push('Write the email body');
  if (s.recipients.filter(r => !r.excluded).length + s.groups.length === 0) p.push('Add at least one recipient');
  return p;
}

// ── Server response types ──────────────────────────────────────────────────
export type ItemState = 'valid' | 'missing_data' | 'invalid_email' | 'render_error' | 'excluded';
export interface Issue { code: string; severity: 'error' | 'warning'; message: string; variable?: string }

export interface PreparedItem {
  index: number; email: string; name: string | null; source: RecipientSource; matchedStudent: boolean; studentRoll: string | null;
  groupRef: GroupRef | null; state: ItemState; note: string | null; missing: string[]; data: Record<string, string | number | boolean | null>; issues: Issue[];
}

export interface SendPreview {
  mode: Mode;
  counts: { total: number; valid: number; invalid: number; excluded: number; missingData: number; renderError: number; messages: number; ccCount: number; bccCount: number; extraCopies: number; quotaCost: number };
  blockers: string[]; groupErrors: string[]; templateIssues: Issue[]; attachments: AttachmentRow[]; known: string[];
  quota: { budgetNow: number; cost: number; sendNow: number; deferred: number }; sender: string;
  requiresCountConfirmation: boolean; items: PreparedItem[];
}

export interface PreviewResult {
  ok: boolean; subject: string; html: string; text: string; issues: Issue[]; resolved: Record<string, string>; branches: string[];
  forLabel: string; recipient: { email: string; name: string | null; state: ItemState } | null; attachments: AttachmentRow[];
}

export interface StudentHit { rollNumber: string; name: string | null; email: string; batch: string; lastLogin: string | null }
export interface GroupSummary { id: string; name: string; description: string | null; kind: 'system' | 'dynamic' | 'static'; memberCount: number | null }

export interface CsvRow { rowNumber: number; email: string; name: string; data: Record<string, string>; status: 'ok' | 'invalid_email' | 'missing_email' | 'duplicate'; warnings: string[] }
export interface CsvMapping { email: string; name?: string | null; fields?: { column: string; key: string }[] }
export interface CsvPreview { headers: string[]; suggestedMapping: CsvMapping; rowCount: number; rows: CsvRow[]; summary: { ok: number; invalid: number; duplicates: number; withMissingValues: number } }

export type RecipientStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'suppressed' | 'complained' | 'failed' | 'cancelled' | 'excluded';
export type MessageStatus = 'draft' | 'queued' | 'sending' | 'completed' | 'failed' | 'cancelled';

export interface ActivityRow {
  id: string; status: MessageStatus; mode: Mode; subject: string; sender: string; createdBy: string; createdAt: string; completedAt: string | null;
  counts: { total: number; queued: number; sending: number; sent: number; delivered: number; bounced: number; failed: number; cancelled: number; excluded: number };
}

export interface ActivityDetail {
  id: string; status: MessageStatus; mode: Mode; subject: SubjectConfig; sender: string; createdBy: string; createdAt: string; completedAt: string | null;
  templateId: string | null; templateVersion: number | null; cc: string[]; bcc: string[]; attachments: AttachmentRow[];
  recipients: { id: number; position: number; email: string; name: string | null; source: string; studentRoll: string | null; validation: string; note: string | null; status: RecipientStatus; error: string | null; errorKind: string | null; providerMessageId: string | null; attempts: number; subject: string | null; deliveredAt: string | null; failedAt: string | null; retryable: boolean }[];
  events: { type: string; at: string }[];
}

export interface TemplateSummary { id: string; name: string; description: string | null; category: string; isSystem: boolean; archived: boolean; version: number; updatedAt: string; subject: string; mode: Mode }
export interface TemplateBody { mode: Mode; subject: SubjectConfig; doc: DocNode; settings: { sharedData?: Record<string, string>; fallbacks?: Record<string, string>; shell?: Shell } }
export interface TemplateDetail { id: string; name: string; description: string | null; category: string; isSystem: boolean; archived: boolean; currentVersion: number; version: number; body: TemplateBody; versions: { version: number; createdAt: string }[] }

export interface DraftSummary { id: string; mode: Mode; title: string | null; subject: string; updatedAt: string; recipientCount: number }

// ── Client ─────────────────────────────────────────────────────────────────
export class EcError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) { super(message); this.name = 'EcError'; }
  get blockers(): string[] { return Array.isArray(this.body.blockers) ? (this.body.blockers as string[]) : []; }
}

async function ec<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const tok = getAdminToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${API_BASE}/email${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401) { clearAdminToken(); throw new EcError('SESSION_EXPIRED', 401); }
  if (!res.ok) throw new EcError(String(data.error ?? res.statusText), res.status, data);
  return data as T;
}

export const emailApi = {
  meta: () => ec<Meta>('GET', '/meta'),
  searchStudents: (q: { q?: string; batch?: string; active?: boolean }) => {
    const p = new URLSearchParams();
    if (q.q) p.set('q', q.q); if (q.batch) p.set('batch', q.batch); if (q.active) p.set('active', '1');
    return ec<{ students: StudentHit[] }>('GET', `/recipients/search?${p}`);
  },
  parseEmails: (text: string) => ec<{ entries: { email: string; name: string | null; matchedStudent: boolean; student: { rollNumber: string; name: string | null; batch: string } | null }[]; invalid: string[] }>('POST', '/recipients/parse', { text }),
  groups: () => ec<{ groups: GroupSummary[] }>('GET', '/groups'),
  group: (id: string) => ec<{ id: string; name: string; description: string | null; kind: string; filter: unknown; members: { email: string; name: string | null; data: Record<string, string> }[] }>('GET', `/groups/${id}`),
  createGroup: (g: { name: string; description?: string; kind: 'static' | 'dynamic'; filter?: unknown; members?: { email: string; name?: string | null; data?: Record<string, string> }[] }) => ec<{ id: string }>('POST', '/groups', g),
  updateGroup: (id: string, g: { name?: string; members?: { email: string; name?: string | null; data?: Record<string, string> }[] }) => ec<{ success: boolean }>('PUT', `/groups/${id}`, g),
  deleteGroup: (id: string) => ec<{ success: boolean }>('DELETE', `/groups/${id}`),
  importPreview: (csv: string, mapping?: CsvMapping) => ec<CsvPreview>('POST', '/import/preview', { csv, mapping }),

  drafts: () => ec<{ drafts: DraftSummary[] }>('GET', '/drafts'),
  createDraft: (p: Omit<ApiPayload, 'attachmentIds'>) => ec<{ id: string; revision: number; updatedAt: string }>('POST', '/drafts', p),
  getDraft: (id: string) => ec<{ id: string; status: string; revision: number; updatedAt: string; payload: Omit<ApiPayload, 'attachmentIds'> & { title?: string | null }; attachments: AttachmentRow[] }>('GET', `/drafts/${id}`),
  saveDraft: (id: string, revision: number, payload: Omit<ApiPayload, 'attachmentIds'>) => ec<{ revision: number; updatedAt: string; unchanged: boolean }>('PATCH', `/drafts/${id}`, { revision, payload }),
  deleteDraft: (id: string) => ec<{ success: boolean }>('DELETE', `/drafts/${id}`),
  removeAttachment: (id: string) => ec<{ success: boolean }>('DELETE', `/attachments/${id}`),

  preview: (payload: ApiPayload, opts: { index?: number; useSample?: boolean } = {}) => ec<PreviewResult>('POST', '/preview', { payload, ...opts }),
  sendPreview: (payload: ApiPayload, draftId?: string | null) => ec<SendPreview>('POST', '/send/preview', { payload, draftId }),
  send: (payload: ApiPayload, o: { idempotencyKey: string; draftId?: string | null; confirmedCount?: number; acknowledgeCopies?: boolean }) =>
    ec<{ messageId: string; duplicate: boolean; status: string; messages: number; quotaCost: number }>('POST', '/send', { payload, ...o }),
  test: (payload: ApiPayload, o: { testEmail: string; recipientIndex?: number; useSample?: boolean }) =>
    ec<{ sentTo: string; subject: string; mock: boolean }>('POST', '/test', { payload, ...o }),

  activity: (status?: string) => ec<{ messages: ActivityRow[] }>('GET', `/activity${status ? `?status=${status}` : ''}`),
  activityDetail: (id: string) => ec<ActivityDetail>('GET', `/activity/${id}`),
  retry: (id: string) => ec<{ requeued: number; skipped: number }>('POST', `/activity/${id}/retry`),
  cancel: (id: string) => ec<{ cancelled: number }>('POST', `/activity/${id}/cancel`),

  templates: (archived = false) => ec<{ templates: TemplateSummary[] }>('GET', `/templates${archived ? '?archived=1' : ''}`),
  template: (id: string, version?: number) => ec<TemplateDetail>('GET', `/templates/${id}${version ? `?version=${version}` : ''}`),
  createTemplate: (name: string, description: string | null, body: TemplateBody) => ec<{ id: string }>('POST', '/templates', { name, description, body }),
  saveTemplate: (id: string, name: string, description: string | null, body: TemplateBody) => ec<{ version: number }>('PUT', `/templates/${id}`, { name, description, body }),
  duplicateTemplate: (id: string) => ec<{ id: string }>('POST', `/templates/${id}/duplicate`),
  archiveTemplate: (id: string, archived: boolean) => ec<{ success: boolean }>('POST', `/templates/${id}/${archived ? 'archive' : 'unarchive'}`),
};

/** Multipart upload with progress (fetch has no upload progress events). */
export function uploadAttachment(messageId: string, file: File, inline: boolean, onProgress: (pct: number) => void): Promise<AttachmentRow> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/email/attachments`);
    const tok = getAdminToken();
    if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new EcError('Network error while uploading', 0));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as unknown as AttachmentRow);
      else reject(new EcError(String(body.error ?? 'Upload failed'), xhr.status, body));
    };
    const fd = new FormData();
    fd.append('messageId', messageId);
    fd.append('inline', inline ? 'true' : 'false');
    fd.append('file', file);
    xhr.send(fd);
  });
}

/** Decide, from client-known fields only, whether a `sent` row may legitimately show as delivered. */
export const STATUS_LABEL: Record<RecipientStatus, string> = {
  queued: 'Queued', sending: 'Sending', sent: 'Sent (accepted)', delivered: 'Delivered', bounced: 'Bounced',
  suppressed: 'Suppressed', complained: 'Spam complaint', failed: 'Failed', cancelled: 'Cancelled', excluded: 'Excluded',
};
export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  draft: 'Draft', queued: 'Queued', sending: 'Sending', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
};

// ── Editor context helpers ─────────────────────────────────────────────────
/** Every variable name the server will accept for this message (drives the red "unknown variable" highlight). */
export function knownVariables(meta: Meta | null, s: ComposerState): Set<string> {
  const known = new Set<string>(Object.keys(s.sharedData).filter(Boolean));
  for (const v of meta?.variables ?? []) if (s.mode === 'individual' || v.scope === 'shared') known.add(v.name);
  if (s.mode === 'individual') for (const r of s.recipients) for (const k of Object.keys(r.data)) known.add(k);
  return known;
}

/** Fields offered in the condition builder: per-person fields only matter in Individual mode. */
export function conditionFields(meta: Meta | null, s: ComposerState): { name: string; label: string }[] {
  return availableVariables(meta, s).map(v => ({ name: v.name, label: v.label }));
}

export function distinctValues(field: string, rows: RecipientRow[], cap = 25): string[] {
  const out = new Set<string>();
  for (const r of rows) { const v = (r.data[field] ?? '').trim(); if (v) out.add(v); if (out.size >= cap) break; }
  return [...out].sort();
}

export function randomKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Draft payload from the server → composer state (adds UI keys). */
export function stateFromDraft(d: Awaited<ReturnType<typeof emailApi.getDraft>>): ComposerState {
  const p = d.payload;
  return {
    draftId: d.id, revision: d.revision, mode: p.mode, subject: p.subject ?? { default: '' }, doc: p.doc ?? EMPTY_DOC,
    recipients: (p.recipients ?? []).map(r => ({ key: newKey(), email: r.email, name: r.name ?? '', source: r.source, data: (r.data ?? {}) as Record<string, string>, excluded: r.excluded, groupRef: r.groupRef ?? null })),
    groups: ((p as { groups?: string[] }).groups ?? []).map(id => ({ id, name: id })), cc: p.cc ?? [], bcc: p.bcc ?? [], sharedData: p.sharedData ?? {}, fallbacks: p.fallbacks ?? {},
    eventId: p.eventId ?? null, shell: p.shell ?? 'dna', templateId: p.templateId ?? null, templateVersion: p.templateVersion ?? null,
    attachments: d.attachments,
  };
}

export function applyTemplate(s: ComposerState, t: TemplateDetail): ComposerState {
  return {
    ...s, mode: t.body.mode, subject: t.body.subject, doc: t.body.doc,
    sharedData: { ...s.sharedData, ...(t.body.settings.sharedData ?? {}) },
    fallbacks: { ...s.fallbacks, ...(t.body.settings.fallbacks ?? {}) },
    shell: t.body.settings.shell ?? s.shell, templateId: t.id, templateVersion: t.version,
  };
}

export function hasContent(s: ComposerState): boolean {
  return Boolean(s.subject.default.trim()) || !docIsEmpty(s.doc) || s.recipients.length > 0 || s.groups.length > 0 || s.cc.length > 0 || s.bcc.length > 0;
}

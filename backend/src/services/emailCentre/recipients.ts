// Recipient parsing, CSV import and resolution for the Email Centre.
//
// Resolution is always done on the server from the database: the client may
// suggest an email, a display-name override for THIS communication and
// custom fields, but student identity (roll number, batch, stored name) is
// looked up here and can't be spoofed. Student records are never written.

import { pool } from '../../db/client';
import { deriveBatch } from '../activityService';
import { KEY_RE, normalizeKey, firstNameOf, type RecipientData, type Scalar } from './engine';

export type RecipientSource = 'manual' | 'student' | 'group' | 'csv';

export interface RecipientInput {
  email: string;
  name?: string | null;
  source: RecipientSource;
  data?: Record<string, unknown>;
  excluded?: boolean;
  groupRef?: { id: string; name: string } | null;
}

export interface ResolvedRecipient {
  email: string;
  displayName: string | null;
  source: RecipientSource;
  studentRoll: string | null;
  matchedStudent: boolean;
  data: RecipientData;
  groupRef: { id: string; name: string } | null;
  /** Pre-render verdict. Rendering may further mark a recipient missing_data / render_error. */
  state: 'ok' | 'invalid_email' | 'excluded';
  note?: string;
}

// ── Email parsing ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isValidEmail(e: string): boolean {
  return e.length <= 254 && EMAIL_RE.test(e) && !e.includes('..');
}

/**
 * Parse pasted text: commas, semicolons, spaces and newlines separate
 * addresses; "Name <a@b.com>" keeps its name. Invalid tokens are returned
 * so the UI can show them instead of silently dropping them.
 */
export function parseEmailList(text: string): { entries: { email: string; name?: string }[]; invalid: string[] } {
  const entries: { email: string; name?: string }[] = [];
  const invalid: string[] = [];
  let rest = text;
  // One pass, in textual order, so chips keep the order the admin pasted. Quoted names may
  // contain commas ("Doe, Jane" <j@x.com>); unquoted names may not.
  rest = rest.replace(/"([^"]*)"\s*<([^<>\s]+)>|([^"<>,;\n]*?)\s*<([^<>\s]+)>/g,
    (_m, qName: string | undefined, qEmail: string | undefined, name: string | undefined, email: string | undefined) => {
      const e = (qEmail ?? email ?? '').trim();
      const n = (qName ?? name ?? '').trim();
      if (isValidEmail(e)) entries.push({ email: e, name: n || undefined });
      else invalid.push(e);
      return ' ';
    });
  for (const tok of rest.split(/[\s,;]+/)) {
    const t = tok.trim().replace(/^[<(]+|[>)]+$/g, '');
    if (!t) continue;
    if (isValidEmail(t)) entries.push({ email: t });
    else invalid.push(t);
  }
  return { entries, invalid };
}

// ── CSV ────────────────────────────────────────────────────────────────────
/** RFC 4180-style parser: quoted fields, escaped quotes, embedded newlines, CRLF, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface CsvMapping {
  email: string;
  name?: string | null;
  /** Extra columns exposed as custom variables: column header → variable key. */
  fields?: { column: string; key: string }[];
}

export interface CsvPreviewRow {
  rowNumber: number;
  email: string;
  name: string;
  data: Record<string, string>;
  status: 'ok' | 'invalid_email' | 'missing_email' | 'duplicate';
  warnings: string[];
}

export interface CsvPreview {
  headers: string[];
  suggestedMapping: CsvMapping;
  rowCount: number;
  rows: CsvPreviewRow[];
  summary: { ok: number; invalid: number; duplicates: number; withMissingValues: number };
}

export const CSV_MAX_ROWS = 2000;
export const CSV_MAX_BYTES = 1_000_000;

export function suggestMapping(headers: string[]): CsvMapping {
  const norm = headers.map(h => normalizeKey(h));
  const emailIdx = norm.findIndex(h => ['email', 'e_mail', 'email_address', 'mail'].includes(h)) >= 0
    ? norm.findIndex(h => ['email', 'e_mail', 'email_address', 'mail'].includes(h))
    : norm.findIndex(h => h.includes('email'));
  const nameIdx = norm.findIndex(h => ['name', 'full_name', 'student_name', 'fullname'].includes(h)) >= 0
    ? norm.findIndex(h => ['name', 'full_name', 'student_name', 'fullname'].includes(h))
    : norm.findIndex(h => h.endsWith('name') && !h.includes('first') && !h.includes('team') && !h.includes('coordinator'));
  const fields = headers
    .map((h, i) => ({ column: h, key: norm[i], i }))
    .filter(f => f.i !== emailIdx && f.i !== nameIdx && f.key)
    .map(({ column, key }) => ({ column, key }));
  return { email: emailIdx >= 0 ? headers[emailIdx] : '', name: nameIdx >= 0 ? headers[nameIdx] : null, fields };
}

export function buildCsvPreview(csv: string, mapping?: CsvMapping): CsvPreview {
  const table = parseCsv(csv);
  if (table.length === 0) throw new Error('The CSV file is empty');
  const headers = table[0].map(h => h.trim());
  if (headers.every(h => h === '')) throw new Error('The first row must contain column names');
  const dataRows = table.slice(1);
  if (dataRows.length > CSV_MAX_ROWS) throw new Error(`CSV has ${dataRows.length} rows; the limit is ${CSV_MAX_ROWS}`);

  const suggested = suggestMapping(headers);
  const m = mapping ?? suggested;
  const col = (name: string | null | undefined) => (name ? headers.indexOf(name) : -1);
  const emailIdx = col(m.email);
  const nameIdx = col(m.name ?? null);
  const fieldCols = (m.fields ?? [])
    .map(f => ({ idx: col(f.column), key: normalizeKey(f.key) }))
    .filter(f => f.idx >= 0 && KEY_RE.test(f.key));

  const seen = new Set<string>();
  const rows: CsvPreviewRow[] = [];
  const summary = { ok: 0, invalid: 0, duplicates: 0, withMissingValues: 0 };
  dataRows.forEach((cells, i) => {
    const email = emailIdx >= 0 ? (cells[emailIdx] ?? '').trim() : '';
    const name = nameIdx >= 0 ? (cells[nameIdx] ?? '').trim() : '';
    const data: Record<string, string> = {};
    const warnings: string[] = [];
    for (const f of fieldCols) {
      const v = (cells[f.idx] ?? '').trim().slice(0, 500);
      data[f.key] = v;
      if (v === '') warnings.push(`${f.key} is empty`);
    }
    if (nameIdx >= 0 && name === '') warnings.push('name is empty');
    let status: CsvPreviewRow['status'] = 'ok';
    if (!email) status = 'missing_email';
    else if (!isValidEmail(email)) status = 'invalid_email';
    else if (seen.has(email.toLowerCase())) status = 'duplicate';
    else seen.add(email.toLowerCase());
    if (status === 'ok') summary.ok++;
    else if (status === 'duplicate') summary.duplicates++;
    else summary.invalid++;
    if (warnings.length) summary.withMissingValues++;
    rows.push({ rowNumber: i + 2, email, name, data, status, warnings });
  });
  return { headers, suggestedMapping: suggested, rowCount: rows.length, rows, summary };
}

// ── Student directory ──────────────────────────────────────────────────────
export interface StudentRow {
  roll_number: string;
  name: string | null;
  email: string;
  last_login: string | null;
}

export async function lookupStudentsByEmail(emails: string[]): Promise<Map<string, StudentRow>> {
  const out = new Map<string, StudentRow>();
  const lower = [...new Set(emails.map(e => e.toLowerCase()))];
  if (lower.length === 0) return out;
  const res = await pool.query<StudentRow>(
    `SELECT roll_number, name, email, last_login FROM student_sessions
      WHERE email IS NOT NULL AND lower(email) = ANY($1::text[])
      ORDER BY last_login DESC NULLS LAST, registered_at DESC`,
    [lower]
  );
  for (const r of res.rows) if (!out.has(r.email.toLowerCase())) out.set(r.email.toLowerCase(), r);
  return out;
}

export interface StudentSearchHit {
  rollNumber: string; name: string | null; email: string; batch: string; lastLogin: string | null;
}

/** Admin student search: name / email / roll number / batch / active status. */
export async function searchStudents(opts: { q?: string; batch?: string; active?: boolean; limit?: number }): Promise<StudentSearchHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const params: unknown[] = [];
  const where: string[] = ['email IS NOT NULL'];
  if (opts.q && opts.q.trim()) {
    params.push(`%${opts.q.trim().replace(/[%_\\]/g, m => `\\${m}`)}%`);
    where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR roll_number ILIKE $${params.length})`);
  }
  if (opts.active) where.push(`last_login >= NOW() - INTERVAL '30 days'`);
  const res = await pool.query<StudentRow>(
    `SELECT roll_number, name, email, last_login FROM student_sessions
      WHERE ${where.join(' AND ')} ORDER BY name NULLS LAST, roll_number LIMIT 500`,
    params
  );
  return res.rows
    .map(r => ({ rollNumber: r.roll_number, name: r.name, email: r.email, batch: deriveBatch(r.roll_number), lastLogin: r.last_login }))
    .filter(r => !opts.batch || r.batch === opts.batch)
    .slice(0, limit);
}

// ── Groups ─────────────────────────────────────────────────────────────────
export type GroupFilter =
  | { type: 'all_members' }
  | { type: 'active_members'; days?: number }
  | { type: 'batch'; batch: string }
  | { type: 'event_registrants'; eventId: string };

export interface GroupSummary {
  id: string; name: string; description: string | null;
  kind: 'system' | 'dynamic' | 'static'; memberCount: number | null;
}

export async function listGroups(): Promise<GroupSummary[]> {
  const counts = await pool.query<{ total: string; active: string }>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE last_login >= NOW() - INTERVAL '30 days') AS active
       FROM student_sessions WHERE email IS NOT NULL`
  );
  const total = parseInt(counts.rows[0]?.total ?? '0', 10);
  const active = parseInt(counts.rows[0]?.active ?? '0', 10);
  const out: GroupSummary[] = [
    { id: 'sys:all_members', name: 'All DNA members', description: 'Every registered student with an email', kind: 'system', memberCount: total },
    { id: 'sys:active_members', name: 'Active members', description: 'Logged in within the last 30 days', kind: 'system', memberCount: active },
  ];
  const batches = await pool.query<{ roll_number: string }>('SELECT roll_number FROM student_sessions WHERE email IS NOT NULL');
  const byBatch = new Map<string, number>();
  for (const r of batches.rows) { const b = deriveBatch(r.roll_number); byBatch.set(b, (byBatch.get(b) ?? 0) + 1); }
  for (const [b, n] of [...byBatch].sort()) {
    if (b !== 'Other') out.push({ id: `sys:batch:${b}`, name: `Batch ${b}`, description: 'Students whose roll number starts with this admission year', kind: 'system', memberCount: n });
  }
  const events = await pool.query<{ id: string; title: string; n: string }>(
    `SELECT e.id, e.title, COUNT(r.roll_number) AS n FROM events e
       LEFT JOIN event_rsvps r ON r.event_id = e.id GROUP BY e.id, e.title, e.created_at ORDER BY e.created_at DESC LIMIT 30`
  );
  for (const e of events.rows) {
    out.push({ id: `sys:event:${e.id}`, name: `Registrants — ${e.title}`, description: 'Students who registered for this event', kind: 'system', memberCount: parseInt(e.n, 10) });
  }
  const saved = await pool.query<{ id: string; name: string; description: string | null; kind: 'static' | 'dynamic'; n: string }>(
    `SELECT g.id, g.name, g.description, g.kind, COUNT(m.email) AS n FROM ec_groups g
       LEFT JOIN ec_group_members m ON m.group_id = g.id GROUP BY g.id ORDER BY g.name`
  );
  for (const g of saved.rows) out.push({ id: g.id, name: g.name, description: g.description, kind: g.kind, memberCount: g.kind === 'static' ? parseInt(g.n, 10) : null });
  return out;
}

interface GroupMember { email: string; name: string | null; data: Record<string, unknown> }

async function resolveFilter(f: GroupFilter): Promise<GroupMember[]> {
  const cap = 5000;
  if (f.type === 'event_registrants') {
    const r = await pool.query<StudentRow>(
      `SELECT ss.roll_number, ss.name, ss.email, ss.last_login FROM event_rsvps r
         JOIN student_sessions ss ON ss.roll_number = r.roll_number
        WHERE r.event_id = $1 AND ss.email IS NOT NULL LIMIT ${cap}`, [f.eventId]);
    return r.rows.map(s => ({ email: s.email, name: s.name, data: {} }));
  }
  const clause = f.type === 'active_members'
    ? `AND last_login >= NOW() - ($1 || ' days')::interval` : '';
  const params = f.type === 'active_members' ? [String(Math.min(Math.max(f.days ?? 30, 1), 365))] : [];
  const r = await pool.query<StudentRow>(
    `SELECT roll_number, name, email, last_login FROM student_sessions WHERE email IS NOT NULL ${clause} LIMIT ${cap}`, params);
  let rows = r.rows;
  if (f.type === 'batch') rows = rows.filter(s => deriveBatch(s.roll_number) === f.batch);
  return rows.map(s => ({ email: s.email, name: s.name, data: {} }));
}

export async function resolveGroupMembers(id: string): Promise<{ name: string; members: GroupMember[] } | null> {
  if (id.startsWith('sys:')) {
    const [, kind, arg] = id.split(':');
    if (kind === 'all_members') return { name: 'All DNA members', members: await resolveFilter({ type: 'all_members' }) };
    if (kind === 'active_members') return { name: 'Active members', members: await resolveFilter({ type: 'active_members' }) };
    if (kind === 'batch' && arg) return { name: `Batch ${arg}`, members: await resolveFilter({ type: 'batch', batch: arg }) };
    if (kind === 'event' && arg) return { name: `Registrants (${arg})`, members: await resolveFilter({ type: 'event_registrants', eventId: arg }) };
    return null;
  }
  const g = await pool.query<{ name: string; kind: 'static' | 'dynamic'; filter: GroupFilter | null }>(
    'SELECT name, kind, filter FROM ec_groups WHERE id = $1', [id]);
  if (g.rows.length === 0) return null;
  const grp = g.rows[0];
  if (grp.kind === 'dynamic' && grp.filter) return { name: grp.name, members: await resolveFilter(grp.filter) };
  const m = await pool.query<{ email: string; display_name: string | null; data: Record<string, unknown> }>(
    'SELECT email, display_name, data FROM ec_group_members WHERE group_id = $1 ORDER BY added_at', [id]);
  return { name: grp.name, members: m.rows.map(r => ({ email: r.email, name: r.display_name, data: r.data })) };
}

// ── Resolution ─────────────────────────────────────────────────────────────
const MAX_CUSTOM_FIELDS = 30;

/** Only valid snake_case keys with short scalar values survive. */
export function cleanCustomData(raw: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_CUSTOM_FIELDS) break;
    const key = normalizeKey(k);
    if (!KEY_RE.test(key)) continue;
    if (v === null || v === undefined) { out[key] = ''; continue; }
    if (typeof v === 'object') continue;
    out[key] = String(v).slice(0, 500);
  }
  return out;
}

export const MAX_RECIPIENTS = 1000;

export async function resolveRecipients(
  inputs: RecipientInput[],
  groupIds: string[],
): Promise<{ recipients: ResolvedRecipient[]; groupErrors: string[] }> {
  const groupErrors: string[] = [];
  const all: RecipientInput[] = [...inputs];

  for (const gid of [...new Set(groupIds)]) {
    const g = await resolveGroupMembers(gid);
    if (!g) { groupErrors.push(`Group "${gid}" no longer exists`); continue; }
    for (const m of g.members) {
      all.push({ email: m.email, name: m.name, source: 'group', data: m.data, groupRef: { id: gid, name: g.name } });
    }
  }
  if (all.length > MAX_RECIPIENTS) throw new Error(`Too many recipients (${all.length}); the limit is ${MAX_RECIPIENTS} per message`);

  const students = await lookupStudentsByEmail(all.map(r => String(r.email ?? '').trim()).filter(Boolean));
  const seen = new Set<string>();
  const recipients: ResolvedRecipient[] = [];

  for (const input of all) {
    const email = String(input.email ?? '').trim();
    const key = email.toLowerCase();
    const student = students.get(key) ?? null;
    const typedName = typeof input.name === 'string' ? input.name.trim() : '';
    const displayName = typedName || student?.name?.trim() || null;
    const custom = cleanCustomData(input.data);

    const data: Record<string, Scalar> = { ...custom };
    // Computed fields. DB-sourced values win over client-supplied ones.
    data.email = email;
    if (displayName) { data.full_name = displayName; data.first_name = firstNameOf(displayName); }
    else { delete data.full_name; if (!custom.first_name) delete data.first_name; }
    if (student) { data.roll_number = student.roll_number; data.batch = deriveBatch(student.roll_number); }

    const r: ResolvedRecipient = {
      email, displayName, source: input.source, studentRoll: student?.roll_number ?? null,
      matchedStudent: Boolean(student), data, groupRef: input.groupRef ?? null, state: 'ok',
    };
    if (!isValidEmail(email)) { r.state = 'invalid_email'; r.note = 'Not a valid email address'; }
    else if (input.excluded) { r.state = 'excluded'; r.note = 'Excluded by admin'; }
    else if (seen.has(key)) { r.state = 'excluded'; r.note = 'Duplicate of an earlier recipient'; }
    // An explicitly excluded row also claims its address, so the same person arriving
    // later through a group stays excluded (this is how "remove this group member" works).
    if (r.state === 'ok' || r.state === 'excluded') seen.add(key);
    recipients.push(r);
  }
  return { recipients, groupErrors };
}

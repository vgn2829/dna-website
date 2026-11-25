// Email Centre personalization + conditional engine.
//
// ONE implementation renders both previews and real sends (the orchestrator
// calls renderMessage for both), so what an admin previews is byte-for-byte
// what is dispatched.
//
// Safety model — nothing here evaluates code:
//  * Content is a TipTap-style JSON document. Only the allow-listed node and
//    mark types below are rendered; anything else is dropped and reported.
//    HTML is GENERATED from that schema with every text value escaped, so
//    there is no untrusted HTML to "sanitize" — unknown tags, attributes,
//    scripts and event handlers simply have no way into the output.
//  * Conditions are plain data ({match, rules:[{field,op,value}]}) evaluated
//    by a fixed switch over an allow-listed operator set. No eval, no
//    expression language.
//  * Variables are `{{snake_case_name}}` / `{{name|fallback}}` tokens looked
//    up in a per-recipient data snapshot — never arbitrary object paths.

import crypto from 'crypto';

export type Scalar = string | number | boolean | null;
export type RecipientData = Record<string, Scalar>;

// ── Catalog ────────────────────────────────────────────────────────────────
export type VariableCategory = 'Recipient' | 'Student' | 'Event' | 'Selection';

export interface VariableDef {
  name: string;
  category: VariableCategory;
  label: string;
  sample: string;
  /** 'recipient' = per-person, 'shared' = same for everyone in the message. */
  scope: 'recipient' | 'shared';
}

export const VARIABLE_CATALOG: VariableDef[] = [
  { name: 'first_name',  category: 'Recipient', label: 'First name', sample: 'Aarav', scope: 'recipient' },
  { name: 'full_name',   category: 'Recipient', label: 'Full name', sample: 'Aarav Sharma', scope: 'recipient' },
  { name: 'email',       category: 'Recipient', label: 'Email address', sample: 'aarav@example.com', scope: 'recipient' },
  { name: 'roll_number', category: 'Student', label: 'Roll number', sample: '250123', scope: 'recipient' },
  { name: 'batch',       category: 'Student', label: 'Batch', sample: 'Y25', scope: 'recipient' },
  { name: 'department',  category: 'Student', label: 'Department (CSV / manual only)', sample: 'Design', scope: 'recipient' },
  { name: 'event_name',  category: 'Event', label: 'Event name', sample: 'Figma UI Sprint', scope: 'shared' },
  { name: 'event_date',  category: 'Event', label: 'Event date', sample: '12 Jun 2026', scope: 'shared' },
  { name: 'event_venue', category: 'Event', label: 'Event venue', sample: 'LHC-3', scope: 'shared' },
  { name: 'event_link',  category: 'Event', label: 'Event link', sample: 'https://www.dnaiitk.site/events', scope: 'shared' },
  { name: 'selection_status',  category: 'Selection', label: 'Selection status', sample: 'Selected', scope: 'recipient' },
  { name: 'team_name',         category: 'Selection', label: 'Team name', sample: 'Animation', scope: 'recipient' },
  { name: 'role',              category: 'Selection', label: 'Role', sample: '3D Animator', scope: 'recipient' },
  { name: 'coordinator_name',  category: 'Selection', label: 'Coordinator name', sample: 'Riya Verma', scope: 'shared' },
];

export const CATALOG_NAMES = new Set(VARIABLE_CATALOG.map(v => v.name));
export const SHARED_ONLY_NAMES = new Set(VARIABLE_CATALOG.filter(v => v.scope === 'shared').map(v => v.name));

export function sampleData(): RecipientData {
  const out: RecipientData = {};
  for (const v of VARIABLE_CATALOG) out[v.name] = v.sample;
  return out;
}

// ── Operators / conditions ─────────────────────────────────────────────────
export const OPERATORS = [
  'equals', 'not_equals', 'contains', 'not_contains',
  'is_empty', 'is_not_empty', 'gt', 'lt', 'one_of',
] as const;
export type Operator = (typeof OPERATORS)[number];
const OPERATOR_SET = new Set<string>(OPERATORS);
const NO_VALUE_OPS = new Set<string>(['is_empty', 'is_not_empty']);

export interface Rule { field: string; op: Operator; value?: string | string[] }
export interface Condition { match: 'all' | 'any'; rules: Rule[] }

export interface SubjectConfig {
  default: string;
  variants?: { when: Condition; subject: string }[];
}

export interface DocMark { type: string; attrs?: Record<string, unknown> }
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

export type IssueCode =
  | 'missing_data' | 'unknown_variable' | 'invalid_operator' | 'invalid_condition'
  | 'unknown_condition_field' | 'non_numeric_comparison' | 'unsafe_url'
  | 'unsupported_node' | 'too_deep' | 'too_large' | 'subject_empty' | 'subject_too_long';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
  variable?: string;
}

export const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;
const TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]{0,40})\s*(?:\|([^{}]*))?\}\}/g;
const MAX_NODES = 5000;
const MAX_COND_DEPTH = 3;
const MAX_RULES = 10;
const MAX_SUBJECT = 300;

/** CSV header / user label → a valid variable key ("Team Name" → team_name). */
export function normalizeKey(raw: string): string {
  let k = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!k) return '';
  if (!/^[a-z]/.test(k)) k = `f_${k}`;
  return k.slice(0, 41);
}

export function firstNameOf(fullName: string | null | undefined): string | null {
  const t = (fullName ?? '').trim();
  if (!t) return null;
  return t.split(/\s+/)[0] ?? null;
}

function isEmptyValue(v: Scalar | undefined): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}
function str(v: Scalar | undefined): string {
  return isEmptyValue(v) ? '' : String(v).trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Condition evaluation ───────────────────────────────────────────────────
export function validateCondition(c: unknown, where: string, issues: Issue[]): c is Condition {
  const bad = (message: string, code: IssueCode = 'invalid_condition') => {
    issues.push({ code, severity: 'error', message: `${where}: ${message}` });
    return false;
  };
  if (!c || typeof c !== 'object') return bad('condition is missing');
  const cond = c as Partial<Condition>;
  if (cond.match !== 'all' && cond.match !== 'any') return bad('match must be "all" or "any"');
  if (!Array.isArray(cond.rules) || cond.rules.length === 0) return bad('needs at least one rule');
  if (cond.rules.length > MAX_RULES) return bad(`at most ${MAX_RULES} rules`);
  for (const r of cond.rules) {
    if (!r || typeof r !== 'object') return bad('rule is malformed');
    const rule = r as Partial<Rule>;
    if (typeof rule.field !== 'string' || !KEY_RE.test(rule.field)) return bad(`"${String(rule.field)}" is not a valid field name`);
    if (typeof rule.op !== 'string' || !OPERATOR_SET.has(rule.op)) return bad(`operator "${String(rule.op)}" is not supported`, 'invalid_operator');
    if (!NO_VALUE_OPS.has(rule.op)) {
      const v = rule.value;
      const ok = rule.op === 'one_of'
        ? (Array.isArray(v) ? v.length > 0 && v.every(x => typeof x === 'string') : typeof v === 'string' && v.trim() !== '')
        : typeof v === 'string' || typeof v === 'number';
      if (!ok) return bad(`rule on "${rule.field}" needs a value`);
    }
  }
  return true;
}

function listValue(v: string | string[] | undefined): string[] {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(',');
  return arr.map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function evaluateCondition(cond: Condition, data: RecipientData, issues: Issue[]): boolean {
  const results = cond.rules.map(rule => {
    const raw = data[rule.field];
    const val = str(raw);
    const lc = val.toLowerCase();
    const want = String(Array.isArray(rule.value) ? rule.value.join(',') : rule.value ?? '').trim();
    switch (rule.op) {
      case 'equals':       return lc === want.toLowerCase();
      case 'not_equals':   return lc !== want.toLowerCase();
      case 'contains':     return lc.includes(want.toLowerCase());
      case 'not_contains': return !lc.includes(want.toLowerCase());
      case 'is_empty':     return val === '';
      case 'is_not_empty': return val !== '';
      case 'one_of':       return listValue(rule.value).includes(lc);
      case 'gt':
      case 'lt': {
        const a = Number(val); const b = Number(want);
        if (val === '' || want === '' || !Number.isFinite(a) || !Number.isFinite(b)) {
          issues.push({ code: 'non_numeric_comparison', severity: 'warning',
            message: `"${rule.field}" is not numeric for a ${rule.op === 'gt' ? 'greater' : 'less'}-than check`, variable: rule.field });
          return false;
        }
        return rule.op === 'gt' ? a > b : a < b;
      }
      default: return false;
    }
  });
  return cond.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

// ── Token scanning ─────────────────────────────────────────────────────────
export function extractTokens(text: string): { name: string; fallback?: string }[] {
  const out: { name: string; fallback?: string }[] = [];
  for (const m of text.matchAll(TOKEN_RE)) out.push({ name: m[1].toLowerCase(), fallback: m[2] });
  return out;
}

const SAFE_URL_RE = /^(https?:\/\/|mailto:)/i;
const SAFE_IMG_RE = /^(https:\/\/|cid:)/i;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/;
const ALIGNS = new Set(['left', 'center', 'right', 'justify']);

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'image', 'button', 'callout', 'horizontalRule', 'conditionalBlock', 'conditionalBranch', 'doc']);
const INLINE_TYPES = new Set(['text', 'hardBreak']);

function walk(node: DocNode, fn: (n: DocNode, depth: number) => void, depth = 0): void {
  fn(node, depth);
  for (const c of node.content ?? []) walk(c, fn, depth + (node.type === 'conditionalBlock' ? 1 : 0));
}

/** Every variable name referenced by the subject/body/links/conditions. */
export function collectReferencedNames(subject: SubjectConfig, doc: DocNode): Set<string> {
  const names = new Set<string>();
  const addText = (t: unknown) => { if (typeof t === 'string') for (const k of extractTokens(t)) names.add(k.name); };
  const addCond = (c: unknown) => {
    const rules = (c as Condition | null | undefined)?.rules;
    if (Array.isArray(rules)) for (const r of rules) if (r && typeof r.field === 'string') names.add(r.field);
  };
  addText(subject.default);
  for (const v of subject.variants ?? []) { addText(v.subject); addCond(v.when); }
  walk(doc, n => {
    addText(n.text);
    for (const m of n.marks ?? []) addText(m.attrs?.href);
    if (n.attrs) { addText(n.attrs.href); addText(n.attrs.label); addText(n.attrs.alt); addText(n.attrs.src); }
    if (n.type === 'conditionalBranch') addCond(n.attrs?.when);
  });
  return names;
}

/**
 * Structural validation independent of any recipient: unknown variables,
 * bad operators/conditions, unsupported nodes, nesting depth, static unsafe
 * URLs. `known` = every variable name usable in this message.
 */
export function validateTemplate(subject: SubjectConfig, doc: DocNode, known: Set<string>): Issue[] {
  const issues: Issue[] = [];
  if (!subject || typeof subject.default !== 'string' || subject.default.trim() === '') {
    issues.push({ code: 'subject_empty', severity: 'error', message: 'Subject is empty' });
  }
  (subject?.variants ?? []).forEach((v, i) => validateCondition(v.when, `Subject variation ${i + 1}`, issues));

  let nodes = 0;
  walk(doc, (n, depth) => {
    nodes++;
    if (n.type === 'conditionalBlock' && depth + 1 > MAX_COND_DEPTH) {
      issues.push({ code: 'too_deep', severity: 'error', message: `Conditional blocks can be nested at most ${MAX_COND_DEPTH} deep` });
    }
    if (n.type === 'conditionalBranch' && n.attrs?.when != null) validateCondition(n.attrs.when, 'Conditional block', issues);
    if (n.type !== 'doc' && n.type !== 'text' && !BLOCK_TYPES.has(n.type) && !INLINE_TYPES.has(n.type)) {
      issues.push({ code: 'unsupported_node', severity: 'warning', message: `"${n.type}" content is not supported in email and was dropped` });
    }
    const hrefs: unknown[] = [n.attrs?.href, ...(n.marks ?? []).map(m => m.attrs?.href)];
    for (const h of hrefs) {
      if (typeof h === 'string' && h.trim() && !h.includes('{{') && !SAFE_URL_RE.test(h.trim())) {
        issues.push({ code: 'unsafe_url', severity: 'error', message: `Link "${h.slice(0, 60)}" must start with http://, https:// or mailto:` });
      }
    }
  });
  if (nodes > MAX_NODES) issues.push({ code: 'too_large', severity: 'error', message: 'Email content is too large' });

  for (const name of collectReferencedNames(subject, doc)) {
    if (!known.has(name)) {
      issues.push({ code: 'unknown_variable', severity: 'error', variable: name,
        message: `Unknown variable {{${name}}} — it is not a built-in field or a column/field in your recipients` });
    }
  }
  // De-dupe identical messages (same variable referenced repeatedly).
  const seen = new Set<string>();
  return issues.filter(i => { const k = `${i.code}|${i.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── Rendering ──────────────────────────────────────────────────────────────
export interface RenderInput {
  subject: SubjectConfig;
  doc: DocNode;
  /** Message-level fallbacks used when a recipient lacks a value. */
  fallbacks?: Record<string, string>;
  /** Variables available in this message; unknown names are reported. */
  known: Set<string>;
  data: RecipientData;
}

export interface RenderResult {
  /** true only if there are no error-severity issues. */
  ok: boolean;
  subject: string;
  bodyHtml: string;
  text: string;
  issues: Issue[];
  /** Every variable value actually substituted (for the preview panel). */
  resolved: Record<string, string>;
  /** Human-readable list of the conditional branches that were selected. */
  branches: string[];
  hash: string;
}

// Text colours for the surface being rendered (the page paper, or inside a callout).
interface Ink { body: string; head: string; link: string }
const PAPER_INK: Ink = { body: '#333333', head: '#111111', link: '#b8105f' };

interface Ctx {
  ink: Ink;
  data: RecipientData;
  fallbacks: Record<string, string>;
  known: Set<string>;
  issues: Issue[];
  resolved: Record<string, string>;
  branches: string[];
}

function addIssue(ctx: Ctx, issue: Issue) {
  if (!ctx.issues.some(i => i.code === issue.code && i.message === issue.message)) ctx.issues.push(issue);
}

/** Substitute tokens in `s`. `format` is applied to each resolved value. */
function substitute(s: string, ctx: Ctx, format: (v: string) => string, missingMarker: (n: string) => string): string {
  return s.replace(TOKEN_RE, (_m, rawName: string, inlineFallback?: string) => {
    const name = rawName.toLowerCase();
    if (!ctx.known.has(name)) {
      addIssue(ctx, { code: 'unknown_variable', severity: 'error', variable: name, message: `Unknown variable {{${name}}}` });
      return missingMarker(name);
    }
    const v = str(ctx.data[name]);
    if (v !== '') { ctx.resolved[name] = v; return format(v); }
    const fb = inlineFallback !== undefined ? inlineFallback.trim() : ctx.fallbacks[name];
    if (fb !== undefined && fb.trim() !== '') { ctx.resolved[name] = fb.trim(); return format(fb.trim()); }
    addIssue(ctx, { code: 'missing_data', severity: 'error', variable: name, message: `No value for {{${name}}}` });
    return missingMarker(name);
  });
}

const missingHtml = (n: string) => `<span style="background:#fde68a;color:#7c2d12;padding:0 4px;border-radius:3px">⟨${escapeHtml(n)} missing⟩</span>`;
const missingText = (n: string) => `⟨${n} missing⟩`;

function resolveHtmlText(s: string, ctx: Ctx): string {
  // Escape the literal parts and the substituted values separately so a value
  // containing "{{x}}" or markup can never be re-expanded or injected.
  let out = ''; let last = 0;
  for (const m of s.matchAll(TOKEN_RE)) {
    out += escapeHtml(s.slice(last, m.index));
    out += substitute(m[0], ctx, v => escapeHtml(v), missingHtml);
    last = (m.index ?? 0) + m[0].length;
  }
  return out + escapeHtml(s.slice(last));
}
function resolvePlain(s: string, ctx: Ctx): string {
  return substitute(s, ctx, v => v, missingText);
}

function safeUrl(raw: unknown, ctx: Ctx, kind: 'link' | 'image'): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  // A token that IS the start of the URL ({{event_link}}) carries a whole URL, which is then
  // protocol-checked below. A token anywhere else (a query value, a path segment) is
  // URL-encoded so the value cannot break out of the URL.
  const src = raw.trim();
  let url = '';
  let last = 0;
  for (const m of src.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    url += src.slice(last, at);
    url += substitute(m[0], ctx, v => (at === 0 ? v : encodeURIComponent(v)), missingText);
    last = at + m[0].length;
  }
  url = (url + src.slice(last)).trim();
  const re = kind === 'image' ? SAFE_IMG_RE : SAFE_URL_RE;
  if (!re.test(url)) {
    addIssue(ctx, { code: 'unsafe_url', severity: 'error', message: `${kind === 'image' ? 'Image' : 'Link'} URL "${url.slice(0, 60)}" is not allowed` });
    return null;
  }
  return url;
}

// DNA call-to-action pink. A table cell carries the background so Outlook (which ignores
// padding/background on <a>) still draws a solid button; rounded corners are progressive.
const BTN_BG = '#e64298';
const BTN_LINK_STYLE = 'display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;';

export const CALLOUT_TONES = ['highlight', 'lime', 'outline', 'dark'] as const;
type Tone = (typeof CALLOUT_TONES)[number];
const TONE_STYLE: Record<Tone, { bg: string; border: string; ink: Ink; label: string }> = {
  highlight: { bg: '#e0f55b', border: 'none', ink: { body: '#111111', head: '#111111', link: '#111111' }, label: '#111111' },
  lime:      { bg: '#dced3e', border: 'none', ink: { body: '#111111', head: '#111111', link: '#111111' }, label: '#111111' },
  outline:   { bg: '#ffffff', border: '2px solid #111111', ink: { body: '#333333', head: '#111111', link: '#b8105f' }, label: '#111111' },
  dark:      { bg: '#222222', border: 'none', ink: { body: '#ffffff', head: '#ffffff', link: '#e0f55b' }, label: '#e0f55b' },
};
const MONO = "'Courier New',Courier,monospace";

function renderInline(nodes: DocNode[] | undefined, ctx: Ctx): { html: string; text: string } {
  let html = ''; let text = '';
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') { html += '<br>'; text += '\n'; continue; }
    if (n.type !== 'text' || typeof n.text !== 'string') continue;
    let h = resolveHtmlText(n.text, ctx);
    let t = resolvePlain(n.text, ctx);
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') h = `<strong>${h}</strong>`;
      else if (m.type === 'italic') h = `<em>${h}</em>`;
      else if (m.type === 'underline') h = `<u>${h}</u>`;
      else if (m.type === 'highlight') {
        // The DNA marker: a lime highlight behind the words (as in the welcome email). Falls back
        // to plain bold text where background colour on inline elements is unsupported.
        h = `<span style="background-color:#e0f55b;padding:2px 5px;font-weight:700;color:#111111;border-radius:2px;-webkit-box-decoration-break:clone;box-decoration-break:clone">${h}</span>`;
      }
      else if (m.type === 'textStyle' && typeof m.attrs?.color === 'string' && COLOR_RE.test(m.attrs.color)) {
        h = `<span style="color:${m.attrs.color}">${h}</span>`;
      } else if (m.type === 'link') {
        const url = safeUrl(m.attrs?.href, ctx, 'link');
        if (url) { h = `<a href="${escapeHtml(url)}" style="color:${ctx.ink.link};text-decoration:underline">${h}</a>`; t = `${t} (${url})`; }
      }
    }
    html += h; text += t;
  }
  return { html, text };
}

function alignStyle(n: DocNode): string {
  const a = n.attrs?.textAlign;
  return typeof a === 'string' && ALIGNS.has(a) ? `text-align:${a};` : '';
}

function renderBlocks(nodes: DocNode[] | undefined, ctx: Ctx, path: string, depth: number): { html: string; text: string } {
  let html = ''; let text = '';
  (nodes ?? []).forEach((n, i) => {
    const p = path ? `${path}.${i}` : String(i);
    switch (n.type) {
      case 'paragraph': {
        const r = renderInline(n.content, ctx);
        html += `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;font-weight:500;color:${ctx.ink.body};${alignStyle(n)}">${r.html || '&nbsp;'}</p>`;
        text += `${r.text}\n\n`;
        break;
      }
      case 'heading': {
        const lvl = Math.min(3, Math.max(1, Number(n.attrs?.level) || 2));
        // Bold, tightly tracked headings (the DNA look). `class` lets the shell's mobile
        // stylesheet shrink them; the inline size is the fallback everywhere else.
        const look = lvl === 1 ? 'font-size:44px;line-height:1.05;letter-spacing:-1.5px;margin:0 0 14px;'
          : lvl === 2 ? 'font-size:28px;line-height:1.1;letter-spacing:-1px;margin:20px 0 8px;'
          : 'font-size:18px;line-height:1.3;letter-spacing:-0.3px;margin:0 0 20px;';
        const r = renderInline(n.content, ctx);
        html += `<h${lvl} class="dna-h${lvl}" style="${look}font-weight:800;color:${ctx.ink.head};${alignStyle(n)}">${r.html}</h${lvl}>`;
        text += `${r.text}\n\n`;
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const tag = n.type === 'bulletList' ? 'ul' : 'ol';
        let items = ''; let t = '';
        (n.content ?? []).forEach((li, j) => {
          if (li.type !== 'listItem') return;
          const inner = renderBlocks(li.content, ctx, `${p}.${j}`, depth);
          const flat = inner.html.replace(/<p style="[^"]*">/g, '').replace(/<\/p>/g, '');
          items += `<li style="margin:0 0 6px">${flat}</li>`;
          t += `${n.type === 'bulletList' ? '•' : `${j + 1}.`} ${inner.text.trim()}\n`;
        });
        html += `<${tag} style="margin:0 0 16px 22px;padding:0;line-height:1.6">${items}</${tag}>`;
        text += `${t}\n`;
        break;
      }
      case 'image': {
        const src = safeUrl(n.attrs?.src, ctx, 'image');
        if (src) {
          const alt = typeof n.attrs?.alt === 'string' ? resolvePlain(n.attrs.alt, ctx) : '';
          html += `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;display:block;margin:0 0 16px;border-radius:8px">`;
          if (alt) text += `[${alt}]\n\n`;
        }
        break;
      }
      case 'button': {
        const url = safeUrl(n.attrs?.href, ctx, 'link');
        const label = typeof n.attrs?.label === 'string' ? n.attrs.label : '';
        if (url && label) {
          html += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr><td bgcolor="${BTN_BG}" style="background-color:${BTN_BG};border-radius:25px"><a href="${escapeHtml(url)}" style="${BTN_LINK_STYLE}">${resolveHtmlText(label, ctx)}</a></td></tr></table>`;
          text += `${resolvePlain(label, ctx)}: ${url}\n\n`;
        }
        break;
      }
      case 'horizontalRule': {
        // A quiet separator between sections.
        html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px"><tr><td height="1" style="border-top:1px solid #c8c8bd;font-size:1px;line-height:1px;height:1px">&nbsp;</td></tr></table>`;
        text += '---\n\n';
        break;
      }
      case 'callout': {
        // A highlighted panel with an optional small monospace label (schedule blocks, notices…).
        const tone: Tone = (CALLOUT_TONES as readonly string[]).includes(String(n.attrs?.tone)) ? (n.attrs!.tone as Tone) : 'highlight';
        const t = TONE_STYLE[tone];
        const label = typeof n.attrs?.label === 'string' ? n.attrs.label.trim() : '';
        const prev = ctx.ink;
        ctx.ink = t.ink;
        const inner = renderBlocks(n.content, ctx, `${p}.c`, depth);
        ctx.ink = prev;
        const labelHtml = label
          ? `<div style="font-family:${MONO};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.label};margin:0 0 10px">${resolveHtmlText(label, ctx)}</div>` : '';
        html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr><td bgcolor="${t.bg}" style="background-color:${t.bg};border:${t.border};border-radius:6px;padding:16px 18px;color:${t.ink.body}">${labelHtml}${inner.html.replace(/margin:0 0 16px;/g, 'margin:0 0 10px;')}</td></tr></table>`;
        text += `${label ? `${resolvePlain(label, ctx).toUpperCase()}\n` : ''}${inner.text}`;
        break;
      }
      case 'conditionalBlock': {
        if (depth + 1 > MAX_COND_DEPTH) {
          addIssue(ctx, { code: 'too_deep', severity: 'error', message: `Conditional blocks can be nested at most ${MAX_COND_DEPTH} deep` });
          break;
        }
        const branches = (n.content ?? []).filter(b => b.type === 'conditionalBranch');
        for (let b = 0; b < branches.length; b++) {
          const br = branches[b];
          const when = br.attrs?.when;
          let hit = false;
          if (when == null) hit = true; // "otherwise" branch
          else {
            const tmp: Issue[] = [];
            if (!validateCondition(when, 'Conditional block', tmp)) { for (const x of tmp) addIssue(ctx, x); continue; }
            for (const r of when.rules) {
              if (!ctx.known.has(r.field)) {
                addIssue(ctx, { code: 'unknown_condition_field', severity: 'warning', variable: r.field,
                  message: `Condition uses "${r.field}" which no recipient provides — treated as empty` });
              }
            }
            hit = evaluateCondition(when, ctx.data, ctx.issues);
          }
          if (hit) {
            ctx.branches.push(when == null ? `Block ${p}: otherwise` : `Block ${p}: branch ${b + 1} (${describeCondition(when)})`);
            const inner = renderBlocks(br.content, ctx, `${p}.${b}`, depth + 1);
            html += inner.html; text += inner.text;
            break; // first matching branch wins
          }
        }
        break;
      }
      default:
        // Unknown block: dropped (validateTemplate reports it).
        break;
    }
  });
  return { html, text };
}

export function describeCondition(c: Condition): string {
  const label: Record<string, string> = {
    equals: '=', not_equals: '≠', contains: 'contains', not_contains: 'does not contain',
    is_empty: 'is empty', is_not_empty: 'is not empty', gt: '>', lt: '<', one_of: 'is one of',
  };
  return c.rules.map(r => `${r.field} ${label[r.op]}${NO_VALUE_OPS.has(r.op) ? '' : ` ${Array.isArray(r.value) ? r.value.join('/') : r.value}`}`)
    .join(c.match === 'all' ? ' AND ' : ' OR ');
}

export function pickSubject(subject: SubjectConfig, data: RecipientData, issues: Issue[]): { template: string; variant: number } {
  for (let i = 0; i < (subject.variants ?? []).length; i++) {
    const v = subject.variants![i];
    const tmp: Issue[] = [];
    if (!validateCondition(v.when, `Subject variation ${i + 1}`, tmp)) { issues.push(...tmp); continue; }
    if (evaluateCondition(v.when, data, issues)) return { template: v.subject, variant: i };
  }
  return { template: subject.default, variant: -1 };
}

export function renderMessage(input: RenderInput): RenderResult {
  const ctx: Ctx = {
    ink: PAPER_INK, data: input.data, fallbacks: input.fallbacks ?? {}, known: input.known,
    issues: [], resolved: {}, branches: [],
  };

  // Subject (with optional conditional variations).
  const picked = pickSubject(input.subject, input.data, ctx.issues);
  if (picked.variant >= 0) ctx.branches.push(`Subject: variation ${picked.variant + 1}`);
  let subject = resolvePlain(picked.template ?? '', ctx).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!subject) addIssue(ctx, { code: 'subject_empty', severity: 'error', message: 'Subject is empty' });
  if (subject.length > MAX_SUBJECT) {
    addIssue(ctx, { code: 'subject_too_long', severity: 'error', message: `Subject is longer than ${MAX_SUBJECT} characters` });
    subject = subject.slice(0, MAX_SUBJECT);
  }

  // Structural problems that are not per-recipient (unsupported nodes, deep nesting…).
  let nodeCount = 0;
  walk(input.doc, () => { nodeCount++; });
  if (nodeCount > MAX_NODES) addIssue(ctx, { code: 'too_large', severity: 'error', message: 'Email content is too large' });
  else {
    walk(input.doc, n => {
      if (n.type !== 'doc' && n.type !== 'text' && !BLOCK_TYPES.has(n.type) && !INLINE_TYPES.has(n.type)) {
        addIssue(ctx, { code: 'unsupported_node', severity: 'warning', message: `"${n.type}" content is not supported in email and was dropped` });
      }
    });
  }

  const body = nodeCount > MAX_NODES ? { html: '', text: '' } : renderBlocks(input.doc?.content, ctx, '', 0);
  const text = body.text.replace(/\n{3,}/g, '\n\n').trim();
  const hash = crypto.createHash('sha256').update(subject).update('\0').update(body.html).digest('hex');
  return {
    ok: !ctx.issues.some(i => i.severity === 'error'),
    subject, bodyHtml: body.html, text, issues: ctx.issues,
    resolved: ctx.resolved, branches: ctx.branches, hash,
  };
}

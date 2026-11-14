import { describe, it, expect } from 'vitest';
import {
  CATALOG_NAMES, evaluateCondition, extractTokens, normalizeKey, renderMessage, validateTemplate,
  type Condition, type DocNode, type Issue, type RecipientData, type SubjectConfig,
} from '../src/services/emailCentre/engine';
import { buildCsvPreview, parseCsv, parseEmailList } from '../src/services/emailCentre/recipients';
import { verifySvixSignature } from '../src/services/emailCentre/provider';
import crypto from 'crypto';

const t = (text: string, marks?: DocNode['marks']): DocNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...c: (string | DocNode)[]): DocNode => ({ type: 'paragraph', content: c.map(x => (typeof x === 'string' ? t(x) : x)) });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const eq = (field: string, value: string): Condition => ({ match: 'all', rules: [{ field, op: 'equals', value }] });
const branch = (when: Condition | null, ...content: DocNode[]): DocNode => ({ type: 'conditionalBranch', attrs: { when }, content });
const cond = (...branches: DocNode[]): DocNode => ({ type: 'conditionalBlock', content: branches });

const KNOWN = new Set([...CATALOG_NAMES, 'result', 'score', 'colour']);
const render = (subject: SubjectConfig | string, d: DocNode, data: RecipientData, extra: { fallbacks?: Record<string, string>; known?: Set<string> } = {}) =>
  renderMessage({ subject: typeof subject === 'string' ? { default: subject } : subject, doc: d, data, known: extra.known ?? KNOWN, fallbacks: extra.fallbacks });

describe('personalization', () => {
  const body = doc(p('Hello {{first_name}},'), p('Your team is {{team_name}}. Result: {{selection_status}}.'));
  const subject = 'Congratulations, {{first_name}}! Your {{team_name}} result is here.';

  it('renders a different subject and body per recipient (spec example)', () => {
    const xyz = render(subject, body, { first_name: 'XYZ', team_name: 'Animation', selection_status: 'Selected' });
    const abc = render(subject, body, { first_name: 'ABC', team_name: 'Design', selection_status: 'Selected' });
    const pqr = render(subject, body, { first_name: 'PQR', team_name: 'Animation', selection_status: 'Waitlisted' });
    expect(xyz.ok && abc.ok && pqr.ok).toBe(true);
    expect(xyz.subject).toBe('Congratulations, XYZ! Your Animation result is here.');
    expect(abc.bodyHtml).toContain('Hello ABC,');
    expect(abc.bodyHtml).toContain('Design');
    expect(abc.bodyHtml).not.toContain('XYZ');
    expect(pqr.bodyHtml).toContain('Waitlisted');
    expect(pqr.text).toContain('Result: Waitlisted.');
  });

  it('flags a missing value instead of silently producing "Hello ,"', () => {
    const r = render(subject, body, { team_name: 'Design', selection_status: 'Selected' });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'missing_data' && i.variable === 'first_name')).toBe(true);
    expect(r.bodyHtml).not.toMatch(/Hello ,/);
    expect(r.bodyHtml).toContain('first_name missing');
    expect(r.subject).toContain('⟨first_name missing⟩');
  });

  it('treats whitespace-only values as missing', () => {
    expect(render('Hi {{first_name}}', doc(p('x')), { first_name: '   ' }).ok).toBe(false);
  });

  it('uses inline and message-level fallbacks only when explicitly configured', () => {
    expect(render('Hi {{first_name|there}}', doc(p('x')), {}).subject).toBe('Hi there');
    const viaMessage = render('Hi {{first_name}}', doc(p('x')), {}, { fallbacks: { first_name: 'friend' } });
    expect(viaMessage.ok).toBe(true);
    expect(viaMessage.subject).toBe('Hi friend');
    // a real value always beats the fallback
    expect(render('Hi {{first_name|there}}', doc(p('x')), { first_name: 'Asha' }).subject).toBe('Hi Asha');
  });

  it('rejects unknown variables (typos) rather than leaving the braces in the email', () => {
    const r = render('Hi {{frist_name}}', doc(p('{{nope}}')), { first_name: 'A' });
    expect(r.ok).toBe(false);
    expect(r.issues.filter(i => i.code === 'unknown_variable').map(i => i.variable).sort()).toEqual(['frist_name', 'nope']);
    const issues = validateTemplate({ default: 'Hi {{frist_name}}' }, doc(p('x')), KNOWN);
    expect(issues.some(i => i.code === 'unknown_variable' && i.variable === 'frist_name')).toBe(true);
  });

  it('supports custom CSV-style fields once they are known', () => {
    const r = render('Re: {{result}}', doc(p('Score {{score}}')), { result: 'Selected', score: 42 });
    expect(r.ok).toBe(true);
    expect(r.subject).toBe('Re: Selected');
    expect(r.bodyHtml).toContain('Score 42');
  });

  it('escapes HTML in values and never re-expands tokens inside values', () => {
    const r = render('x', doc(p('{{first_name}}')), { first_name: '<img src=x onerror=alert(1)> {{email}}', email: 'secret@x.com' });
    expect(r.bodyHtml).not.toContain('<img');
    expect(r.bodyHtml).toContain('&lt;img');
    expect(r.bodyHtml).not.toContain('secret@x.com');
  });

  it('strips CR/LF from the subject (header injection)', () => {
    const r = render('Hi {{first_name}}', doc(p('x')), { first_name: 'A\r\nBcc: evil@x.com' });
    expect(r.subject).not.toMatch(/[\r\n]/);
  });

  it('extracts tokens with fallbacks', () => {
    expect(extractTokens('a {{ first_name }} b {{team|Unknown}}')).toEqual([{ name: 'first_name', fallback: undefined }, { name: 'team', fallback: 'Unknown' }]);
  });

  it('normalizes CSV headers into variable keys', () => {
    expect(normalizeKey('Team Name')).toBe('team_name');
    expect(normalizeKey(' 2nd Choice ')).toBe('f_2nd_choice');
    expect(normalizeKey('!!!')).toBe('');
  });
});

describe('conditional messaging', () => {
  const block = cond(
    branch(eq('selection_status', 'Selected'), p('Congratulations! You have been selected for the team.')),
    branch(eq('selection_status', 'Waitlisted'), p('You have been placed on our waitlist.')),
    branch(eq('selection_status', 'Rejected'), p('Thank you for participating.')),
  );
  const d = doc(p('Hi'), block);

  it('shows exactly the branch for each recipient', () => {
    const sel = render('s', d, { selection_status: 'Selected' });
    const wl = render('s', d, { selection_status: 'Waitlisted' });
    const rej = render('s', d, { selection_status: 'Rejected' });
    expect(sel.bodyHtml).toContain('Congratulations'); expect(sel.bodyHtml).not.toContain('waitlist');
    expect(wl.bodyHtml).toContain('waitlist'); expect(wl.bodyHtml).not.toContain('Congratulations');
    expect(rej.bodyHtml).toContain('Thank you'); expect(rej.bodyHtml).not.toContain('waitlist');
    expect(sel.branches[0]).toMatch(/branch 1/);
  });

  it('is case-insensitive and trims', () => {
    expect(render('s', d, { selection_status: '  selected ' }).bodyHtml).toContain('Congratulations');
  });

  it('missing condition field: falls to the otherwise branch, or shows nothing, with a warning', () => {
    const withElse = doc(cond(branch(eq('selection_status', 'Selected'), p('YES')), branch(null, p('ELSE'))));
    const r = render('s', withElse, {}, { known: new Set([...KNOWN]) });
    expect(r.bodyHtml).toContain('ELSE');
    const none = render('s', d, {}, { known: new Set([...KNOWN]) });
    expect(none.bodyHtml).not.toContain('Congratulations');
    const unknownField = render('s', doc(cond(branch(eq('never_provided', 'x'), p('A')), branch(null, p('B')))), {}, { known: new Set(KNOWN) });
    expect(unknownField.issues.some(i => i.code === 'unknown_condition_field')).toBe(true);
    expect(unknownField.ok).toBe(true); // a warning, not a blocker
  });

  it('multiple matching branches: the first match wins', () => {
    const multi = doc(cond(
      branch({ match: 'any', rules: [{ field: 'selection_status', op: 'contains', value: 'sel' }] }, p('FIRST')),
      branch(eq('selection_status', 'Selected'), p('SECOND')),
    ));
    const r = render('s', multi, { selection_status: 'Selected' });
    expect(r.bodyHtml).toContain('FIRST');
    expect(r.bodyHtml).not.toContain('SECOND');
  });

  it('fallback ("otherwise") branch catches everyone else', () => {
    const f = doc(cond(branch(eq('selection_status', 'Selected'), p('YES')), branch(null, p('NOT SELECTED'))));
    expect(render('s', f, { selection_status: 'Rejected' }).bodyHtml).toContain('NOT SELECTED');
  });

  it('conditions can switch the subject', () => {
    const subject: SubjectConfig = {
      default: 'Update on {{result}}',
      variants: [{ when: eq('selection_status', 'Selected'), subject: "Congratulations! You're selected" }],
    };
    expect(render(subject, d, { selection_status: 'Selected', result: 'x' }).subject).toBe("Congratulations! You're selected");
    expect(render(subject, d, { selection_status: 'Rejected', result: 'x' }).subject).toBe('Update on x');
  });

  it('controls buttons, links and images too', () => {
    const rich = doc(cond(branch(eq('selection_status', 'Selected'),
      { type: 'button', attrs: { label: 'Accept', href: 'https://x.test/accept' } },
      { type: 'image', attrs: { src: 'https://x.test/a.png', alt: 'badge' } })));
    const yes = render('s', rich, { selection_status: 'Selected' });
    expect(yes.bodyHtml).toContain('https://x.test/accept');
    expect(yes.bodyHtml).toContain('<img');
    expect(render('s', rich, { selection_status: 'Rejected' }).bodyHtml).toBe('');
  });

  it('supports every operator', () => {
    const ev = (op: string, value: string | string[] | undefined, v: string | number | null) => {
      const issues: Issue[] = [];
      return evaluateCondition({ match: 'all', rules: [{ field: 'x', op: op as 'equals', value }] }, { x: v }, issues);
    };
    expect(ev('equals', 'a', 'A')).toBe(true);
    expect(ev('not_equals', 'a', 'b')).toBe(true);
    expect(ev('contains', 'ell', 'Hello')).toBe(true);
    expect(ev('not_contains', 'zz', 'Hello')).toBe(true);
    expect(ev('is_empty', undefined, '')).toBe(true);
    expect(ev('is_empty', undefined, null)).toBe(true);
    expect(ev('is_not_empty', undefined, 'x')).toBe(true);
    expect(ev('gt', '10', 11)).toBe(true);
    expect(ev('lt', '10', '9')).toBe(true);
    expect(ev('gt', '10', 'abc')).toBe(false);
    expect(ev('one_of', 'a, b ,c', 'B')).toBe(true);
    expect(ev('one_of', ['a', 'b'], 'z')).toBe(false);
  });

  it('match=all vs any', () => {
    const issues: Issue[] = [];
    const rules = [{ field: 'a', op: 'equals' as const, value: '1' }, { field: 'b', op: 'equals' as const, value: '2' }];
    expect(evaluateCondition({ match: 'all', rules }, { a: '1', b: '3' }, issues)).toBe(false);
    expect(evaluateCondition({ match: 'any', rules }, { a: '1', b: '3' }, issues)).toBe(true);
  });

  it('rejects invalid operators and malformed conditions (no eval, no code)', () => {
    const bad = doc(cond(branch({ match: 'all', rules: [{ field: 'selection_status', op: 'matches_regex', value: '.*' }] } as unknown as Condition, p('X'))));
    const issues = validateTemplate({ default: 's' }, bad, KNOWN);
    expect(issues.some(i => i.code === 'invalid_operator')).toBe(true);
    const r = render('s', bad, { selection_status: 'Selected' });
    expect(r.ok).toBe(false);
    expect(r.bodyHtml).not.toContain('X');

    const code = doc(cond(branch({ match: 'all', rules: [{ field: 'process.exit(1)', op: 'equals', value: 'x' }] } as unknown as Condition, p('X'))));
    expect(validateTemplate({ default: 's' }, code, KNOWN).some(i => i.code === 'invalid_condition')).toBe(true);
    expect(validateTemplate({ default: 's' }, doc(cond(branch({} as unknown as Condition, p('X')))), KNOWN).some(i => i.code === 'invalid_condition')).toBe(true);
  });

  it('allows nesting up to a safe depth, no deeper', () => {
    const level = (inner: DocNode): DocNode => cond(branch(eq('selection_status', 'Selected'), inner));
    const ok = doc(level(level(level(p('deep')))));
    expect(render('s', ok, { selection_status: 'Selected' }).bodyHtml).toContain('deep');
    const tooDeep = doc(level(level(level(level(p('deeper'))))));
    expect(validateTemplate({ default: 's' }, tooDeep, KNOWN).some(i => i.code === 'too_deep')).toBe(true);
    expect(render('s', tooDeep, { selection_status: 'Selected' }).ok).toBe(false);
  });
});

describe('safe HTML generation', () => {
  it('drops unsupported nodes and never emits script, handlers or javascript: URLs', () => {
    const nasty = doc(
      { type: 'script', content: [t('alert(1)')] },
      p(t('click', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
      p(t('<script>alert(2)</script>')),
      { type: 'image', attrs: { src: 'http://insecure.test/a.png' } },
      { type: 'button', attrs: { label: 'Go', href: 'data:text/html,hi' } },
      p(t('styled', [{ type: 'textStyle', attrs: { color: 'red;background:url(x)' } }])),
    );
    const r = render('s', nasty, {});
    expect(r.bodyHtml).not.toMatch(/<script|javascript:|onerror|data:text|http:\/\/insecure|url\(x\)/i);
    expect(r.bodyHtml).toContain('&lt;script&gt;');
    expect(r.ok).toBe(false); // unsafe URLs are errors
    expect(r.issues.some(i => i.code === 'unsafe_url')).toBe(true);
    expect(r.issues.some(i => i.code === 'unsupported_node')).toBe(true);
  });

  it('URL-encodes variable values placed inside links', () => {
    const d = doc(p(t('go', [{ type: 'link', attrs: { href: 'https://x.test/?e={{email}}' } }])));
    const r = render('s', d, { email: 'a b&c=d@x.com' });
    expect(r.bodyHtml).toContain('https://x.test/?e=a%20b%26c%3Dd%40x.com');
  });

  it('renders headings, lists, marks and alignment', () => {
    const d = doc(
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [t('Title')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one', [{ type: 'bold' }]))] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [p('two')] }] },
      p(t('c', [{ type: 'textStyle', attrs: { color: '#ff0000' } }, { type: 'underline' }, { type: 'italic' }])),
    );
    const r = render('s', d, {});
    expect(r.bodyHtml).toContain('<h2 style="margin:0 0 14px;font-size:21px;line-height:1.3;text-align:center;">');
    expect(r.bodyHtml).toContain('<ul');
    expect(r.bodyHtml).toContain('<strong>one</strong>');
    expect(r.bodyHtml).toContain('<ol');
    expect(r.bodyHtml).toContain('color:#ff0000');
    expect(r.text).toContain('• one');
  });

  it('is deterministic (same input → same hash)', () => {
    const a = render('s {{first_name}}', doc(p('x {{first_name}}')), { first_name: 'A' });
    const b = render('s {{first_name}}', doc(p('x {{first_name}}')), { first_name: 'A' });
    expect(a.hash).toBe(b.hash);
  });
});

describe('recipient parsing', () => {
  it('splits commas, semicolons, spaces and newlines; reports invalid tokens', () => {
    const { entries, invalid } = parseEmailList('a@x.com, b@x.com;c@x.com d@x.com\ne@x.com  not-an-email  f@@x.com');
    expect(entries.map(e => e.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com']);
    expect(invalid).toEqual(['not-an-email', 'f@@x.com']);
  });

  it('keeps names from "Name <email>" and quoted forms', () => {
    const { entries } = parseEmailList('Asha Rao <asha@x.com>, "Bo, Li" <bo@x.com>, plain@x.com');
    expect(entries).toEqual([
      { email: 'asha@x.com', name: 'Asha Rao' },
      { email: 'bo@x.com', name: 'Bo, Li' },
      { email: 'plain@x.com' },
    ]);
  });
});

describe('CSV import', () => {
  const csv = 'name,email,team,result,role\nXYZ,xyz@red.iit.ac.in,Animation,Selected,3D Animator\nABC,abc@red.iit.ac.in,Design,Selected,Illustrator\nPQR,pqr@red.iit.ac.in,Animation,Waitlisted,Animator\n';

  it('parses quotes, embedded commas/newlines, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","line1\nline2"\r\n"he said ""hi""",z\r\n')).toEqual([
      ['a', 'b'], ['x, y', 'line1\nline2'], ['he said "hi"', 'z'],
    ]);
  });

  it('suggests a mapping and builds a validated preview', () => {
    const prev = buildCsvPreview(csv);
    expect(prev.headers).toEqual(['name', 'email', 'team', 'result', 'role']);
    expect(prev.suggestedMapping.email).toBe('email');
    expect(prev.suggestedMapping.name).toBe('name');
    expect(prev.suggestedMapping.fields?.map(f => f.key)).toEqual(['team', 'result', 'role']);
    expect(prev.rows[2]).toMatchObject({ email: 'pqr@red.iit.ac.in', name: 'PQR', data: { team: 'Animation', result: 'Waitlisted', role: 'Animator' }, status: 'ok' });
    expect(prev.summary).toEqual({ ok: 3, invalid: 0, duplicates: 0, withMissingValues: 0 });
  });

  it('detects duplicates, invalid and missing emails, and empty values', () => {
    const prev = buildCsvPreview('Name,E-mail,Team\nA,a@x.com,Design\nB,A@X.com,Design\nC,not-email,Design\nD,,Design\nE,e@x.com,\n');
    expect(prev.rows.map(r => r.status)).toEqual(['ok', 'duplicate', 'invalid_email', 'missing_email', 'ok']);
    expect(prev.rows[4].warnings).toContain('team is empty');
    expect(prev.summary).toMatchObject({ ok: 2, invalid: 2, duplicates: 1, withMissingValues: 1 });
  });

  it('honours a custom column mapping', () => {
    const prev = buildCsvPreview('Who,Addr,Squad\nA,a@x.com,Red\n', { email: 'Addr', name: 'Who', fields: [{ column: 'Squad', key: 'Team Name' }] });
    expect(prev.rows[0]).toMatchObject({ email: 'a@x.com', name: 'A', data: { team_name: 'Red' } });
  });

  it('rejects empty files', () => {
    expect(() => buildCsvPreview('')).toThrow();
  });
});

describe('webhook signature (Svix scheme)', () => {
  const secretBytes = crypto.randomBytes(24);
  const secret = `whsec_${secretBytes.toString('base64')}`;
  const sign = (id: string, ts: string, body: string) => `v1,${crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64')}`;
  const now = 1_700_000_000_000;
  const ts = String(now / 1000);

  it('accepts a correct signature and rejects tampering, bad secret and stale timestamps', () => {
    const body = '{"type":"email.delivered"}';
    expect(verifySvixSignature(body, { id: 'm1', timestamp: ts, signature: sign('m1', ts, body) }, secret, now)).toBe(true);
    expect(verifySvixSignature(body + ' ', { id: 'm1', timestamp: ts, signature: sign('m1', ts, body) }, secret, now)).toBe(false);
    expect(verifySvixSignature(body, { id: 'm1', timestamp: ts, signature: sign('m1', ts, body) }, `whsec_${crypto.randomBytes(24).toString('base64')}`, now)).toBe(false);
    expect(verifySvixSignature(body, { id: 'm1', timestamp: ts, signature: sign('m1', ts, body) }, secret, now + 10 * 60_000)).toBe(false);
    expect(verifySvixSignature(body, { id: 'm1', timestamp: ts }, secret, now)).toBe(false);
    expect(verifySvixSignature(body, { id: 'm1', timestamp: ts, signature: `v1,bogus ${sign('m1', ts, body)}` }, secret, now)).toBe(true);
  });
});

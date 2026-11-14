import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { setEmailProvider, type EmailProvider, type ProviderEmail, type ProviderResult } from '../src/services/emailCentre/provider';
import { processQueue } from '../src/services/emailCentre/service';
import { seedSystemTemplates } from '../src/services/emailCentre/store';
import { SEED_DESIGN, SEED_TEMPLATES } from '../src/services/emailCentre/templateSeeds';
import { dnaShell, DNA_COLORS } from '../src/services/emailCentre/emailShell';
import { renderOtpHtml } from '../src/services/mailer';
import type { DocNode } from '../src/services/emailCentre/engine';

process.env.EMAIL_CENTRE_AUTO_PROCESS = 'false';
process.env.EMAIL_CENTRE_RATE_MULTIPLIER = '1000';

const app = createApp();
const request = localRequest(app);
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

class Fake implements EmailProvider {
  calls: ProviderEmail[] = [];
  async send(e: ProviderEmail): Promise<ProviderResult> { this.calls.push(e); return { ok: true, id: `re_${crypto.randomUUID().slice(0, 10)}` }; }
}
let fake: Fake;
beforeAll(async () => { token = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token; });
beforeEach(() => { fake = new Fake(); setEmailProvider(fake); });
afterEach(async () => { setEmailProvider(null); await query('DELETE FROM ec_messages'); });

// The test database persists between runs: put a built-in back to its pristine seeded state.
async function resetBuiltIn(id: string) {
  const seed = SEED_TEMPLATES.find(x => x.id === id)!;
  await query('DELETE FROM ec_template_versions WHERE template_id=$1 AND version>1', [id]);
  await query(`UPDATE ec_template_versions SET subject_config=$2::jsonb, doc=$3::jsonb, settings=$4::jsonb WHERE template_id=$1 AND version=1`,
    [id, JSON.stringify(seed.subject), JSON.stringify(seed.doc), JSON.stringify({ ...seed.settings, design: SEED_DESIGN })]);
  await query('UPDATE ec_templates SET current_version=1 WHERE id=$1', [id]);
}

// The test database persists between runs, so start (and finish) with every built-in pristine.
beforeAll(async () => { for (const sd of SEED_TEMPLATES) await resetBuiltIn(sd.id); });
afterAll(async () => { for (const sd of SEED_TEMPLATES) await resetBuiltIn(sd.id); });

const CUP_ID = 'tpl_selection_digital_arts_cup';
const getTpl = async (id: string) => (await request(app).get(`/api/email/templates/${id}`).set(auth())).body;
const payloadFrom = (t: { body: { subject: unknown; doc: unknown; mode: string; settings: { shell?: string; sharedData?: Record<string, string>; shellOptions?: unknown } } }, recipients: unknown[]) => ({
  mode: t.body.mode, subject: t.body.subject, doc: t.body.doc, recipients, groups: [], cc: [], bcc: [],
  sharedData: {}, fallbacks: {}, shell: t.body.settings.shell ?? 'dna', shellOptions: t.body.settings.shellOptions ?? null, attachmentIds: [],
});

describe('DNA email shell', () => {
  const html = dnaShell('<p>BODY</p>');
  it('is a table-based, inline-styled, complete document in the DNA palette', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    for (const c of [DNA_COLORS.backdrop, DNA_COLORS.frame, DNA_COLORS.paper]) expect(html).toContain(c);
    expect(html).toContain('iit_kanpur');
    expect(html).toContain('Get creative.');
    expect(html).toContain('designed by venugopal');
    expect(html).toContain("'Helvetica Neue',Helvetica,Arial,sans-serif");
    expect(html).toContain('<p>BODY</p>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('<!--[if mso]>');
    expect(html).not.toMatch(/display:\s*(flex|grid)|<script|<link /i);
  });
  it('keeps flat colour fallbacks (bgcolor) when the dot pattern/radius are unsupported', () => {
    expect(html).toContain(`bgcolor="${DNA_COLORS.paper}"`);
    expect(html).toContain(`bgcolor="${DNA_COLORS.frame}"`);
  });
  it('has a responsive width and a mobile refinement that is optional', () => {
    expect(html).toContain('max-width:520px');
    expect(html).toContain('width="100%"');
    expect(html).toContain('@media only screen and (max-width: 520px)');
    expect(html).toContain('name="viewport"');
  });
  it('places a test banner inside the paper, and escapes the title', () => {
    expect(dnaShell('x', { banner: '<b>TESTBANNER</b>', title: '<x>' })).toMatch(/iit_kanpur[\s\S]*TESTBANNER/);
    expect(dnaShell('x', { title: '<script>' })).not.toContain('<title><script>');
  });
});

describe('every built-in template uses the unified design', () => {
  it('renders each one cleanly (with sample data) in the DNA shell, keeping its own content', async () => {
    const list = (await request(app).get('/api/email/templates').set(auth())).body.templates as { id: string; name: string }[];
    expect(list.map(t => t.id)).toEqual(expect.arrayContaining(SEED_TEMPLATES.map(s => s.id)));
    expect(list).toHaveLength(9);
    for (const s of SEED_TEMPLATES.filter(x => x.id !== 'tpl_custom')) { // the blank starter has no subject by design
      const r = await request(app).get(`/api/email/templates/${s.id}/preview`).set(auth());
      expect(r.status, s.id).toBe(200);
      expect(r.body.ok, `${s.id}: ${JSON.stringify(r.body.issues)}`).toBe(true);
      // every template wears the DNA header + footer; the Cup customises their wording (tested below)
      expect(r.body.html, s.id).toContain(s.id === 'tpl_selection_digital_arts_cup' ? 'digital arts cup' : 'iit_kanpur');
      expect(r.body.html, s.id).toContain(s.id === 'tpl_selection_digital_arts_cup' ? 'All the best!' : 'Get creative.');
      expect(r.body.html, s.id).toContain('designed by venugopal');
      expect(r.body.html, s.id).toMatch(/#e64298|#e0f55b|#dced3e/); // DNA accent palette (CTA / highlight panels)
      expect(r.body.html, s.id).not.toMatch(/\{\{|missing⟩|display:\s*(flex|grid)/);
    }
  });

  it('is typography-led: no stacked coloured cards, at most one lime marker per email', async () => {
    for (const sd of SEED_TEMPLATES) {
      const r = await request(app).get(`/api/email/templates/${sd.id}/preview`).set(auth());
      const html = r.body.html as string;
      expect(JSON.stringify(sd.doc), sd.id).not.toContain('"callout"');
      expect((html.match(/background-color:#e0f55b/g) ?? []).length, sd.id).toBeLessThanOrEqual(1);
    }
  });

  it('keeps each template\'s purpose and variables (no generic welcome copy)', () => {
    const text = (id: string) => JSON.stringify(SEED_TEMPLATES.find(s => s.id === id)!);
    expect(text('tpl_event_selection')).toContain('{{team_name}}');
    expect(text('tpl_event_selection')).toContain('{{coordinator_name}}');
    expect(text('tpl_event_waitlist')).toContain('waitlist');
    expect(text('tpl_event_reminder')).toContain('{{event_venue}}');
    expect(text('tpl_new_event')).toContain('{{event_link}}');
    expect(text('tpl_artwork')).toContain('{{artist_name}}');
    for (const id of ['tpl_event_selection', 'tpl_event_waitlist', 'tpl_event_reminder', 'tpl_new_event', 'tpl_artwork', 'tpl_new_post']) {
      expect(text(id)).not.toContain('Design & Animation Club family');
    }
    expect(SEED_TEMPLATES.find(s => s.id === 'tpl_welcome')!.subject.default).toBe('Welcome to the Design & Animation Club, {{first_name}}!');
  });
});

describe('Digital Arts Cup selection template', () => {
  it('has the requested metadata and subject', async () => {
    const t = await getTpl(CUP_ID);
    expect(t.name).toBe('Digital Arts Cup — Inter IIT Cultural Meet 9.0 Selection');
    expect(t.category).toBe('selection');
    expect(t.body.mode).toBe('individual');
    expect(t.body.subject.default).toBe('Selection for Digital Arts Cup Contingent | Inter IIT Cultural Meet 9.0');
    const listed = (await request(app).get('/api/email/templates').set(auth())).body.templates.find((x: { id: string }) => x.id === CUP_ID);
    expect(listed).toMatchObject({ category: 'selection', mode: 'individual', subject: t.body.subject.default });
  });

  it('renders the official selection information intact, in an editorial layout, with nothing invented', async () => {
    const r = await request(app).get(`/api/email/templates/${CUP_ID}/preview`).set(auth());
    const body = (r.body.html as string).replace(/&#39;/g, "'");
    for (const s of ['Dear Aarav,', 'Congratulations!',
      'selected to represent IIT Kanpur in the Digital Arts Cup contingent for the Inter IIT Cultural Meet 9.0',
      'mandatory schedule', 'December 3 – 21', 'On-campus preparation, IIT Kanpur', 'December 3rd to December 21st',
      'December 25 – 29', 'Offline events, IIT Mandi',
      'IIT Mandi for the offline events scheduled from December 25th to December 29th',
      'All travel arrangements to and from IIT Mandi are being managed by the institute',
      'Further details regarding the travel itinerary and preparation schedule will be shared shortly.',
      'See you on campus,', 'The Coordinators', 'Design and Animation Club', 'Media and Cultural Council']) {
      expect(body, s).toContain(s);
    }
    // the headline is gone; the personalised greeting is the primary (h1) heading
    expect(body).not.toMatch(/YOU'RE IN|Digital Arts Cup · Inter IIT 9\.0/);
    expect(body).toMatch(/<h1 class="dna-h1"[^>]*>Dear Aarav,<\/h1>/);
    expect(body.indexOf('Dear Aarav,')).toBeLessThan(body.indexOf('Congratulations!'));
    // restrained: exactly one lime marker, quiet dividers, no stacked coloured cards or repeated labels
    expect((body.match(/background-color:#e0f55b/g) ?? []).length).toBe(1);
    expect((body.match(/height="1"/g) ?? []).length).toBe(2);
    expect(body).not.toMatch(/text-transform:uppercase|bgcolor="#222222"[^>]*border-radius:6px|bgcolor="#ffffff"/);
    // no invented logistics
    expect(body).not.toMatch(/reporting time|venue:|\b\d{1,2}:\d{2}\s?(am|pm)\b|dec(ember)? (1|2|30|31)\b/i);
  });

  it('known student: the name comes from the student record; manual override wins; the address is never mined', async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ('250123','u1',NOW()::text,'Aarav Sharma','aarav@iitk.ac.in')`);
    const t = await getTpl(CUP_ID);
    const send = await request(app).post('/api/email/send').set(auth()).send({
      idempotencyKey: `k-${crypto.randomUUID()}`,
      payload: payloadFrom(t, [
        { email: 'aarav@iitk.ac.in', source: 'student' },
        { email: 'meera.nair@example.com', name: 'Meera Nair', source: 'manual' },
        { email: 'john.smith@example.com', source: 'manual' },
      ]),
    });
    expect(send.status).toBe(202);
    await processQueue();
    const by = (e: string) => fake.calls.find(c => c.to[0] === e)!;
    expect(by('aarav@iitk.ac.in').html).toContain('Dear Aarav,');
    expect(by('meera.nair@example.com').html).toContain('Dear Meera,');
    // unknown email, no name → plain "Hello,", never a name mined from the address
    expect(by('john.smith@example.com').html).toContain('Hello,');
    expect(by('john.smith@example.com').html).not.toContain('Dear');
    expect(by('john.smith@example.com').html).not.toMatch(/John|Smith/);
    for (const c of fake.calls) expect(c.subject).toBe('Selection for Digital Arts Cup Contingent | Inter IIT Cultural Meet 9.0');
  });

  it('preview and the actual send are byte-identical (same pipeline), and the stored snapshot matches', async () => {
    const t = await getTpl(CUP_ID);
    const payload = payloadFrom(t, [{ email: 'x@example.com', name: 'Xena Y', source: 'manual' }]);
    const pv = await request(app).post('/api/email/preview').set(auth()).send({ payload, index: 0 });
    const send = await request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: `k-${crypto.randomUUID()}`, payload });
    await processQueue();
    expect(fake.calls[0].html).toBe(pv.body.html);
    const [job] = await query<{ rendered_html: string }>('SELECT rendered_html FROM ec_send_jobs WHERE message_id=$1', [send.body.messageId]);
    expect(job.rendered_html).toBe(fake.calls[0].html);
  });

  it('test-send uses the same design, with the test banner inside the paper', async () => {
    const t = await getTpl(CUP_ID);
    const r = await request(app).post('/api/email/test').set(auth()).send({ payload: payloadFrom(t, []), testEmail: 'me@example.com', useSample: true });
    expect(r.status).toBe(200);
    expect(fake.calls[0].html).toContain('TEST EMAIL');
    expect(fake.calls[0].html).toContain('digital arts cup');
    expect(fake.calls[0].to).toEqual(['me@example.com']);
  });

  it('has a plain-text alternative with the schedule', async () => {
    const t = await getTpl(CUP_ID);
    await request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: `k-${crypto.randomUUID()}`, payload: payloadFrom(t, [{ email: 'x@example.com', name: 'Xena', source: 'manual' }]) });
    await processQueue();
    expect(fake.calls[0].text).toContain('On-campus preparation, IIT Kanpur');
    expect(fake.calls[0].text).toContain('December 25th to December 29th');
  });
});

describe('Digital Arts Cup header row and footer', () => {
  const otpLabel = /font-family:monospace; font-size:16px; border-bottom:1\.5px solid #222; display:inline-block; margin-bottom:35px; color:#222; text-transform:lowercase;/;
  const labelOf = (html: string, text: string) => new RegExp(`<div class="dna-label" style="([^"]*)">${text}</div>`).exec(html)?.[1] ?? '';

  it('puts "digital arts cup" (left) and "inter iit 9.0" (right) on ONE row, directly above the greeting', async () => {
    const html = (await request(app).get(`/api/email/templates/${CUP_ID}/preview`).set(auth())).body.html as string;
    const row = /<table[^>]*>\s*<tr>\s*<td align="left"[^>]*>(.*?)<\/td>\s*<td align="right"[^>]*>(.*?)<\/td>\s*<\/tr><\/table>/s.exec(html);
    expect(row, 'header row').toBeTruthy();
    expect(row![1]).toContain('digital arts cup');
    expect(row![2]).toContain('inter iit 9.0');
    expect(html).not.toContain('iit_kanpur');
    expect(html.indexOf('inter iit 9.0')).toBeLessThan(html.indexOf('Dear Aarav,'));
  });

  it('both labels use exactly the OTP template\'s label styling (and match each other)', async () => {
    expect(renderOtpHtml('123456')).toMatch(otpLabel); // the reference itself
    const html = (await request(app).get(`/api/email/templates/${CUP_ID}/preview`).set(auth())).body.html as string;
    const l = labelOf(html, 'digital arts cup'); const r = labelOf(html, 'inter iit 9.0');
    expect(l).toBe(r);
    for (const part of ['font-family:monospace;', 'font-size:16px;', 'border-bottom:1.5px solid #222222;', 'display:inline-block;', 'color:#222222;', 'text-transform:lowercase;']) expect(l).toContain(part);
    expect(l).not.toMatch(/font-weight/); // same (normal) weight as the OTP label
    // the standard header on every other template uses the same label style
    const std = (await request(app).get('/api/email/templates/tpl_welcome/preview').set(auth())).body.html as string;
    expect(labelOf(std, 'iit_kanpur').replace(/margin:[^;]*;/, '')).toBe(l); // single-label header only adds its bottom margin
  });

  it('keeps both labels on one row on phones: nowrap + an equal, slightly smaller size on narrow screens', async () => {
    const html = (await request(app).get(`/api/email/templates/${CUP_ID}/preview`).set(auth())).body.html as string;
    expect(labelOf(html, 'digital arts cup')).toContain('white-space:nowrap');
    expect(html).toMatch(/@media only screen and \(max-width: 520px\)[\s\S]*\.dna-label \{ font-size: 13px !important; \}/);
  });

  it('footer says "All the best!" for this template only; "designed by venugopal" stays everywhere', async () => {
    const cup = (await request(app).get(`/api/email/templates/${CUP_ID}/preview`).set(auth())).body.html as string;
    expect(cup).toContain('All the best!');
    expect(cup).not.toContain('Get creative.');
    expect(cup).toContain('designed by venugopal');
    for (const sd of SEED_TEMPLATES.filter(x => x.id !== CUP_ID)) {
      const h = (await request(app).get(`/api/email/templates/${sd.id}/preview`).set(auth())).body.html as string;
      expect(h, sd.id).toContain('Get creative.');
      expect(h, sd.id).toContain('iit_kanpur');
      expect(h, sd.id).not.toContain('All the best!');
      expect(h, sd.id).toContain('designed by venugopal');
    }
  });

  it('the header/footer carry through to the real send and the test-send (same pipeline), and are escaped', async () => {
    const t = await getTpl(CUP_ID);
    const payload = payloadFrom(t, [{ email: 'x@example.com', name: 'Xena Y', source: 'manual' }]) as Record<string, unknown>;
    payload.shellOptions = t.body.settings.shellOptions;
    const pv = await request(app).post('/api/email/preview').set(auth()).send({ payload, index: 0 });
    await request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: `k-${crypto.randomUUID()}`, payload });
    await processQueue();
    expect(fake.calls[0].html).toBe(pv.body.html);
    expect(fake.calls[0].html).toContain('inter iit 9.0');
    expect(fake.calls[0].html).toContain('All the best!');
    const evil = dnaShell('x', { labelLeft: '<script>a</script>', labelRight: '"><b>', tagline: '<i>' });
    expect(evil).not.toMatch(/<script>a|<b>|<i>/);
  });
});

describe('callout block in the engine', () => {
  it('rejects unknown tones safely and keeps variables/conditions working inside panels', async () => {
    const doc: DocNode = { type: 'doc', content: [
      { type: 'callout', attrs: { tone: 'evil;background:url(x)', label: 'Hello {{first_name}}' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi {{first_name}}' }] }] },
      { type: 'conditionalBlock', content: [{ type: 'conditionalBranch', attrs: { when: { match: 'all', rules: [{ field: 'team_name', op: 'equals', value: 'Design' }] } }, content: [
        { type: 'callout', attrs: { tone: 'dark', label: '' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Design only' }] }] }] }] },
    ] };
    const base = { subject: { default: 's' }, mode: 'individual', doc };
    const mk = (team: string) => request(app).post('/api/email/preview').set(auth()).send({ payload: { ...base, recipients: [{ email: 'a@x.com', name: 'Asha', source: 'manual', data: { team_name: team } }], groups: [], cc: [], bcc: [], sharedData: {}, fallbacks: {}, shell: 'dna', attachmentIds: [] }, index: 0 });
    const d = (await mk('Design')).body; const o = (await mk('Other')).body;
    expect(d.html).toContain('HELLO'.toLowerCase() === 'x' ? '' : 'Hello Asha');
    expect(d.html).not.toContain('evil');
    expect(d.html).toContain('Design only');
    expect(o.html).not.toContain('Design only');
    expect(d.html).toContain('#e0f55b'); // unknown tone → safe default (highlight)
  });
});

describe('template upgrades never rewrite history', () => {
  beforeEach(async () => { await resetBuiltIn('tpl_welcome'); await resetBuiltIn('tpl_event_waitlist'); });
  afterEach(async () => { await resetBuiltIn('tpl_welcome'); await resetBuiltIn('tpl_event_waitlist'); });
  const OLD_DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'OLD DESIGN {{first_name}}' }] }] };

  it('appends version 2 to an untouched legacy built-in; v1 and sent messages stay byte-identical', async () => {
    // Simulate a production row seeded by PR #93: v1, no design marker.
    await query(`UPDATE ec_template_versions SET doc=$1::jsonb, settings='{}'::jsonb WHERE template_id='tpl_event_waitlist' AND version=1`, [JSON.stringify(OLD_DOC)]);
    const before = await getTpl('tpl_event_waitlist');
    const t = { body: { ...before.body, subject: { default: 'Hi {{first_name}}' } } };
    const sent = await request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: `k-${crypto.randomUUID()}`, payload: payloadFrom(t, [{ email: 'a@x.com', name: 'Asha', source: 'manual' }]) });
    const [snap] = await query<{ rendered_html: string }>('SELECT rendered_html FROM ec_send_jobs WHERE message_id=$1', [sent.body.messageId]);

    await seedSystemTemplates();
    await seedSystemTemplates(); // idempotent

    const after = await getTpl('tpl_event_waitlist');
    expect(after.currentVersion).toBe(2);
    expect((await query('SELECT 1 FROM ec_template_versions WHERE template_id=$1', ['tpl_event_waitlist']))).toHaveLength(2);
    const v1 = await request(app).get('/api/email/templates/tpl_event_waitlist?version=1').set(auth());
    expect(v1.body.body.doc).toEqual(OLD_DOC);
    expect(after.body.doc).toEqual(SEED_TEMPLATES.find(x => x.id === 'tpl_event_waitlist')!.doc); // the new design, appended
    expect(after.body.settings.design).toBe(SEED_DESIGN);
    const [snap2] = await query<{ rendered_html: string }>('SELECT rendered_html FROM ec_send_jobs WHERE message_id=$1', [sent.body.messageId]);
    expect(snap2.rendered_html).toBe(snap.rendered_html);
    expect(snap2.rendered_html).toContain('OLD DESIGN Asha');
  });

  it('never touches a built-in an admin has edited', async () => {
    const edited = { body: { mode: 'individual', subject: { default: 'Mine {{first_name}}' }, doc: OLD_DOC, settings: {} } };
    await query(`UPDATE ec_template_versions SET settings='{}'::jsonb WHERE template_id='tpl_welcome' AND version=1`);
    const put = await request(app).put('/api/email/templates/tpl_welcome').set(auth()).send(edited);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    await seedSystemTemplates();
    const t = await getTpl('tpl_welcome');
    expect(t.currentVersion).toBe(2);
    expect(t.body.doc).toEqual(OLD_DOC);
    expect(t.body.subject.default).toBe('Mine {{first_name}}');
  });
});

describe('unrelated email paths unchanged', () => {
  it('the OTP email is still the standalone legacy layout', () => {
    const html = renderOtpHtml('123456');
    expect(html).toContain('auth_request');
    expect(html).toContain('123456');
    expect(html).not.toContain('dna-paper');
  });
});

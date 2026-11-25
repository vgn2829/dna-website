import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query } from '../src/db/client';
import { setEmailProvider, type EmailProvider, type ProviderEmail, type ProviderResult } from '../src/services/emailCentre/provider';
import { processQueue, retryFailed } from '../src/services/emailCentre/service';
import { dnaShell } from '../src/services/emailCentre/emailShell';
import { renderOtpHtml } from '../src/services/mailer';

// Per-email footer controls (sign-off + design credit). NEVER sends real mail: a fake provider is installed.
process.env.EMAIL_CENTRE_AUTO_PROCESS = 'false';
process.env.EMAIL_CENTRE_RATE_MULTIPLIER = '1000';

const app = createApp();
const request = localRequest(app);
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

class Fake implements EmailProvider {
  calls: ProviderEmail[] = [];
  failAll = false;
  async send(e: ProviderEmail): Promise<ProviderResult> {
    this.calls.push(e);
    return this.failAll ? { ok: false, kind: 'rejected', message: 'no' } : { ok: true, id: `re_${crypto.randomUUID().slice(0, 10)}` };
  }
}
let fake: Fake;
beforeAll(async () => { token = (await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD })).body.token; });
beforeEach(() => { fake = new Fake(); setEmailProvider(fake); });
afterEach(async () => { setEmailProvider(null); await query('DELETE FROM ec_messages'); });

const SIGNOFF = 'All the best!';
const CREDIT = 'designed by venugopal';
const ON = { showSignoff: true, tagline: SIGNOFF, showCredit: true, credit: CREDIT };

const body = (shellOptions: unknown, extra: Record<string, unknown> = {}) => ({
  mode: 'individual', subject: { default: 'Hello {{first_name}}' },
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi {{first_name}}' }] }] },
  recipients: [{ email: 'a@x.com', name: 'Asha K', source: 'manual' }, { email: 'b@x.com', name: 'Bela K', source: 'manual' }],
  groups: [], cc: [], bcc: [], sharedData: {}, fallbacks: {}, shell: 'dna', shellOptions, attachmentIds: [], ...extra,
});
const preview = async (shellOptions: unknown) =>
  (await request(app).post('/api/email/preview').set(auth()).send({ payload: body(shellOptions), index: 0 })).body.html as string;

describe('dnaShell footer controls', () => {
  it('shows both the sign-off and the design credit when enabled', () => {
    const h = dnaShell('x', ON);
    expect(h).toContain(SIGNOFF); expect(h).toContain(CREDIT);
    expect(h).toContain('#dced3e'); // the lime frame is unchanged
  });
  it('removes each independently', () => {
    const noCredit = dnaShell('x', { ...ON, showCredit: false });
    expect(noCredit).toContain(SIGNOFF); expect(noCredit).not.toContain(CREDIT);
    const noSign = dnaShell('x', { ...ON, showSignoff: false });
    expect(noSign).not.toContain(SIGNOFF); expect(noSign).not.toContain('font-size:35px'); expect(noSign).toContain(CREDIT);
    const none = dnaShell('x', { ...ON, showSignoff: false, showCredit: false });
    expect(none).not.toContain('font-size:35px'); expect(none).not.toContain(CREDIT); expect(none).not.toContain('letter-spacing:0.5px');
  });
  it('renders custom text, escaped', () => {
    const h = dnaShell('x', { ...ON, tagline: 'DNA Coordinators', credit: 'by <b>me</b> & "co"' });
    expect(h).toContain('DNA Coordinators');
    expect(h).toContain('by &lt;b&gt;me&lt;/b&gt; &amp; &quot;co&quot;');
    expect(h).not.toContain('<b>me');
  });
  it('empty or whitespace text never creates an empty footer element', () => {
    const h = dnaShell('x', { ...ON, tagline: '   ', credit: '' });
    expect(h).not.toContain('font-size:35px'); expect(h).not.toContain('letter-spacing:0.5px');
    expect(h).not.toContain('Get creative.'); expect(h).not.toContain(CREDIT);
  });
  it('does not interpret footer text as recipient variables', async () => {
    const h = await preview({ ...ON, tagline: '{{first_name}}', credit: '{{first_name}}' });
    expect(h).toContain('{{first_name}}');
    expect(h).toContain('Hi Asha'); // the body is still personalised
  });
  it('legacy options (no footer controls) render byte-identically to before', () => {
    const legacy = dnaShell('x');
    expect(legacy).toContain('Get creative.'); expect(legacy).toContain(CREDIT);
    expect(dnaShell('x', { tagline: 'All the best!' })).toContain('All the best!');
    expect(dnaShell('x', { tagline: '' })).toContain('Get creative.'); // legacy empty still falls back
    expect(dnaShell('x', { showSignoff: null, showCredit: null, credit: null })).toBe(legacy);
  });
});

describe('every Email Centre path uses the configured footer', () => {
  const OFF = { showSignoff: false, tagline: 'Best regards,', showCredit: false, credit: CREDIT };
  const CUSTOM = { showSignoff: true, tagline: 'Best regards,', showCredit: false, credit: CREDIT };

  it('preview, test email, shared send and individual send render the same footer', async () => {
    const pv = await preview(CUSTOM);
    expect(pv).toContain('Best regards,'); expect(pv).not.toContain(CREDIT); expect(pv).not.toContain('All the best!');

    const t = await request(app).post('/api/email/test').set(auth()).send({ payload: { ...body(CUSTOM), attachmentIds: [] }, testEmail: 'me@x.com' });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    const testHtml = fake.calls.at(-1)!.html;
    expect(testHtml).toContain('Best regards,'); expect(testHtml).not.toContain(CREDIT);

    for (const mode of ['individual', 'normal'] as const) {
      fake.calls = [];
      const plain = { subject: { default: 'Hello' }, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi all' }] }] } };
      const r = await request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: `k-${crypto.randomUUID()}`, payload: body(CUSTOM, { mode, ...plain }) });
      expect(r.status, JSON.stringify(r.body)).toBe(202);
      await processQueue();
      expect(fake.calls.length).toBeGreaterThan(0);
      for (const c of fake.calls) { expect(c.html).toContain('Best regards,'); expect(c.html).not.toContain(CREDIT); }
    }
  });

  it('a different email keeps its own footer (no leakage between sends)', async () => {
    await request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: `k-${crypto.randomUUID()}`, payload: body(OFF) });
    await request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: `k-${crypto.randomUUID()}`, payload: body(ON) });
    await processQueue();
    const offs = fake.calls.filter(c => !c.html!.includes(SIGNOFF));
    const ons = fake.calls.filter(c => c.html!.includes(SIGNOFF));
    expect(offs).toHaveLength(2); expect(ons).toHaveLength(2);
    for (const c of offs) { expect(c.html).not.toContain(CREDIT); expect(c.html).not.toContain('Best regards,'); }
    for (const c of ons) expect(c.html).toContain(CREDIT);
  });

  it('a draft saves and restores the exact footer configuration; a later edit replaces it', async () => {
    const created = await request(app).post('/api/email/drafts').set(auth()).send(body(CUSTOM));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const got = await request(app).get(`/api/email/drafts/${created.body.id}`).set(auth());
    expect(got.body.payload.shellOptions).toMatchObject(CUSTOM);
    const upd = await request(app).patch(`/api/email/drafts/${created.body.id}`).set(auth()).send({ revision: got.body.revision, payload: body(OFF) });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    const again = await request(app).get(`/api/email/drafts/${created.body.id}`).set(auth());
    expect(again.body.payload.shellOptions).toMatchObject(OFF);
  });

  it('rejects over-long footer text', async () => {
    const r = await request(app).post('/api/email/preview').set(auth()).send({ payload: body({ ...ON, credit: 'x'.repeat(61) }), index: 0 });
    expect(r.status).toBe(400);
  });

  it('a retry resends the ORIGINAL footer snapshot', async () => {
    fake.failAll = true;
    const r = await request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: `k-${crypto.randomUUID()}`, payload: body(CUSTOM) });
    await processQueue();
    expect(fake.calls.length).toBeGreaterThan(0);
    fake.failAll = false; fake.calls = [];
    expect((await retryFailed(r.body.messageId)).requeued).toBeGreaterThan(0);
    await processQueue();
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const c of fake.calls) { expect(c.html).toContain('Best regards,'); expect(c.html).not.toContain(CREDIT); }
  });
});

describe('automated / OTP emails are protected', () => {
  it('the OTP email output is byte-identical to the pre-feature output (pinned hash) and keeps its own footer', () => {
    const html = renderOtpHtml('123456');
    expect(crypto.createHash('sha256').update(html).digest('hex'))
      .toBe('6c1172d51b1542dbd184b32ce2dd981d7364bd5f1080e17203fd9d98bfca3f17');
    expect(html).toContain('auth_request'); expect(html).toContain('123456');
    expect(html).toContain('designed by venugopal'); expect(html).toContain('Get creative');
    expect(html).not.toContain('dna-paper');
  });
  it('the OTP/automated mailer does not use the Email Centre shell at all', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../src/services/mailer.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/emailShell|dnaShell|emailCentre|showSignoff|showCredit/);
  });
});

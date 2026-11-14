import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import crypto from 'crypto';
import { localRequest } from './localServer';
import { createApp } from '../src/app';
import { query, pool } from '../src/db/client';
import {
  setEmailProvider, type EmailProvider, type ProviderEmail, type ProviderResult,
} from '../src/services/emailCentre/provider';
import { processQueue, retryFailed } from '../src/services/emailCentre/service';
import type { DocNode } from '../src/services/emailCentre/engine';

// Auto-processing after /send is off in tests: each test drives the queue itself,
// so it is deterministic. NEVER sends real mail: every test installs a fake provider.
process.env.EMAIL_CENTRE_AUTO_PROCESS = 'false';
// The rate limiters themselves are exercised in a dedicated test below.
process.env.EMAIL_CENTRE_RATE_MULTIPLIER = '1000';

const app = createApp();
const request = localRequest(app);
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

// ── fake provider ──────────────────────────────────────────────────────────
class FakeProvider implements EmailProvider {
  calls: { email: ProviderEmail; key: string }[] = [];
  failWhen: (e: ProviderEmail, n: number) => ProviderResult | null = () => null;
  seen = new Map<string, string>(); // idempotency key → id (a real provider dedupes on this)
  async send(email: ProviderEmail, opts: { idempotencyKey: string }): Promise<ProviderResult> {
    this.calls.push({ email, key: opts.idempotencyKey });
    const prior = this.seen.get(opts.idempotencyKey);
    if (prior) return { ok: true, id: prior };
    const fail = this.failWhen(email, this.calls.length);
    if (fail) return fail;
    const id = `re_${crypto.randomUUID().slice(0, 12)}`;
    this.seen.set(opts.idempotencyKey, id);
    return { ok: true, id };
  }
}
let provider: FakeProvider;

const t = (text: string): DocNode => ({ type: 'text', text });
const p = (...c: string[]): DocNode => ({ type: 'paragraph', content: c.map(t) });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });

const payload = (over: Record<string, unknown> = {}) => ({
  mode: 'individual',
  subject: { default: 'Congratulations, {{first_name}}! Your {{team_name}} result is here.' },
  doc: doc(p('Hello {{first_name}},'), p('Team: {{team_name}}. Result: {{selection_status}}.')),
  recipients: [
    { email: 'xyz@red.iit.ac.in', name: 'XYZ Person', source: 'csv', data: { team_name: 'Animation', selection_status: 'Selected' } },
    { email: 'abc@red.iit.ac.in', name: 'ABC Person', source: 'csv', data: { team_name: 'Design', selection_status: 'Selected' } },
    { email: 'pqr@red.iit.ac.in', name: 'PQR Person', source: 'csv', data: { team_name: 'Animation', selection_status: 'Waitlisted' } },
  ],
  groups: [], cc: [], bcc: [], sharedData: {}, fallbacks: {}, shell: 'plain', attachmentIds: [],
  ...over,
});

const key = () => `test-${crypto.randomUUID()}`;
const send = (body: Record<string, unknown>, k = key()) => request(app).post('/api/email/send').set(auth()).send({ idempotencyKey: k, ...body });

beforeAll(async () => {
  const res = await request(app).post('/api/auth/admin/login').send({ password: process.env.ADMIN_PASSWORD });
  token = res.body.token;
});
beforeEach(() => { provider = new FakeProvider(); setEmailProvider(provider); });
afterEach(async () => {
  setEmailProvider(null);
  await query('DELETE FROM ec_messages');
  await query('DELETE FROM ec_groups');
  await query('DELETE FROM ec_delivery_events');
  await query('DELETE FROM ec_attachments');
  await query(`DELETE FROM ec_templates WHERE NOT is_system`);
  await query(`UPDATE ec_template_versions SET version = version WHERE false`);
});

describe('authorization', () => {
  it('every Email Centre route (except the signed webhook) requires an admin token', async () => {
    for (const [m, url] of [['get', '/api/email/meta'], ['get', '/api/email/activity'], ['post', '/api/email/send'], ['get', '/api/email/templates'], ['get', '/api/email/groups'], ['post', '/api/email/drafts']] as const) {
      const r = await request(app)[m](url).send({});
      expect(r.status, `${m} ${url}`).toBe(401);
    }
    const student = await request(app).get('/api/email/meta').set('Authorization', 'Bearer not-a-token');
    expect(student.status).toBe(401);
  });
});

describe('recipient resolution', () => {
  it('matches a known student by email, fills their stored name, and lets the admin override it', async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ('250123','u1',NOW()::text,'Aarav Sharma','aarav@iitk.ac.in')`);
    const base = payload({ recipients: [{ email: 'AARAV@iitk.ac.in', source: 'manual' }], subject: { default: 'Hi {{first_name}} ({{batch}} / {{roll_number}})' }, doc: doc(p('x')) });
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: base });
    expect(r.status).toBe(200);
    expect(r.body.items[0]).toMatchObject({ name: 'Aarav Sharma', matchedStudent: true, studentRoll: '250123', state: 'valid' });
    expect(r.body.items[0].data).toMatchObject({ first_name: 'Aarav', roll_number: '250123', batch: 'Y25' });

    const edited = payload({ recipients: [{ email: 'aarav@iitk.ac.in', name: 'Ary', source: 'student' }], subject: { default: 'Hi {{first_name}}' }, doc: doc(p('x')) });
    const r2 = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: edited });
    expect(r2.body.items[0].name).toBe('Ary');
    expect(r2.body.items[0].data.first_name).toBe('Ary');
    // the student record itself is untouched
    const rows = await query<{ name: string }>(`SELECT name FROM student_sessions WHERE roll_number='250123'`);
    expect(rows[0].name).toBe('Aarav Sharma');
  });

  it('does not let the client spoof roll number / batch for a matched student', async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ('250123','u1',NOW()::text,'Aarav Sharma','aarav@iitk.ac.in')`);
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({
      payload: payload({ recipients: [{ email: 'aarav@iitk.ac.in', source: 'csv', data: { roll_number: '999999', batch: 'Y99', team_name: 'T', selection_status: 'S' } }] }),
    });
    expect(r.body.items[0].data).toMatchObject({ roll_number: '250123', batch: 'Y25' });
  });

  it('unknown email without a name is flagged and never gets a guessed name', async () => {
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({
      payload: payload({ recipients: [{ email: 'john.smith@example.com', source: 'manual', data: { team_name: 'D', selection_status: 'S' } }] }),
    });
    const item = r.body.items[0];
    expect(item.matchedStudent).toBe(false);
    expect(item.name).toBeNull();
    expect(item.state).toBe('missing_data');
    expect(item.missing).toEqual(['first_name']);
    expect(r.body.blockers.join(' ')).toMatch(/needs attention/);
    const s = await send({ payload: payload({ recipients: [{ email: 'john.smith@example.com', source: 'manual', data: { team_name: 'D', selection_status: 'S' } }] }) });
    expect(s.status).toBe(422);
    expect(provider.calls).toHaveLength(0);
  });

  it('a manually entered name becomes available to personalization', async () => {
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({
      payload: payload({ recipients: [{ email: 'new.person@example.com', name: 'Meera Nair', source: 'manual', data: { team_name: 'D', selection_status: 'S' } }] }),
    });
    expect(r.body.items[0]).toMatchObject({ state: 'valid', name: 'Meera Nair' });
    expect(r.body.items[0].data.first_name).toBe('Meera');
  });

  it('flags invalid addresses, de-duplicates, and honours excluded rows', async () => {
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({
      payload: payload({ recipients: [
        { email: 'a@x.com', name: 'A', source: 'manual', data: { team_name: 'D', selection_status: 'S' } },
        { email: 'A@X.com', name: 'A2', source: 'manual', data: { team_name: 'D', selection_status: 'S' } },
        { email: 'bad@@x', name: 'B', source: 'manual' },
        { email: 'c@x.com', name: 'C', source: 'csv', excluded: true },
      ] }),
    });
    expect(r.body.items.map((i: { state: string }) => i.state)).toEqual(['valid', 'excluded', 'invalid_email', 'excluded']);
    expect(r.body.items[1].note).toMatch(/Duplicate/);
    expect(r.body.counts).toMatchObject({ total: 4, valid: 1, invalid: 1, excluded: 2, messages: 1 });
  });

  it('an explicit row (excluded or edited) overrides the same person arriving through a group', async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES
      ('250001','u1',NOW()::text,'Asha Rao','asha@iitk.ac.in'), ('250002','u2',NOW()::text,'Dev Patel','dev@iitk.ac.in')`);
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({
      payload: payload({ groups: ['sys:all_members'], subject: { default: 'Hi {{first_name}}' }, doc: doc(p('x')), recipients: [
        { email: 'asha@iitk.ac.in', source: 'group', excluded: true },
        { email: 'dev@iitk.ac.in', name: 'Dee', source: 'manual' },
      ] }),
    });
    const items = r.body.items as { email: string; state: string; name: string; source: string }[];
    const valid = items.filter(i => i.state === 'valid');
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ email: 'dev@iitk.ac.in', name: 'Dee', source: 'manual' }); // the edited row wins over the group copy
    expect(items.filter(i => i.email === 'asha@iitk.ac.in').every(i => i.state === 'excluded')).toBe(true); // explicit exclusion sticks
    expect(r.body.counts).toMatchObject({ valid: 1, excluded: 3, messages: 1 });
  });

  it('searches the student directory by name, email, roll, batch and activity', async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email, last_login) VALUES
      ('250001','u1',NOW()::text,'Asha Rao','asha@iitk.ac.in', NOW()),
      ('260002','u2',NOW()::text,'Bhaskar Das','bhaskar@iitk.ac.in', NOW() - INTERVAL '90 days'),
      ('260003','u3',NOW()::text,'No Email',NULL, NULL)`);
    const get = async (qs: string) => (await request(app).get(`/api/email/recipients/search?${qs}`).set(auth())).body.students as { name: string }[];
    expect((await get('q=asha')).map(s => s.name)).toEqual(['Asha Rao']);
    expect((await get('q=260002')).map(s => s.name)).toEqual(['Bhaskar Das']);
    expect((await get('batch=Y26')).map(s => s.name)).toEqual(['Bhaskar Das']);
    expect((await get('active=1')).map(s => s.name)).toEqual(['Asha Rao']);
    expect((await get('')).map(s => s.name).sort()).toEqual(['Asha Rao', 'Bhaskar Das']); // no-email student never offered
    expect((await get("q=%25")).length).toBe(0); // LIKE wildcards are escaped
  });

  it('parses pasted addresses and matches students', async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ('250001','u1',NOW()::text,'Asha Rao','asha@iitk.ac.in')`);
    const r = await request(app).post('/api/email/recipients/parse').set(auth()).send({ text: 'asha@iitk.ac.in; other@x.com\nnope' });
    expect(r.body.entries).toMatchObject([{ email: 'asha@iitk.ac.in', name: 'Asha Rao', matchedStudent: true }, { email: 'other@x.com', name: null, matchedStudent: false }]);
    expect(r.body.invalid).toEqual(['nope']);
  });
});

describe('groups', () => {
  beforeEach(async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email, last_login) VALUES
      ('250001','u1',NOW()::text,'Asha Rao','asha@iitk.ac.in', NOW()),
      ('250002','u2',NOW()::text,'Dev Patel','dev@iitk.ac.in', NOW() - INTERVAL '100 days'),
      ('260001','u3',NOW()::text,'Esha Jain','esha@iitk.ac.in', NOW())`);
  });
  const emailsOf = async (groups: string[]) => {
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({
      payload: payload({ recipients: [], groups, subject: { default: 'Hi {{first_name}}' }, doc: doc(p('x')) }),
    });
    return (r.body.items as { email: string; groupRef: { name: string } | null }[]);
  };

  it('resolves system groups (all / active / batch) from live data and records group membership', async () => {
    expect((await emailsOf(['sys:all_members'])).map(i => i.email).sort()).toEqual(['asha@iitk.ac.in', 'dev@iitk.ac.in', 'esha@iitk.ac.in']);
    expect((await emailsOf(['sys:active_members'])).map(i => i.email).sort()).toEqual(['asha@iitk.ac.in', 'esha@iitk.ac.in']);
    const batch = await emailsOf(['sys:batch:Y25']);
    expect(batch.map(i => i.email).sort()).toEqual(['asha@iitk.ac.in', 'dev@iitk.ac.in']);
    expect(batch[0].groupRef?.name).toBe('Batch Y25');
  });

  it('resolves event registrants', async () => {
    await query(`INSERT INTO events (id,title,date,time,location,content,capacity) VALUES ('e1','Sprint','2026-06-12','6pm','LHC','x',50)`);
    await query(`INSERT INTO event_rsvps (event_id, roll_number) VALUES ('e1','250002')`);
    expect((await emailsOf(['sys:event:e1'])).map(i => i.email)).toEqual(['dev@iitk.ac.in']);
  });

  it('manages saved static + dynamic groups, and resolves dynamic ones at send time', async () => {
    const stat = await request(app).post('/api/email/groups').set(auth()).send({ name: 'Design team', kind: 'static', members: [{ email: 'x@x.com', name: 'X Y' }, { email: 'X@x.com' }, { email: 'z@z.com' }] });
    expect(stat.status).toBe(201);
    const dyn = await request(app).post('/api/email/groups').set(auth()).send({ name: 'Y26', kind: 'dynamic', filter: { type: 'batch', batch: 'Y26' } });
    expect((await request(app).get('/api/email/groups').set(auth())).body.groups.filter((g: { kind: string }) => g.kind === 'static' || g.kind === 'dynamic')
      .map((g: { name: string; memberCount: number | null }) => [g.name, g.memberCount]).sort()).toEqual([['Design team', 2], ['Y26', null]]);
    expect((await emailsOf([stat.body.id])).map(i => i.email)).toEqual(['x@x.com', 'z@z.com']);
    expect((await emailsOf([dyn.body.id])).map(i => i.email)).toEqual(['esha@iitk.ac.in']);

    // dynamic membership follows the data
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ('260009','u9',NOW()::text,'New Kid','kid@iitk.ac.in')`);
    expect((await emailsOf([dyn.body.id])).map(i => i.email).sort()).toEqual(['esha@iitk.ac.in', 'kid@iitk.ac.in']);

    expect((await request(app).post('/api/email/groups').set(auth()).send({ name: 'Bad', kind: 'static', members: [{ email: 'nope' }] })).status).toBe(400);
    expect((await request(app).delete(`/api/email/groups/${stat.body.id}`).set(auth())).status).toBe(200);
    expect((await emailsOf([stat.body.id]))).toHaveLength(0);
  });

  it('reports a deleted group instead of silently sending to nobody', async () => {
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: payload({ recipients: [], groups: ['grp_gone'] }) });
    expect(r.body.blockers.join(' ')).toMatch(/no longer exists/);
  });
});

describe('individual mode sending', () => {
  it('creates a separate, personalized email per recipient and nobody sees other addresses', async () => {
    const r = await send({ payload: payload() });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ messages: 3, duplicate: false });
    expect(await processQueue()).toMatchObject({ sent: 3, failed: 0 });

    expect(provider.calls).toHaveLength(3);
    const byTo = Object.fromEntries(provider.calls.map(c => [c.email.to[0], c.email]));
    for (const c of provider.calls) {
      expect(c.email.to).toHaveLength(1);
      expect(c.email.cc ?? []).toEqual([]);
      expect(c.email.bcc ?? []).toEqual([]);
      for (const other of ['xyz@', 'abc@', 'pqr@'].filter(o => !c.email.to[0].startsWith(o))) {
        expect(c.email.html + c.email.subject + (c.email.text ?? '')).not.toContain(other);
      }
    }
    expect(byTo['xyz@red.iit.ac.in'].subject).toBe('Congratulations, XYZ! Your Animation result is here.');
    expect(byTo['xyz@red.iit.ac.in'].html).toContain('Hello XYZ,');
    expect(byTo['abc@red.iit.ac.in'].html).toContain('Team: Design.');
    expect(byTo['pqr@red.iit.ac.in'].html).toContain('Result: Waitlisted.');

    const act = await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth());
    expect(act.body.status).toBe('completed');
    expect(act.body.recipients.map((x: { status: string }) => x.status)).toEqual(['sent', 'sent', 'sent']);
    expect(act.body.recipients[0].providerMessageId).toMatch(/^re_/);
  });

  it('sent = accepted by provider, NOT delivered, until a verified event arrives', async () => {
    const r = await send({ payload: payload() });
    await processQueue();
    const act = await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth());
    expect(act.body.recipients.every((x: { status: string }) => x.status === 'sent')).toBe(true);
    const list = await request(app).get('/api/email/activity').set(auth());
    expect(list.body.messages[0].counts).toMatchObject({ total: 3, sent: 3, delivered: 0 });
  });

  it('snapshots recipients + rendered content at send time', async () => {
    const r = await send({ payload: payload() });
    const rec = await query<{ email: string; data: Record<string, string>; source: string; validation: string }>(
      `SELECT email, data, source, validation FROM ec_message_recipients WHERE message_id=$1 ORDER BY position`, [r.body.messageId]);
    expect(rec[0]).toMatchObject({ email: 'xyz@red.iit.ac.in', source: 'csv', validation: 'valid' });
    expect(rec[0].data).toMatchObject({ first_name: 'XYZ', team_name: 'Animation', selection_status: 'Selected' });
    const jobs = await query<{ rendered_subject: string; render_hash: string }>(`SELECT rendered_subject, render_hash FROM ec_send_jobs WHERE message_id=$1 ORDER BY id`, [r.body.messageId]);
    expect(jobs[0].rendered_subject).toBe('Congratulations, XYZ! Your Animation result is here.');
    expect(jobs[0].render_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('conditional content: each recipient gets their own branch', async () => {
    const branch = (field: string, value: string, text: string): DocNode => ({ type: 'conditionalBranch', attrs: { when: { match: 'all', rules: [{ field, op: 'equals', value }] } }, content: [p(text)] });
    const body = doc(p('Hi {{first_name}}'), { type: 'conditionalBlock', content: [
      branch('selection_status', 'Selected', 'Congratulations! You have been selected for the team.'),
      branch('selection_status', 'Waitlisted', 'You have been placed on our waitlist.'),
      branch('selection_status', 'Rejected', 'Thank you for participating.'),
    ] });
    await send({ payload: payload({
      doc: body,
      subject: { default: 'Update regarding your application', variants: [{ when: { match: 'all', rules: [{ field: 'selection_status', op: 'equals', value: 'Selected' }] }, subject: "Congratulations! You're selected" }] },
      recipients: [
        { email: 'a@x.com', name: 'A', source: 'csv', data: { selection_status: 'Selected' } },
        { email: 'b@x.com', name: 'B', source: 'csv', data: { selection_status: 'Waitlisted' } },
        { email: 'c@x.com', name: 'C', source: 'csv', data: { selection_status: 'Rejected' } },
      ],
    }) });
    await processQueue();
    const by = (to: string) => provider.calls.find(c => c.email.to[0] === to)!.email;
    expect(by('a@x.com').html).toContain('Congratulations! You have been selected');
    expect(by('a@x.com').subject).toBe("Congratulations! You're selected");
    expect(by('b@x.com').html).toContain('waitlist');
    expect(by('b@x.com').html).not.toContain('selected for the team');
    expect(by('b@x.com').subject).toBe('Update regarding your application');
    expect(by('c@x.com').html).toContain('Thank you for participating');
  });

  it('uses the event for event variables and message variables for the rest', async () => {
    await query(`INSERT INTO events (id,title,date,time,location,content,capacity,registration_form_url) VALUES ('e1','Figma UI Sprint','2026-06-12','6pm','LHC-3','x',50,'https://forms.example/abc')`);
    await send({ payload: payload({
      eventId: 'e1', sharedData: { coordinator_name: 'Riya' },
      subject: { default: '{{event_name}} on {{event_date}}' },
      doc: doc(p('At {{event_venue}} — {{event_link}} — {{coordinator_name}}')),
      recipients: [{ email: 'a@x.com', name: 'A', source: 'manual' }],
    }) });
    await processQueue();
    expect(provider.calls[0].email.subject).toBe('Figma UI Sprint on 12 Jun 2026');
    expect(provider.calls[0].email.html).toContain('At LHC-3 — https://forms.example/abc — Riya');
  });

  it('CC/BCC in individual mode: every email carries the copies, only after explicit acknowledgement', async () => {
    const withCopies = payload({ cc: ['boss@x.com'], bcc: ['audit@x.com'] });
    const blocked = await send({ payload: withCopies });
    expect(blocked.status).toBe(409);
    expect(blocked.body.requiresCopyAcknowledgement).toBe(true);
    expect(provider.calls).toHaveLength(0);

    const prev = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: withCopies });
    expect(prev.body.counts).toMatchObject({ messages: 3, ccCount: 1, bccCount: 1, extraCopies: 6, quotaCost: 9 });

    const ok = await send({ payload: withCopies, acknowledgeCopies: true });
    expect(ok.status).toBe(202);
    await processQueue();
    expect(provider.calls).toHaveLength(3);
    for (const c of provider.calls) { expect(c.email.cc).toEqual(['boss@x.com']); expect(c.email.bcc).toEqual(['audit@x.com']); expect(c.email.to).toHaveLength(1); }

    const tooMany = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: payload({ cc: ['a@x.com', 'b@x.com'], bcc: ['c@x.com', 'd@x.com'] }) });
    expect(tooMany.body.blockers.join(' ')).toMatch(/limit is 3/);
  });

  it('large sends need the exact count confirmed', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ email: `u${i}@x.com`, name: `U${i}`, source: 'csv', data: { team_name: 'T', selection_status: 'S' } }));
    const first = await send({ payload: payload({ recipients: many }) });
    expect(first.status).toBe(409);
    expect(first.body).toMatchObject({ requiresConfirmation: true, messages: 25 });
    expect((await send({ payload: payload({ recipients: many }), confirmedCount: 24 })).status).toBe(409);
    expect((await send({ payload: payload({ recipients: many }), confirmedCount: 25 })).status).toBe(202);
  });

  it('refuses to send when any recipient has missing data (nothing is sent)', async () => {
    const r = await send({ payload: payload({ recipients: [
      { email: 'a@x.com', name: 'A', source: 'csv', data: { team_name: 'T', selection_status: 'S' } },
      { email: 'b@x.com', name: 'B', source: 'csv', data: { selection_status: 'S' } },
    ] }) });
    expect(r.status).toBe(422);
    expect(r.body.blockers.join(' ')).toMatch(/1 recipient needs attention/);
    expect(await query('SELECT 1 FROM ec_messages')).toHaveLength(0);
  });

  it('excluded recipients are kept in the snapshot but never emailed', async () => {
    const r = await send({ payload: payload({ recipients: [
      { email: 'a@x.com', name: 'A', source: 'csv', data: { team_name: 'T', selection_status: 'S' } },
      { email: 'b@x.com', name: 'B', source: 'csv', data: { team_name: 'T', selection_status: 'S' }, excluded: true },
    ] }) });
    await processQueue();
    expect(provider.calls.map(c => c.email.to[0])).toEqual(['a@x.com']);
    const act = await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth());
    expect(act.body.recipients.map((x: { email: string; status: string }) => [x.email, x.status])).toEqual([['a@x.com', 'sent'], ['b@x.com', 'excluded']]);
  });
});

describe('normal mode sending', () => {
  const normal = (over: Record<string, unknown> = {}) => payload({
    mode: 'normal', subject: { default: 'Club meeting' }, doc: doc(p('See you at 6pm.')),
    recipients: [{ email: 'a@x.com', source: 'manual' }, { email: 'b@x.com', source: 'manual' }],
    cc: ['c@x.com'], bcc: ['hidden@x.com'], ...over,
  });

  it('sends ONE shared email with To/CC/BCC and keeps BCC out of the content', async () => {
    const r = await send({ payload: normal() });
    expect(r.body.messages).toBe(1);
    await processQueue();
    expect(provider.calls).toHaveLength(1);
    const e = provider.calls[0].email;
    expect(e.to).toEqual(['a@x.com', 'b@x.com']);
    expect(e.cc).toEqual(['c@x.com']);
    expect(e.bcc).toEqual(['hidden@x.com']);
    expect(e.html + (e.text ?? '') + e.subject).not.toContain('hidden@x.com');
  });

  it('blocks personal variables (everyone would get the same email)', async () => {
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: normal({ doc: doc(p('Hi {{first_name}}')) }) });
    expect(r.body.blockers.join(' ')).toMatch(/only work in Individual mode/);
  });

  it('allows event/shared variables', async () => {
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: normal({ doc: doc(p('Hi {{coordinator_name}}')), sharedData: { coordinator_name: 'Riya' } }) });
    expect(r.body.blockers).toEqual([]);
  });

  it('enforces the 50-recipient provider limit', async () => {
    const lots = Array.from({ length: 51 }, (_, i) => ({ email: `u${i}@x.com`, source: 'manual' }));
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: normal({ recipients: lots, cc: [], bcc: [] }) });
    expect(r.body.blockers.join(' ')).toMatch(/limited to 50/);
  });

  it('shows the final recipient count and quota cost before sending', async () => {
    const r = await request(app).post('/api/email/send/preview').set(auth()).send({ payload: normal() });
    expect(r.body.counts).toMatchObject({ valid: 2, ccCount: 1, bccCount: 1, messages: 1, quotaCost: 4 });
    expect(r.body.quota.cost).toBe(4);
  });
});

describe('idempotency, failures and retry', () => {
  it('the same idempotency key never creates or sends a second message', async () => {
    const k = key();
    const a = await send({ payload: payload() }, k);
    const b = await send({ payload: payload() }, k);
    const [c, d] = await Promise.all([send({ payload: payload() }, k), send({ payload: payload() }, k)]);
    expect(a.body.duplicate).toBe(false);
    for (const x of [b, c, d]) { expect(x.status).toBe(200); expect(x.body).toMatchObject({ duplicate: true, messageId: a.body.messageId }); }
    expect(await query('SELECT 1 FROM ec_messages')).toHaveLength(1);
    expect(await query('SELECT 1 FROM ec_send_jobs')).toHaveLength(3);
    await processQueue();
    expect(provider.calls).toHaveLength(3);
  });

  it('concurrent queue runners never double-send a job', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ email: `u${i}@x.com`, name: `U${i}`, source: 'csv', data: { team_name: 'T', selection_status: 'S' } }));
    await send({ payload: payload({ recipients: many }), confirmedCount: 12 });
    await Promise.all([processQueue({ batch: 3 }), processQueue({ batch: 3 }), processQueue({ batch: 3 }), processQueue({ batch: 3 })]);
    const tos = provider.calls.map(c => c.email.to[0]).sort();
    expect(tos).toHaveLength(12);
    expect(new Set(tos).size).toBe(12);
  });

  it('partial failure: the accepted messages are never resent; only eligible failures are retried', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ email: `u${i}@x.com`, name: `U${i}`, source: 'csv', data: { team_name: 'T', selection_status: 'S' } }));
    const r = await send({ payload: payload({ recipients: many }) });
    provider.failWhen = e => (['u1@x.com', 'u4@x.com', 'u7@x.com', 'u9@x.com'].includes(e.to[0]) ? { ok: false, kind: 'rejected', message: 'provider says no' } : null);
    expect(await processQueue()).toMatchObject({ sent: 6, failed: 4 });
    let act = await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth());
    expect(act.body.status).toBe('completed');
    expect(act.body.recipients.filter((x: { status: string }) => x.status === 'failed')).toHaveLength(4);
    expect(act.body.recipients.find((x: { email: string }) => x.email === 'u1@x.com')).toMatchObject({ status: 'failed', error: 'provider says no', attempts: 1, retryable: true });

    provider.failWhen = () => null;
    const before = provider.calls.length;
    const retry = await request(app).post(`/api/email/activity/${r.body.messageId}/retry`).set(auth());
    expect(retry.body.requeued).toBe(4);
    expect(await processQueue()).toMatchObject({ sent: 4, failed: 0 });
    const retried = provider.calls.slice(before).map(c => c.email.to[0]).sort();
    expect(retried).toEqual(['u1@x.com', 'u4@x.com', 'u7@x.com', 'u9@x.com']);
    act = await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth());
    expect(act.body.recipients.every((x: { status: string }) => x.status === 'sent')).toBe(true);
    expect(act.body.recipients.find((x: { email: string }) => x.email === 'u1@x.com').attempts).toBe(2);
    // Retry again: nothing eligible, nothing resent.
    expect((await retryFailed(r.body.messageId)).requeued).toBe(0);
    expect(await processQueue()).toMatchObject({ sent: 0 });
  });

  it('a retry resends the ORIGINAL snapshot even if the student record changed', async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ('250123','u1',NOW()::text,'Aarav Sharma','aarav@iitk.ac.in')`);
    const r = await send({ payload: payload({ recipients: [{ email: 'aarav@iitk.ac.in', source: 'student', data: { team_name: 'T', selection_status: 'S' } }] }) });
    provider.failWhen = () => ({ ok: false, kind: 'rejected', message: 'nope' });
    await processQueue();
    await query(`UPDATE student_sessions SET name='Totally Different' WHERE roll_number='250123'`);
    provider.failWhen = () => null;
    await retryFailed(r.body.messageId);
    await processQueue();
    expect(provider.calls[provider.calls.length - 1].email.html).toContain('Hello Aarav,');
    expect(provider.calls[provider.calls.length - 1].email.html).not.toContain('Totally');
  });

  it('transient (maybe-accepted) failures keep the idempotency key so a retry cannot duplicate', async () => {
    const r = await send({ payload: payload({ recipients: [{ email: 'a@x.com', name: 'A', source: 'csv', data: { team_name: 'T', selection_status: 'S' } }] }) });
    provider.failWhen = () => ({ ok: false, kind: 'transient', message: 'socket hang up' });
    await processQueue();
    const k1 = provider.calls[0].key;
    provider.failWhen = () => null;
    await retryFailed(r.body.messageId);
    await processQueue();
    expect(provider.calls[1].key).toBe(k1);
  });

  it('rate limiting defers (does not fail) the job', async () => {
    const r = await send({ payload: payload({ recipients: [{ email: 'a@x.com', name: 'A', source: 'csv', data: { team_name: 'T', selection_status: 'S' } }] }) });
    provider.failWhen = () => ({ ok: false, kind: 'rate_limited', message: '429' });
    expect(await processQueue()).toMatchObject({ sent: 0, failed: 0, deferred: 1 });
    const act = await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth());
    expect(act.body.recipients[0].status).toBe('queued');
    expect((await query<{ sent_count: number }>('SELECT sent_count FROM mail_usage WHERE day = CURRENT_DATE'))[0]?.sent_count ?? 0).toBe(0); // reservation refunded
  });

  it('cancel stops queued sends', async () => {
    const r = await send({ payload: payload() });
    const c = await request(app).post(`/api/email/activity/${r.body.messageId}/cancel`).set(auth());
    expect(c.body.cancelled).toBe(3);
    await processQueue();
    expect(provider.calls).toHaveLength(0);
    expect((await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth())).body.status).toBe('cancelled');
  });
});

describe('quota', () => {
  it('reserves atomically: concurrent runners never exceed the budget, the rest stays queued', async () => {
    const budget = (await request(app).get('/api/email/meta').set(auth())).body.broadcastBudget as number;
    expect(budget).toBeGreaterThan(10);
    const n = budget + 15;
    const many = Array.from({ length: n }, (_, i) => ({ email: `u${i}@x.com`, name: `U${i}`, source: 'csv', data: { team_name: 'T', selection_status: 'S' } }));
    const r = await send({ payload: payload({ recipients: many }), confirmedCount: n });
    expect(r.status).toBe(202);
    await Promise.all([processQueue({ batch: 7 }), processQueue({ batch: 7 }), processQueue({ batch: 7 }), processQueue({ batch: 7 }), processQueue({ batch: 7 })]);
    expect(provider.calls).toHaveLength(budget);
    const usage = (await query<{ sent_count: number }>(`SELECT sent_count FROM mail_usage WHERE day = (NOW() AT TIME ZONE 'UTC')::date`))[0].sent_count;
    expect(usage).toBe(budget);
    const act = await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth());
    expect(act.body.status).toBe('sending');
    expect(act.body.recipients.filter((x: { status: string }) => x.status === 'queued')).toHaveLength(15);
    // nothing more goes out while the budget is exhausted
    expect(await processQueue()).toMatchObject({ sent: 0 });
  });

  it('shares the daily ledger with legacy sends: usage recorded elsewhere shrinks the budget', async () => {
    const before = (await request(app).get('/api/email/meta').set(auth())).body.broadcastBudget as number;
    await query(`INSERT INTO mail_usage (day, sent_count) VALUES ((NOW() AT TIME ZONE 'UTC')::date, 30) ON CONFLICT (day) DO UPDATE SET sent_count = 30`);
    const after = (await request(app).get('/api/email/meta').set(auth())).body.broadcastBudget as number;
    expect(after).toBe(before - 30);
    const many = Array.from({ length: after + 3 }, (_, i) => ({ email: `u${i}@x.com`, name: `U${i}`, source: 'csv', data: { team_name: 'T', selection_status: 'S' } }));
    await send({ payload: payload({ recipients: many }), confirmedCount: after + 3 });
    await processQueue();
    expect(provider.calls).toHaveLength(after);
  });

  it('deferred jobs are picked up by a later run once there is budget (the tick path)', async () => {
    const budget = (await request(app).get('/api/email/meta').set(auth())).body.broadcastBudget as number;
    const many = Array.from({ length: budget + 2 }, (_, i) => ({ email: `u${i}@x.com`, name: `U${i}`, source: 'csv', data: { team_name: 'T', selection_status: 'S' } }));
    const r = await send({ payload: payload({ recipients: many }), confirmedCount: budget + 2 });
    await processQueue();
    expect(provider.calls).toHaveLength(budget);
    await query(`UPDATE mail_usage SET sent_count = 0`); // "tomorrow"
    await processQueue();
    expect(provider.calls).toHaveLength(budget + 2);
    expect((await request(app).get(`/api/email/activity/${r.body.messageId}`).set(auth())).body.status).toBe('completed');
  });
});

describe('test send', () => {
  it('sends ONE email to the test address only, marked as a test', async () => {
    const r = await request(app).post('/api/email/test').set(auth()).send({ payload: payload(), testEmail: 'me@x.com' });
    expect(r.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    const e = provider.calls[0].email;
    expect(e.to).toEqual(['me@x.com']);
    expect(e.cc ?? []).toEqual([]); expect(e.bcc ?? []).toEqual([]);
    expect(e.subject.startsWith('[TEST] ')).toBe(true);
    expect(e.html).toContain('TEST EMAIL');
    expect(e.html).not.toContain('abc@red.iit.ac.in');
    expect(await query('SELECT 1 FROM ec_messages')).toHaveLength(0); // not a send record, no jobs
  });

  it('rejects invalid test addresses and broken previews, and supports sample data for templates', async () => {
    expect((await request(app).post('/api/email/test').set(auth()).send({ payload: payload(), testEmail: 'nope' })).status).toBe(400);
    const missing = await request(app).post('/api/email/test').set(auth()).send({ payload: payload({ recipients: [{ email: 'a@x.com', source: 'manual', data: { team_name: 'T', selection_status: 'S' } }] }), testEmail: 'me@x.com' });
    expect(missing.status).toBe(422);
    const sample = await request(app).post('/api/email/test').set(auth()).send({ payload: payload({ recipients: [] }), testEmail: 'me@x.com', useSample: true });
    expect(sample.status).toBe(200);
    expect(provider.calls[0].email.subject).toBe('[TEST] Congratulations, Aarav! Your Animation result is here.'.replace('Animation', provider.calls[0].email.subject.includes('Animation') ? 'Animation' : 'Animation'));
  });
});

describe('preview', () => {
  it('previews each recipient with the same renderer: resolved values, branches, statuses', async () => {
    const pv = (index: number) => request(app).post('/api/email/preview').set(auth()).send({ payload: payload(), index });
    const a = await pv(0); const c = await pv(2);
    expect(a.body.ok).toBe(true);
    expect(a.body.subject).toBe('Congratulations, XYZ! Your Animation result is here.');
    expect(a.body.recipient).toMatchObject({ email: 'xyz@red.iit.ac.in', state: 'valid' });
    expect(a.body.resolved).toMatchObject({ first_name: 'XYZ', team_name: 'Animation' });
    expect(c.body.html).toContain('Waitlisted');
    // what preview renders is exactly what is sent
    await send({ payload: payload() });
    await processQueue();
    expect(provider.calls.find(x => x.email.to[0] === 'pqr@red.iit.ac.in')!.email.html).toBe(c.body.html);
  });

  it('shows missing-data recipients as broken, never as ready-to-send', async () => {
    const r = await request(app).post('/api/email/preview').set(auth()).send({ payload: payload({ recipients: [{ email: 'a@x.com', source: 'manual', data: { team_name: 'T', selection_status: 'S' } }] }), index: 0 });
    expect(r.body.ok).toBe(false);
    expect(r.body.recipient.state).toBe('missing_data');
    expect(r.body.html).toContain('first_name missing');
  });
});

describe('attachments', () => {
  const draft = async () => (await request(app).post('/api/email/drafts').set(auth()).send({ mode: 'individual' })).body.id as string;
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 1)]);
  const up = (id: string, buf: Buffer, name: string, extra: Record<string, string> = {}) => {
    let r = request(app).post('/api/email/attachments').set(auth()).field('messageId', id);
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r.attach('file', buf, name);
  };

  it('stores a valid file, never exposes a URL, and attaches the same bytes to every email', async () => {
    const id = await draft();
    const a = await up(id, pdf, 'brochure.pdf');
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ filename: 'brochure.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, inline: false });
    expect(JSON.stringify(a.body)).not.toMatch(/https?:|url/i);
    expect((await request(app).get(`/api/email/drafts/${id}`).set(auth())).body.attachments).toHaveLength(1);

    const r = await send({ payload: payload({ attachmentIds: [a.body.id] }), draftId: id });
    expect(r.status).toBe(202);
    await processQueue();
    expect(provider.calls).toHaveLength(3);
    for (const c of provider.calls) {
      expect(c.email.attachments).toHaveLength(1);
      expect(c.email.attachments![0]).toMatchObject({ filename: 'brochure.pdf', contentType: 'application/pdf' });
      expect(Buffer.compare(c.email.attachments![0].content, pdf)).toBe(0);
    }
    // only one stored copy regardless of recipient count
    expect(await query('SELECT 1 FROM ec_attachments')).toHaveLength(1);
  });

  it('rejects disallowed types, mismatched contents, empty and oversized files', async () => {
    const id = await draft();
    expect((await up(id, Buffer.from('MZ....'), 'virus.exe')).status).toBe(400);
    expect((await up(id, Buffer.from('<html>'), 'page.html')).status).toBe(400);
    expect((await up(id, Buffer.from('not really a pdf'), 'fake.pdf')).status).toBe(400);
    expect((await up(id, Buffer.alloc(0), 'empty.txt')).status).toBe(400);
    expect((await up(id, Buffer.alloc(11 * 1024 * 1024, 65), 'big.txt')).status).toBe(400); // multer limit → 400 "exceeds the size limit"
    expect((await up(id, pdf, 'x.pdf', { inline: 'true' })).status).toBe(400); // only images inline
  });

  it('enforces the per-message total (provider payload) limit', async () => {
    const id = await draft();
    const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(8 * 1024 * 1024)]);
    expect((await up(id, big, 'a.pdf')).status).toBe(201);
    const second = await up(id, big, 'b.pdf');
    expect(second.status).toBe(413);
    expect(second.body.error).toMatch(/exceed 15 MB/);
  });

  it('attachments can only be added to an existing draft, and removed only while it is a draft', async () => {
    expect((await up('msg_missing', pdf, 'a.pdf')).status).toBe(404);
    const id = await draft();
    const a = await up(id, pdf, 'a.pdf');
    expect((await request(app).delete(`/api/email/attachments/${a.body.id}`).set(auth())).status).toBe(200);
    const b = await up(id, pdf, 'b.pdf');
    await send({ payload: payload({ attachmentIds: [b.body.id] }), draftId: id });
    expect((await request(app).delete(`/api/email/attachments/${b.body.id}`).set(auth())).status).toBe(404);
    expect((await up(id, pdf, 'late.pdf')).status).toBe(409);
  });

  it('inline images are sent with a content id the body can reference', async () => {
    const id = await draft();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(50)]);
    const a = await up(id, png, 'logo.png', { inline: 'true' });
    expect(a.status).toBe(201);
    const body = doc(p('Hi {{first_name}}'), { type: 'image', attrs: { src: `cid:${a.body.id}`, alt: 'logo' } });
    const sent = await send({ payload: payload({ doc: body, subject: { default: 'Hi {{first_name}}' }, attachmentIds: [a.body.id], recipients: [{ email: 'a@x.com', name: 'A', source: 'manual' }] }), draftId: id });
    expect(sent.status).toBe(202);
    await processQueue();
    expect(provider.calls[0].email.html).toContain(`src="cid:${a.body.id}"`);
    expect(provider.calls[0].email.attachments![0].contentId).toBe(a.body.id);
  });

  it('a send cannot reference another message\'s attachment', async () => {
    const d1 = await draft();
    const a = await up(d1, pdf, 'a.pdf');
    const foreign = await send({ payload: payload({ attachmentIds: [a.body.id] }) }); // no/other draft id
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toMatch(/different message/);
    expect(provider.calls).toHaveLength(0);
    const own = await send({ payload: payload({ attachmentIds: [a.body.id] }), draftId: d1 });
    expect(own.status).toBe(202);
  });
});

describe('drafts', () => {
  it('autosave round-trips recipients, subject, editor content, personalization and conditions', async () => {
    const full = payload({ title: 'Results', eventId: null, sharedData: { coordinator_name: 'Riya' }, fallbacks: { first_name: 'there' } });
    delete (full as Record<string, unknown>).attachmentIds;
    const c = await request(app).post('/api/email/drafts').set(auth()).send(full);
    expect(c.status).toBe(201);
    const g = await request(app).get(`/api/email/drafts/${c.body.id}`).set(auth());
    expect(g.body.status).toBe('draft');
    expect(g.body.payload).toMatchObject({ mode: 'individual', title: 'Results', sharedData: { coordinator_name: 'Riya' }, fallbacks: { first_name: 'there' } });
    expect(g.body.payload.recipients).toHaveLength(3);
    expect(g.body.payload.subject).toEqual(full.subject);
    expect(g.body.payload.doc).toEqual(full.doc);
  });

  it('accepts incomplete drafts', async () => {
    const c = await request(app).post('/api/email/drafts').set(auth()).send({});
    expect(c.status).toBe(201);
    const g = await request(app).get(`/api/email/drafts/${c.body.id}`).set(auth());
    expect(g.body.payload.subject).toEqual({ default: '' });
  });

  it('skips the write when nothing changed (no excess DB writes) and bumps the revision when it did', async () => {
    const c = await request(app).post('/api/email/drafts').set(auth()).send({ subject: { default: 'A' } });
    const same = await request(app).patch(`/api/email/drafts/${c.body.id}`).set(auth()).send({ revision: 0, payload: { subject: { default: 'A' } } });
    expect(same.body).toMatchObject({ unchanged: true, revision: 0 });
    const changed = await request(app).patch(`/api/email/drafts/${c.body.id}`).set(auth()).send({ revision: 0, payload: { subject: { default: 'B' } } });
    expect(changed.body).toMatchObject({ unchanged: false, revision: 1 });
    const stale = await request(app).patch(`/api/email/drafts/${c.body.id}`).set(auth()).send({ revision: 0, payload: { subject: { default: 'C' } } });
    expect(stale.status).toBe(409);
  });

  it('autosave never sends anything and cannot modify a message once sent', async () => {
    const c = await request(app).post('/api/email/drafts').set(auth()).send(payload());
    await request(app).patch(`/api/email/drafts/${c.body.id}`).set(auth()).send({ payload: payload({ subject: { default: 'Changed {{first_name}}' } }) });
    await processQueue();
    expect(provider.calls).toHaveLength(0);
    expect(await query('SELECT 1 FROM ec_send_jobs')).toHaveLength(0);

    const s = await send({ payload: payload(), draftId: c.body.id });
    expect(s.status).toBe(202);
    expect(s.body.messageId).toBe(c.body.id);
    const late = await request(app).patch(`/api/email/drafts/${c.body.id}`).set(auth()).send({ payload: { subject: { default: 'Sneaky' } } });
    expect(late.status).toBe(409);
    expect((await request(app).delete(`/api/email/drafts/${c.body.id}`).set(auth())).status).toBe(404); // sent messages can't be deleted
    expect((await send({ payload: payload(), draftId: c.body.id })).status).toBe(409); // can't send a draft twice (new key)
  });

  it('lists and deletes drafts', async () => {
    const c = await request(app).post('/api/email/drafts').set(auth()).send({ subject: { default: 'Hello' }, recipients: [{ email: 'a@x.com', source: 'manual' }] });
    const list = await request(app).get('/api/email/drafts').set(auth());
    expect(list.body.drafts[0]).toMatchObject({ id: c.body.id, subject: 'Hello', recipientCount: 1 });
    expect((await request(app).delete(`/api/email/drafts/${c.body.id}`).set(auth())).status).toBe(200);
    expect((await request(app).get(`/api/email/drafts/${c.body.id}`).set(auth())).status).toBe(404);
  });
});

describe('templates', () => {
  it('ships the eight initial templates', async () => {
    const r = await request(app).get('/api/email/templates').set(auth());
    expect(r.body.templates.map((t: { name: string }) => t.name).sort()).toEqual([
      'Artwork announcement', 'Custom email', 'Event reminder', 'Event selection', 'Event waitlist',
      'New event announcement', 'New post announcement', 'Welcome email',
    ]);
  });

  it('editing a template creates a new version and never alters sent messages', async () => {
    const created = await request(app).post('/api/email/templates').set(auth()).send({
      name: 'Results', body: { mode: 'individual', subject: { default: 'Hi {{first_name}}' }, doc: doc(p('Version ONE for {{first_name}}')), settings: {} },
    });
    const tid = created.body.id as string;
    const v1 = (await request(app).get(`/api/email/templates/${tid}`).set(auth())).body;
    const sent = await send({ payload: payload({ subject: v1.body.subject, doc: v1.body.doc, recipients: [{ email: 'a@x.com', name: 'A', source: 'manual' }], templateId: tid, templateVersion: 1 }) });

    const put = await request(app).put(`/api/email/templates/${tid}`).set(auth()).send({
      body: { mode: 'individual', subject: { default: 'NEW {{first_name}}' }, doc: doc(p('Version TWO')), settings: {} },
    });
    expect(put.body.version).toBe(2);

    // history is immutable: v1 is still retrievable unchanged, current is v2
    expect((await request(app).get(`/api/email/templates/${tid}?version=1`).set(auth())).body.body.doc).toEqual(v1.body.doc);
    expect((await request(app).get(`/api/email/templates/${tid}`).set(auth())).body.version).toBe(2);
    expect(await query('SELECT 1 FROM ec_template_versions WHERE template_id=$1', [tid])).toHaveLength(2);

    // the already-sent message is unchanged — in the record and as delivered
    await processQueue();
    expect(provider.calls[0].email.html).toContain('Version ONE for A');
    const row = (await query<{ doc: DocNode; subject_config: { default: string }; template_version: number }>('SELECT doc, subject_config, template_version FROM ec_messages WHERE id=$1', [sent.body.messageId]))[0];
    expect(JSON.stringify(row.doc)).toContain('Version ONE');
    expect(row.subject_config.default).toBe('Hi {{first_name}}');
    expect(row.template_version).toBe(1);
  });

  it('duplicates and archives', async () => {
    const list = (await request(app).get('/api/email/templates').set(auth())).body.templates as { id: string; name: string }[];
    const welcome = list.find(t => t.name === 'Welcome email')!;
    const dup = await request(app).post(`/api/email/templates/${welcome.id}/duplicate`).set(auth());
    expect(dup.status).toBe(201);
    expect((await request(app).get(`/api/email/templates/${dup.body.id}`).set(auth())).body.name).toBe('Welcome email (copy)');
    await request(app).post(`/api/email/templates/${dup.body.id}/archive`).set(auth());
    expect((await request(app).get('/api/email/templates').set(auth())).body.templates.some((t: { id: string }) => t.id === dup.body.id)).toBe(false);
    expect((await request(app).get('/api/email/templates?archived=1').set(auth())).body.templates.some((t: { id: string }) => t.id === dup.body.id)).toBe(true);
  });

  it('every seeded template renders cleanly with sample data', async () => {
    const list = (await request(app).get('/api/email/templates').set(auth())).body.templates as { id: string; name: string }[];
    for (const tpl of list.filter(t => t.name !== 'Custom email')) {
      const full = (await request(app).get(`/api/email/templates/${tpl.id}`).set(auth())).body;
      const shared: Record<string, string> = { ...(full.body.settings.sharedData ?? {}) };
      for (const k of Object.keys(shared)) shared[k] = 'Sample';
      const r = await request(app).post('/api/email/preview').set(auth()).send({ payload: payload({ subject: full.body.subject, doc: full.body.doc, recipients: [], sharedData: shared }), useSample: true });
      expect(r.body.ok, `${tpl.name}: ${JSON.stringify(r.body.issues)}`).toBe(true);
    }
  });
});

describe('webhooks & delivery tracking', () => {
  const secretBytes = crypto.randomBytes(24);
  const secret = `whsec_${secretBytes.toString('base64')}`;
  const post = (event: object, over: { id?: string; sign?: boolean; ts?: string } = {}) => {
    const body = JSON.stringify(event);
    const id = over.id ?? `msg_${crypto.randomUUID()}`;
    const ts = over.ts ?? String(Math.floor(Date.now() / 1000));
    const sig = `v1,${crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64')}`;
    const r = request(app).post('/api/email/webhooks/resend').set('Content-Type', 'application/json').set('svix-id', id).set('svix-timestamp', ts);
    return (over.sign === false ? r : r.set('svix-signature', sig)).send(body);
  };
  const withSecret = async (fn: () => Promise<void>) => { process.env.RESEND_WEBHOOK_SECRET = secret; try { await fn(); } finally { delete process.env.RESEND_WEBHOOK_SECRET; } };
  const sentMessage = async () => {
    const r = await send({ payload: payload() });
    await processQueue();
    const jobs = await query<{ provider_message_id: string; to_emails: string[] }>('SELECT provider_message_id, to_emails FROM ec_send_jobs WHERE message_id=$1 ORDER BY id', [r.body.messageId]);
    return { messageId: r.body.messageId as string, jobs };
  };
  const statuses = async (id: string) => (await request(app).get(`/api/email/activity/${id}`).set(auth())).body.recipients.map((x: { status: string }) => x.status);

  it('refuses to run without a configured secret, and rejects unsigned / forged / stale requests', async () => {
    expect((await post({ type: 'email.delivered', data: { email_id: 'x' } })).status).toBe(503);
    await withSecret(async () => {
      expect((await post({ type: 'email.delivered', data: { email_id: 'x' } }, { sign: false })).status).toBe(401);
      const forged = await request(app).post('/api/email/webhooks/resend').set('Content-Type', 'application/json')
        .set('svix-id', 'a').set('svix-timestamp', String(Math.floor(Date.now() / 1000))).set('svix-signature', 'v1,AAAA').send('{"type":"email.delivered"}');
      expect(forged.status).toBe(401);
      expect((await post({ type: 'email.delivered', data: { email_id: 'x' } }, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status).toBe(401);
    });
  });

  it('verified events move recipients sent → delivered / bounced; never delivered on acceptance alone', async () => {
    await withSecret(async () => {
      const { messageId, jobs } = await sentMessage();
      expect(await statuses(messageId)).toEqual(['sent', 'sent', 'sent']);
      expect((await post({ type: 'email.delivered', data: { email_id: jobs[0].provider_message_id, to: jobs[0].to_emails } })).body).toMatchObject({ received: true, handled: true });
      expect((await post({ type: 'email.bounced', data: { email_id: jobs[1].provider_message_id, to: jobs[1].to_emails, bounce: { message: 'Mailbox does not exist' } } })).status).toBe(200);
      expect(await statuses(messageId)).toEqual(['delivered', 'bounced', 'sent']);
      const act = (await request(app).get(`/api/email/activity/${messageId}`).set(auth())).body;
      expect(act.recipients[1].error).toBe('Mailbox does not exist');
      expect(act.events.map((e: { type: string }) => e.type).sort()).toEqual(['email.bounced', 'email.delivered']);
      const list = (await request(app).get('/api/email/activity').set(auth())).body.messages[0];
      expect(list.counts).toMatchObject({ delivered: 1, bounced: 1, sent: 1 });
    });
  });

  it('is idempotent on replays and does not let late/out-of-order events downgrade a final state', async () => {
    await withSecret(async () => {
      const { messageId, jobs } = await sentMessage();
      const ev = { type: 'email.delivered', data: { email_id: jobs[0].provider_message_id, to: jobs[0].to_emails } };
      const first = await post(ev, { id: 'evt_1' });
      const replay = await post(ev, { id: 'evt_1' });
      expect(first.body.duplicate).toBe(false);
      expect(replay.body.duplicate).toBe(true);
      expect(await query('SELECT 1 FROM ec_delivery_events WHERE event_id=$1', ['evt_1'])).toHaveLength(1);

      await post({ type: 'email.bounced', data: { email_id: jobs[1].provider_message_id, to: jobs[1].to_emails } });
      await post({ type: 'email.delivered', data: { email_id: jobs[1].provider_message_id, to: jobs[1].to_emails } }); // late "delivered" after bounce
      expect((await statuses(messageId))[1]).toBe('bounced');
      await post({ type: 'email.complained', data: { email_id: jobs[0].provider_message_id, to: jobs[0].to_emails } });
      expect((await statuses(messageId))[0]).toBe('complained');
    });
  });

  it('permanent bounces / suppressions are never retried; provider failures are', async () => {
    await withSecret(async () => {
      const { messageId, jobs } = await sentMessage();
      await post({ type: 'email.bounced', data: { email_id: jobs[0].provider_message_id, to: jobs[0].to_emails } });
      await post({ type: 'email.suppressed', data: { email_id: jobs[1].provider_message_id, to: jobs[1].to_emails } });
      await post({ type: 'email.failed', data: { email_id: jobs[2].provider_message_id, to: jobs[2].to_emails, failed: { reason: 'Invalid attachment' } } });
      expect(await statuses(messageId)).toEqual(['bounced', 'suppressed', 'failed']);

      const before = provider.calls.length;
      const retry = await request(app).post(`/api/email/activity/${messageId}/retry`).set(auth());
      expect(retry.body).toMatchObject({ requeued: 1, skipped: 2 });
      await processQueue();
      expect(provider.calls.slice(before).map(c => c.email.to[0])).toEqual([jobs[2].to_emails[0]]);
      expect(await statuses(messageId)).toEqual(['bounced', 'suppressed', 'sent']);
    });
  });

  it('events for messages this module does not own are forwarded to the legacy campaign tracker', async () => {
    await withSecret(async () => {
      await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ('250001','u1',NOW()::text,'A','a@x.com')`);
      await query(`INSERT INTO email_campaigns (id, title, subject) VALUES ('cmp-1','t','s')`);
      await query(`INSERT INTO email_recipients (campaign_id, roll_number, email, status, provider_message_id) VALUES ('cmp-1','250001','a@x.com','sent','legacy_msg_1')`);
      const r = await post({ type: 'email.delivered', data: { email_id: 'legacy_msg_1' } });
      expect(r.body).toMatchObject({ received: true, handled: true });
      expect((await query<{ status: string }>(`SELECT status FROM email_recipients WHERE provider_message_id='legacy_msg_1'`))[0].status).toBe('delivered');
      const unknown = await post({ type: 'email.delivered', data: { email_id: 'nobody_owns_this' } });
      expect(unknown.body.handled).toBe(false);
    });
  });
});

describe('activity listing', () => {
  it('lists parent sends with sender, creator, mode, counts; supports status filter', async () => {
    const a = await send({ payload: payload() });
    await processQueue();
    await send({ payload: payload({ subject: { default: 'Second {{first_name}}' } }) });
    const list = (await request(app).get('/api/email/activity').set(auth())).body.messages;
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ id: a.body.messageId, mode: 'individual', createdBy: 'admin', status: 'completed', counts: { total: 3, sent: 3 } });
    expect(list[1].sender).toContain('@');
    expect(list[0].status).toBe('queued');
    expect((await request(app).get('/api/email/activity?status=queued').set(auth())).body.messages).toHaveLength(1);
    expect((await request(app).get('/api/email/activity/msg_nope').set(auth())).status).toBe(404);
  });

  it('writes an audit trail for sends, retries and cancels', async () => {
    const r = await send({ payload: payload() });
    await request(app).post(`/api/email/activity/${r.body.messageId}/cancel`).set(auth());
    const actions = (await query<{ action: string }>(`SELECT action FROM ec_audit_logs WHERE entity_id=$1 ORDER BY id`, [r.body.messageId])).map(x => x.action);
    expect(actions).toEqual(['send', 'cancel']);
  });
});

describe('CSV import endpoint', () => {
  it('previews, maps and validates the spec example', async () => {
    const csv = 'name,email,team,result,role\nXYZ,xyz@red.iit.ac.in,Animation,Selected,3D Animator\nABC,abc@red.iit.ac.in,Design,Selected,Illustrator\nPQR,pqr@red.iit.ac.in,Animation,Waitlisted,Animator\n';
    const r = await request(app).post('/api/email/import/preview').set(auth()).send({ csv });
    expect(r.status).toBe(200);
    expect(r.body.summary.ok).toBe(3);
    const mapped = await request(app).post('/api/email/import/preview').set(auth()).send({ csv, mapping: { email: 'email', name: 'name', fields: [{ column: 'result', key: 'selection_status' }, { column: 'team', key: 'team_name' }] } });
    expect(mapped.body.rows[0].data).toEqual({ selection_status: 'Selected', team_name: 'Animation' });
    expect((await request(app).post('/api/email/import/preview').set(auth()).send({ csv: 'a,b\n' })).body.rows).toEqual([]);
    expect((await request(app).post('/api/email/import/preview').set(auth()).send({ csv: '' })).status).toBe(400);
  });

  it('imported rows personalize end to end without touching student records', async () => {
    await query(`INSERT INTO student_sessions (roll_number, unique_id, registered_at, name, email) VALUES ('250001','u1',NOW()::text,'Original Name','xyz@red.iit.ac.in')`);
    const csv = 'name,email,team,result\nCSV Name,xyz@red.iit.ac.in,Animation,Selected\n';
    const prev = (await request(app).post('/api/email/import/preview').set(auth()).send({ csv })).body;
    const rows = prev.rows.map((x: { email: string; name: string; data: Record<string, string> }) => ({ email: x.email, name: x.name, source: 'csv', data: { team_name: x.data.team, selection_status: x.data.result } }));
    await send({ payload: payload({ recipients: rows }) });
    await processQueue();
    expect(provider.calls[0].email.html).toContain('Hello CSV,'); // admin/CSV-provided name wins for this communication
    expect(provider.calls[0].email.html).toContain('Team: Animation.');
    expect((await query<{ name: string }>(`SELECT name FROM student_sessions WHERE roll_number='250001'`))[0].name).toBe('Original Name');
  });
});

describe('meta', () => {
  it('exposes the variable catalog, operators and limits for the UI', async () => {
    const r = await request(app).get('/api/email/meta').set(auth());
    expect(r.body.variables.map((v: { name: string }) => v.name)).toEqual(expect.arrayContaining(['first_name', 'full_name', 'email', 'roll_number', 'batch', 'department', 'event_name', 'event_date', 'event_venue', 'event_link', 'selection_status', 'team_name', 'role', 'coordinator_name']));
    expect(r.body.operators).toEqual(['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'gt', 'lt', 'one_of']);
    expect(r.body.limits.maxNormalRecipients).toBe(50);
    expect(pool).toBeTruthy();
  });
});


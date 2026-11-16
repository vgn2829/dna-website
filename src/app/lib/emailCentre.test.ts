import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOC, availableVariables, buildDraftPayload, buildPayload, composerProblems, docIsEmpty, fieldType, groupByCategory,
  knownVariables, mergeRecipients, newComposer, normalizeKeyClient, operatorsFor, overrideRecipient, setExcluded,
  stateFromDraft, describeCondition, applyTemplate,
  type ComposerState, type Meta, type Operator, type RecipientRow,
} from './emailCentre';

const OPS: Operator[] = ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'gt', 'lt', 'one_of'];
const meta: Meta = {
  variables: [
    { name: 'first_name', category: 'Recipient', label: 'First name', sample: 'Aarav', scope: 'recipient' },
    { name: 'email', category: 'Recipient', label: 'Email', sample: 'a@b.c', scope: 'recipient' },
    { name: 'roll_number', category: 'Student', label: 'Roll', sample: '250123', scope: 'recipient' },
    { name: 'batch', category: 'Student', label: 'Batch', sample: 'Y25', scope: 'recipient' },
    { name: 'department', category: 'Student', label: 'Dept', sample: 'Design', scope: 'recipient' },
    { name: 'event_name', category: 'Event', label: 'Event', sample: 'Sprint', scope: 'shared' },
    { name: 'team_name', category: 'Selection', label: 'Team', sample: 'Animation', scope: 'recipient' },
    { name: 'coordinator_name', category: 'Selection', label: 'Coordinator', sample: 'Riya', scope: 'shared' },
  ],
  operators: OPS, limits: { maxRecipients: 1000, maxNormalRecipients: 50, maxIndividualCopies: 3, largeSend: 20, maxAttachmentBytes: 1, maxTotalAttachmentBytes: 1 },
  attachmentAccept: '', sender: 's', replyTo: 'r', providerLive: true, broadcastBudget: 50, batches: [],
};
const row = (email: string, extra: Partial<RecipientRow> = {}): RecipientRow => ({ key: email, email, name: '', source: 'manual', data: {}, ...extra });
const state = (over: Partial<ComposerState> = {}): ComposerState => ({ ...newComposer(), ...over });

describe('payloads', () => {
  it('strips UI-only fields and trims', () => {
    const s = state({ recipients: [row(' A@x.com ', { name: ' Asha ', matchedStudent: true, data: { team: 'D' } }), row('b@x.com', { excluded: true })], groups: [{ id: 'sys:all_members', name: 'All' }], sharedData: { ' k ': 'v', '': 'x' } });
    const p = buildPayload(s);
    expect(p.recipients[0]).toEqual({ email: 'A@x.com', name: 'Asha', source: 'manual', data: { team: 'D' } });
    expect(p.recipients[1]).toMatchObject({ excluded: true, name: null });
    expect(JSON.stringify(p)).not.toContain('matchedStudent');
    expect(JSON.stringify(p)).not.toContain('"key"');
    expect(p.groups).toEqual(['sys:all_members']);
    expect(p.sharedData).toEqual({ k: 'v' });
  });

  it('drafts carry no attachment ids (the draft owns its files server-side)', () => {
    expect('attachmentIds' in buildDraftPayload(state())).toBe(false);
    expect(buildPayload(state({ attachments: [{ id: 'att_1', filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1, inline: false }] })).attachmentIds).toEqual(['att_1']);
  });

  it('round-trips a server draft into composer state', () => {
    const s = stateFromDraft({
      id: 'msg_1', status: 'draft', revision: 3, updatedAt: '', attachments: [],
      payload: { mode: 'normal', subject: { default: 'Hi' }, doc: EMPTY_DOC, recipients: [{ email: 'a@x.com', name: 'A', source: 'csv', data: { team: 'D' } }], groups: ['sys:all_members'], cc: ['c@x.com'], bcc: [], sharedData: { k: 'v' }, fallbacks: {}, eventId: 'e1', shell: 'plain', templateId: 't', templateVersion: 2 },
    } as never);
    expect(s).toMatchObject({ draftId: 'msg_1', revision: 3, mode: 'normal', cc: ['c@x.com'], eventId: 'e1', shell: 'plain', templateId: 't', templateVersion: 2 });
    expect(s.recipients[0]).toMatchObject({ email: 'a@x.com', name: 'A', source: 'csv', data: { team: 'D' } });
    expect(s.recipients[0].key).toBeTruthy();
    expect(s.groups).toEqual([{ id: 'sys:all_members', name: 'sys:all_members' }]);
  });
});

describe('header/footer options (shellOptions)', () => {
  const opts = { labelLeft: 'digital arts cup', labelRight: 'inter iit 9.0', tagline: 'All the best!' };
  const tpl = (shellOptions?: typeof opts | null) => ({ id: 't', name: 'T', version: 1, body: { mode: 'individual', subject: { default: 's' }, doc: EMPTY_DOC, settings: { shellOptions } } }) as never;

  it('a template carries them into the composer and the send payload; other templates reset them', () => {
    const withOpts = applyTemplate(newComposer(), tpl(opts));
    expect(withOpts.shellOptions).toEqual(opts);
    expect(buildPayload(withOpts).shellOptions).toEqual(opts);
    expect(buildDraftPayload(withOpts).shellOptions).toEqual(opts);
    expect(applyTemplate(withOpts, tpl(undefined)).shellOptions).toBeNull();
  });

  it('survive a draft round-trip', () => {
    const s = stateFromDraft({ id: 'm', status: 'draft', revision: 0, updatedAt: '', attachments: [], payload: { ...buildDraftPayload(applyTemplate(newComposer(), tpl(opts))) } } as never);
    expect(s.shellOptions).toEqual(opts);
  });
});

describe('recipient list', () => {
  it('merges without duplicating (case-insensitive) and reports counts', () => {
    const a = mergeRecipients([row('a@x.com')], [{ email: 'A@X.com', name: '', source: 'manual', data: {} }, { email: 'b@x.com', name: 'B', source: 'csv', data: {} }, { email: ' ', name: '', source: 'manual', data: {} }]);
    expect(a.rows.map(r => r.email)).toEqual(['a@x.com', 'b@x.com']);
    expect(a.added).toBe(1); expect(a.skipped).toBe(2);
  });

  it('excludes a group-only member by adding an explicit excluded row, and undoes it', () => {
    const rows = setExcluded([], 'g@x.com', true, { name: 'G' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'g@x.com', excluded: true, source: 'group' });
    expect(setExcluded(rows, 'G@x.com', false)[0].excluded).toBe(false);
    expect(setExcluded([], 'x@x.com', false)).toEqual([]);
  });

  it('edits a person for this email only (override row for group members)', () => {
    expect(overrideRecipient([row('a@x.com', { name: 'A', data: { t: '1' } })], 'a@x.com', { name: 'Ann', data: { u: '2' } })[0]).toMatchObject({ name: 'Ann', data: { t: '1', u: '2' } });
    const added = overrideRecipient([], 'g@x.com', { name: 'Gee' }, { source: 'manual' });
    expect(added[0]).toMatchObject({ email: 'g@x.com', name: 'Gee', source: 'manual' });
  });

  it('normalizes custom field names like the server', () => {
    expect(normalizeKeyClient('Team Name')).toBe('team_name');
    expect(normalizeKeyClient('2nd choice')).toBe('f_2nd_choice');
  });
});

describe('condition builder rules', () => {
  it('only offers greater/less-than for numeric fields', () => {
    expect(operatorsFor('text', OPS)).not.toContain('gt');
    expect(operatorsFor('text', OPS)).not.toContain('lt');
    expect(operatorsFor('number', OPS)).toEqual(expect.arrayContaining(['gt', 'lt']));
    expect(operatorsFor('text', OPS)).toEqual(expect.arrayContaining(['equals', 'contains', 'is_empty', 'one_of']));
  });

  it('detects numeric fields from the audience data', () => {
    expect(fieldType('score', [row('a', { data: { score: '10' } }), row('b', { data: { score: '2.5' } })])).toBe('number');
    expect(fieldType('score', [row('a', { data: { score: '10' } }), row('b', { data: { score: 'high' } })])).toBe('text');
    expect(fieldType('score', [row('a', { data: { score: '' } })])).toBe('text');
    expect(fieldType('missing', [])).toBe('text');
  });

  it('describes conditions in plain language', () => {
    expect(describeCondition({ match: 'all', rules: [{ field: 'selection_status', op: 'equals', value: 'Selected' }, { field: 'team', op: 'is_empty' }] }))
      .toBe('selection_status equals “Selected” and team is empty');
  });
});

describe('variable availability', () => {
  it('individual mode: per-person variables; student-only fields appear only when relevant; department only if provided', () => {
    const none = availableVariables(meta, state({ recipients: [row('a@x.com')] })).map(v => v.name);
    expect(none).toEqual(expect.arrayContaining(['first_name', 'email', 'event_name', 'team_name']));
    expect(none).not.toContain('roll_number');
    expect(none).not.toContain('department');
    const student = availableVariables(meta, state({ recipients: [row('a@x.com', { matchedStudent: true, data: { roll_number: '1', batch: 'Y25' } })] })).map(v => v.name);
    expect(student).toEqual(expect.arrayContaining(['roll_number', 'batch']));
    const withDept = availableVariables(meta, state({ recipients: [row('a@x.com', { data: { department: 'D' } })] })).map(v => v.name);
    expect(withDept).toContain('department');
  });

  it('offers custom fields from recipients and message variables, grouped last', () => {
    const opts = availableVariables(meta, state({ recipients: [row('a@x.com', { data: { result: 'Selected' } })], sharedData: { deadline: '' } }));
    expect(opts.filter(o => o.custom).map(o => o.name).sort()).toEqual(['deadline', 'result']);
    const cats = groupByCategory(opts).map(([c]) => c);
    expect(cats[cats.length - 1]).toBe('Custom');
  });

  it('normal mode hides per-person variables (one shared email)', () => {
    const names = availableVariables(meta, state({ mode: 'normal', recipients: [row('a@x.com', { data: { result: 'x' } })] })).map(v => v.name);
    expect(names).toContain('event_name');
    expect(names).not.toContain('first_name');
    expect(names).not.toContain('result');
  });

  it('knownVariables drives the "unknown variable" highlight', () => {
    const known = knownVariables(meta, state({ recipients: [row('a@x.com', { data: { result: 'x' } })], sharedData: { deadline: '' } }));
    expect(known.has('first_name')).toBe(true);
    expect(known.has('result')).toBe(true);
    expect(known.has('deadline')).toBe(true);
    expect(known.has('frist_name')).toBe(false);
    expect(knownVariables(meta, state({ mode: 'normal' })).has('first_name')).toBe(false);
  });
});

describe('composer readiness hints', () => {
  it('flags what is missing', () => {
    expect(composerProblems(state())).toEqual(['Add a subject', 'Write the email body', 'Add at least one recipient']);
    const ok = state({ subject: { default: 'Hi' }, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }, groups: [{ id: 'g', name: 'g' }] });
    expect(composerProblems(ok)).toEqual([]);
  });

  it('treats blank paragraphs as empty but buttons, images and conditional blocks as content', () => {
    expect(docIsEmpty(EMPTY_DOC)).toBe(true);
    expect(docIsEmpty({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] })).toBe(true);
    expect(docIsEmpty({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x/y.png' } }] })).toBe(false);
    expect(docIsEmpty({ type: 'doc', content: [{ type: 'button', attrs: { label: 'Go', href: 'https://x' } }] })).toBe(false);
    expect(docIsEmpty({ type: 'doc', content: [{ type: 'conditionalBlock', content: [] }] })).toBe(false);
  });
});

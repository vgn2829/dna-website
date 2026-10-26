import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyRsvpResult, attachmentActionLabel, attachmentFieldState, attachmentMeta, attachmentTypeInfo, checkEventAttachment, checkGoogleFormUrl, eventCardActions, eventSavingLabel, formActionLabel, safeFormUrl } from './eventForm';

describe('checkGoogleFormUrl (mirrors the server allowlist)', () => {
  it.each([
    'https://docs.google.com/forms/d/e/1FAIpQLSf-test/viewform',
    'https://docs.google.com/forms/d/e/x/viewform?usp=sf_link',
    'https://forms.gle/AbC123xyz',
  ])('accepts %s', url => expect(checkGoogleFormUrl(url).ok).toBe(true));

  it.each([
    'http://docs.google.com/forms/d/e/x/viewform',
    'javascript:alert(1)',
    'https://docs.google.com.evil.example/forms/d/x',
    'https://forms.gle.evil.example/abc',
    'https://user:pass@docs.google.com/forms/d/x/viewform',
    'https://docs.google.com:8443/forms/d/x/viewform',
    'https://docs.google.com/document/d/x/edit',
    'not a url',
    '',
  ])('rejects %s', url => expect(checkGoogleFormUrl(url).ok).toBe(false));

  it('explains an edit link', () => {
    const r = checkGoogleFormUrl('https://docs.google.com/forms/d/1AbC/edit');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/edit link/);
  });
});

describe('event card helpers', () => {
  it('only ever opens an allowlisted form link', () => {
    expect(safeFormUrl('https://forms.gle/AbC123xyz')).toBe('https://forms.gle/AbC123xyz');
    expect(safeFormUrl('https://evil.example/forms')).toBeNull();
    expect(safeFormUrl(null)).toBeNull();
    expect(safeFormUrl(undefined)).toBeNull();
  });
  it('labels the form action by whether a problem statement exists', () => {
    expect(formActionLabel(false)).toBe('Complete Registration');
    expect(formActionLabel(true)).toBe('Submit Response');
  });
  it('checks attachments like the server does', () => {
    expect(checkEventAttachment({ name: 'Brief.PDF', size: 10 })).toBeNull();
    expect(checkEventAttachment({ name: 'kit.docx', size: 10 })).toBeNull();
    expect(checkEventAttachment({ name: 'run.exe', size: 10 })).toMatch(/must be/);
    expect(checkEventAttachment({ name: 'brief.pdf', size: 0 })).toMatch(/empty/);
    expect(checkEventAttachment({ name: 'brief.pdf', size: 25 * 1024 * 1024 + 1 })).toMatch(/25 MB/);
  });
});

const FORM = 'https://forms.gle/AbC123xyz';
const PDF = { name: 'brief.pdf', size: 10, url: 'https://cdn.example/events/e/x.pdf' };
const loaded = (over: Partial<{ registrationFormUrl: string | null; attachment: typeof PDF | null; isRegistered: boolean; registeredCount: number }> = {}) =>
  ({ id: 'evt-1', registrationFormUrl: FORM as string | null, attachment: null as typeof PDF | null, isRegistered: false, registeredCount: 0, ...over });

describe('stale registration form (regression)', () => {
  it('a form removed after the page loaded is cleared by the registration response, and cancel still works', () => {
    // 1. The student loads an event that has a form.
    const event = loaded();
    expect(eventCardActions(event, false)).toMatchObject({ registersViaForm: true, primary: 'rsvp' });
    // 2. An admin removes the form. 3. The student registers without reloading:
    //    the server records it and — the event having no form now — sends no link.
    const response = { registeredCount: 1, isRegistered: true };
    expect(safeFormUrl((response as { registrationFormUrl?: string }).registrationFormUrl)).toBeNull(); // nothing to open
    const after = applyRsvpResult(event, response);
    // 4. The stale link is gone: no Complete Registration action, just Registered ✓.
    expect(after.registrationFormUrl).toBeNull();
    expect(eventCardActions(after, false)).toMatchObject({ formUrl: null, primary: 'rsvp', registersViaForm: false });
    expect(after).toMatchObject({ isRegistered: true, registeredCount: 1 });
    // 5. Cancelling now goes through the ordinary toggle and is applied correctly.
    const cancelled = applyRsvpResult(after, { registeredCount: 0, isRegistered: false });
    expect(cancelled).toMatchObject({ isRegistered: false, registeredCount: 0, registrationFormUrl: null });
    expect(eventCardActions(cancelled, false).primary).toBe('rsvp');
  });

  it('keeps a form the server still reports, and picks up one added since the page loaded', () => {
    const kept = applyRsvpResult(loaded(), { registeredCount: 1, isRegistered: true, registrationFormUrl: FORM });
    expect(eventCardActions(kept, false)).toMatchObject({ formUrl: FORM, primary: 'form', formLabel: 'Complete Registration' });
    const added = applyRsvpResult(loaded({ registrationFormUrl: null }), { registeredCount: 1, isRegistered: true, registrationFormUrl: FORM });
    expect(added.registrationFormUrl).toBe(FORM);
  });

  it('a failed registration changes nothing (the response is never applied)', () => {
    const event = loaded();
    expect(eventCardActions(event, false)).toMatchObject({ formUrl: FORM, primary: 'rsvp' });
  });
});

describe('event card actions for the four configurations', () => {
  it('neither, form only, attachment only, both — before and after registering', () => {
    const neither = loaded({ registrationFormUrl: null });
    // Exactly as before the extras existed: just Register, no attachment.
    expect(eventCardActions(neither, false)).toEqual({ problemStatement: false, attachment: null, formUrl: null, formLabel: 'Complete Registration', primary: 'rsvp', registersViaForm: false });
    expect(eventCardActions({ ...neither, isRegistered: true }, false).primary).toBe('rsvp'); // Registered ✓ toggle

    const formOnly = loaded();
    expect(eventCardActions(formOnly, false)).toMatchObject({ problemStatement: false, primary: 'rsvp', registersViaForm: true });
    expect(eventCardActions({ ...formOnly, isRegistered: true }, false)).toMatchObject({ primary: 'form', formLabel: 'Complete Registration' });

    const fileOnly = loaded({ registrationFormUrl: null, attachment: PDF });
    expect(eventCardActions(fileOnly, false)).toMatchObject({ problemStatement: true, primary: 'rsvp', registersViaForm: false });

    const both = loaded({ attachment: PDF });
    expect(eventCardActions({ ...both, isRegistered: true }, false)).toMatchObject({ problemStatement: true, primary: 'form', formLabel: 'Submit Response' });
  });
  it('past events: no registration action unless registered; the problem statement stays', () => {
    expect(eventCardActions(loaded({ attachment: PDF }), true)).toMatchObject({ problemStatement: true, primary: 'none' });
    expect(eventCardActions(loaded({ isRegistered: true }), true).primary).toBe('form');
  });
  it('never offers a link that fails the allowlist', () => {
    expect(eventCardActions(loaded({ registrationFormUrl: 'https://evil.example/f', isRegistered: true }), false)).toMatchObject({ formUrl: null, primary: 'rsvp', registersViaForm: false });
  });
});

describe('attachment presentation', () => {
  it('names the type and whether the browser opens it, like the server does', () => {
    expect(attachmentTypeInfo('Brief.PDF')).toEqual({ label: 'PDF', opensInBrowser: true });
    expect(attachmentTypeInfo('mock.webp')).toEqual({ label: 'WEBP image', opensInBrowser: true });
    expect(attachmentTypeInfo('rules.docx')).toEqual({ label: 'Word document', opensInBrowser: false });
    expect(attachmentTypeInfo('kit.zip')).toEqual({ label: 'ZIP archive', opensInBrowser: false });
    expect(attachmentTypeInfo('noext')).toEqual({ label: 'File', opensInBrowser: false });
  });
  it('says View for files that open, Download for files that download', () => {
    expect(attachmentActionLabel('brief.pdf')).toBe('View problem statement');
    expect(attachmentActionLabel('deck.pptx')).toBe('Download problem statement');
  });
  it('meta line: type, plus size when known', () => {
    expect(attachmentMeta('brief.pdf', 1.2 * 1024 * 1024)).toBe('PDF · 1.2 MB');
    expect(attachmentMeta('brief.pdf', 2048)).toBe('PDF · 2 KB');
    expect(attachmentMeta('brief.pdf', null)).toBe('PDF');
  });
  it('the card carries label, name and meta when there is an attachment', () => {
    const event = { registrationFormUrl: null, isRegistered: false, attachment: { name: 'kit.zip', size: 3 * 1024 * 1024, url: 'https://cdn.example/kit.zip?download=kit.zip' } };
    expect(eventCardActions(event, false).attachment).toEqual({
      url: 'https://cdn.example/kit.zip?download=kit.zip', name: 'kit.zip',
      label: 'Download problem statement', meta: 'ZIP archive · 3.0 MB', opensInBrowser: false,
    });
  });
});

describe('admin attachment field states', () => {
  it('create: empty → new; clearing goes back to empty', () => {
    expect(attachmentFieldState(false, false, false)).toBe('empty');
    expect(attachmentFieldState(false, true, false)).toBe('new');
  });
  it('edit: saved, replacing (new file over a saved one), removing (undoable), and back', () => {
    expect(attachmentFieldState(true, false, false)).toBe('saved');
    expect(attachmentFieldState(true, true, false)).toBe('replacing');
    expect(attachmentFieldState(true, false, true)).toBe('removing');
    // Choosing a file while removing means replace — the staged file wins.
    expect(attachmentFieldState(true, true, true)).toBe('replacing');
  });
  it('the save button never claims an upload is done before the server answers', () => {
    expect(eventSavingLabel(true, true)).toBe('Uploading attachment & saving…');
    expect(eventSavingLabel(false, true)).toBe('Uploading attachment & saving…');
    expect(eventSavingLabel(true, false)).toBe('Scheduling…');
    expect(eventSavingLabel(false, false)).toBe('Saving…');
  });
});

// Static guards for the wiring (frontend tests run in node; rendered
// behaviour is covered by browser QA).
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('event form wiring (static)', () => {
  const admin = read('pages/AdminPage.tsx');
  it('create and edit share one attachment field; edit passes the saved file and removal state', () => {
    expect(admin).toMatch(/<EventAttachmentField saved=\{null\} file=\{eFile\} onFileChange=\{setEFile\} saving=\{addingEvent\} \/>/);
    expect(admin).toMatch(/<EventAttachmentField\s+saved=\{editEvent\.attachment\}\s+file=\{eeFile\}\s+onFileChange=\{setEeFile\}\s+removeSaved=\{eeRemoveAttachment\}\s+onRemoveSavedChange=\{setEeRemoveAttachment\}\s+saving=\{eeLoading\}/);
  });
  it('a failed save keeps every input: create clears only after the awaited save, edit closes only on success', () => {
    const add = admin.slice(admin.indexOf('if (addingEvent) return;'), admin.indexOf('const openEditEvent'));
    expect(add.indexOf('await addEvent(')).toBeGreaterThan(-1);
    expect(add.indexOf("setEFile(null)")).toBeGreaterThan(add.indexOf('await addEvent('));
    expect(add.slice(add.indexOf('} catch'))).not.toMatch(/setE(Title|File|FormUrl)\(/);
    const edit = admin.slice(admin.indexOf('const handleEditEvent'), admin.indexOf('return (', admin.indexOf('const handleEditEvent')));
    expect(edit.indexOf('setEditEvent(null)')).toBeGreaterThan(edit.indexOf('await updateEvent('));
    expect(edit.slice(edit.indexOf('} catch'))).not.toMatch(/setEditEvent\(null\)|setEeFile\(/);
  });
  it('the form link and the attachment are labelled as two separate, optional things', () => {
    expect(admin).toMatch(/Registration form link \(optional\)/);
    expect(read('components/events/EventAttachmentField.tsx')).toMatch(/Attachment \(optional\)/);
  });
  it('the card shows the attachment as one compact meta-row link, only when there is one', () => {
    const page = read('pages/EventsPage.tsx');
    const meta = page.slice(page.indexOf('<div className="flex flex-wrap gap-x-4 gap-y-1">'), page.indexOf('{/* Countdown */}'));
    // In the meta row, at the meta's own size, gated on the attachment.
    expect(meta).toMatch(/\{attachment && \(\n\s*<a\n\s*href=\{attachment\.url\}/);
    expect(meta).toMatch(/className="type-micro flex items-center gap-1"/);
    // The file name lives in the tooltip / accessible name, not the layout.
    expect(meta).toMatch(/title=\{`\$\{attachment\.name\}/);
    expect(meta).toMatch(/aria-label=\{`\$\{attachment\.label\} for \$\{event\.title\}: \$\{attachment\.name\}/);
    expect(meta).not.toMatch(/>\{attachment\.name\}</);
    // No bordered attachment panel, no duplicate "Problem statement" marker.
    expect(page).not.toMatch(/Paperclip|border: '1px solid var\(--color-hairline\)'|btn-secondary w-full flex items-center justify-center gap-2"\s*>\s*<FileText/);
  });
  it('the actions area is the pre-attachment one: an attachment never adds a wrapper or button there', () => {
    const page = read('pages/EventsPage.tsx');
    const actions = page.slice(page.indexOf('{/* Countdown */}'), page.indexOf('</motion.div>', page.indexOf('{/* Countdown */}')));
    // Only a registration form opens the extra-actions column; otherwise the
    // original Register button, exactly as before attachments existed.
    expect(actions).toMatch(/\{formUrl \? \(\n\s*<div className="mt-auto flex flex-col gap-2">/);
    expect(actions).toMatch(/\) : actions\.primary !== 'none' && rsvpButton\('mt-auto'\)\}/);
    expect(actions).not.toMatch(/attachment|problemStatement/);
  });
});

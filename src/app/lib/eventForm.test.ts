import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyRsvpResult, attachmentActionLabel, attachmentFieldState, attachmentMeta, attachmentTypeInfo, checkEventAttachment, checkGoogleFormUrl, eventCardActions, eventSavingLabel, formActionLabel, rsvpButtonState, safeFormUrl } from './eventForm';

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
    expect(eventCardActions(neither, false)).toEqual({ problemStatement: false, attachment: null, formUrl: null, formLabel: 'Complete Registration', primary: 'rsvp', registersViaForm: false, showCancel: false });
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
  it('Cancel registration shows exactly where it did before: registered viewers of form events', () => {
    // Registered form event (upcoming or past, with or without an attachment).
    for (const attachment of [null, PDF]) for (const past of [false, true]) {
      expect(eventCardActions(loaded({ attachment, isRegistered: true }), past).showCancel).toBe(true);
    }
    // Not registered, or no form (the Registered ✓ toggle cancels instead).
    expect(eventCardActions(loaded(), false).showCancel).toBe(false);
    expect(eventCardActions(loaded(), true).showCancel).toBe(false);
    expect(eventCardActions(loaded({ registrationFormUrl: null, isRegistered: true }), false).showCancel).toBe(false);
    expect(eventCardActions(loaded({ registrationFormUrl: null, attachment: PDF, isRegistered: true }), true).showCancel).toBe(false);
    // An unsafe form link never yields a form action, so no separate Cancel.
    expect(eventCardActions(loaded({ registrationFormUrl: 'https://evil.example/f', isRegistered: true }), false).showCancel).toBe(false);
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
  const card = () => {
    const page = read('pages/EventsPage.tsx');
    const start = page.indexOf('function EventCard(');
    return page.slice(start, page.indexOf('export function EventsPage', start));
  };
  const actionsArea = (src: string) => src.slice(src.indexOf('{/* Countdown */}'), src.indexOf('</motion.div>', src.indexOf('{/* Countdown */}')));

  it('the problem statement is a full-width secondary button directly above the primary action', () => {
    const src = card();
    const actions = actionsArea(src);
    // One bottom-anchored action column, present whenever there is an
    // attachment or a registration action; attachment first, primary last.
    expect(actions).toMatch(/\{\(attachment \|\| actions\.primary !== 'none'\) && \(\n\s*<div className="mt-auto flex flex-col gap-2">\n\s*\{attachment && \(/);
    expect(actions.indexOf('{attachment && (')).toBeLessThan(actions.indexOf("actions.primary === 'form' && formUrl ?"));
    expect(actions).toMatch(/className="btn-translucent w-full flex items-center justify-center gap-2"\n\s*style=\{\{ border: '1px solid var\(--color-hairline\)' \}\}/);
    // File handling and accessibility unchanged: same URL, new tab, label
    // with the file's name, type and size; the name never in the layout.
    expect(actions).toMatch(/href=\{attachment\.url\}\n\s*target="_blank"\n\s*rel="noopener noreferrer"/);
    expect(actions).toMatch(/aria-label=\{`\$\{attachment\.label\} for \$\{event\.title\}: \$\{attachment\.name\}, \$\{attachment\.meta\}/);
    expect(actions).not.toMatch(/>\{attachment\.name\}</);
    // Not beside the status any more, and no old bordered file panel.
    const status = src.slice(src.indexOf('{/* Status + title */}'), src.indexOf('<h3 className="type-body font-semibold'));
    expect(status).not.toMatch(/attachment/);
    expect(src).not.toMatch(/Paperclip|radius-md\)', ?\n?\s*border|flex-1 min-w-0 flex flex-col/);
  });
  it('the primary action is unchanged: Register / Registered ✓, or the form action once registered', () => {
    const actions = actionsArea(card());
    expect(actions).toMatch(/\{actions\.primary === 'form' && formUrl \? \([\s\S]*?className="btn-primary w-full flex items-center justify-center gap-2"[\s\S]*?\{formLabel\} <ExternalLink size=\{14\} \/>[\s\S]*?\) : actions\.primary !== 'none' && rsvpButton\(''\)\}/);
    // Cancel registration is no longer in the bottom action area.
    expect(actions).not.toMatch(/Cancel registration|onCancel/);
  });
  it('Cancel registration is a compact control in the top-right, with the same handler and pending state', () => {
    const src = card();
    expect(src).toMatch(/const cancelControl = showCancel && \(\n\s*<button\n\s*type="button"\n\s*onClick=\{onCancel\}\n\s*disabled=\{rsvpPending\}\n\s*aria-busy=\{rsvpPending\}\n\s*aria-label=\{`Cancel registration for \$\{event\.title\}`\}\n\s*className="btn-translucent btn-sm touch-target shrink-0"/);
    expect(src).toMatch(/\{rsvpPending \? 'Updating…' : 'Cancel registration'\}/);
    // Beside the date badge whenever the card stacks (grid; list below md);
    // at the end of the status row in list view's md+ row layout. Exactly
    // one of the two is displayed at any width.
    expect(src).toMatch(/\{cancelControl \? \(\n\s*<div className=\{`flex items-start justify-between gap-3 \$\{view === 'list' \? 'shrink-0' : ''\}`\}>\n\s*\{dateBadge\}\n\s*<span className=\{`shrink-0 \$\{view === 'list' \? 'md:hidden' : ''\}`\}>\{cancelControl\}<\/span>\n\s*<\/div>\n\s*\) : dateBadge\}/);
    expect(src).toMatch(/\{view === 'list' && cancelControl && <span className="ml-auto hidden md:inline-flex">\{cancelControl\}<\/span>\}/);
    // Rendered once per view, wired by the page to the existing context call.
    expect(src.match(/\{cancelControl\}/g)).toHaveLength(2);
    expect(read('pages/EventsPage.tsx')).toMatch(/onCancel=\{\(\) => cancelRegistration\(evt\.id\)\}/);
  });
  it('Place reserved stays with the registered state, beside the status', () => {
    const src = card();
    const status = src.slice(src.indexOf('{/* Status + title */}'), src.indexOf('<h3 className="type-body font-semibold'));
    expect(status).toMatch(/\{showCancel && \(\n\s*<span className="type-micro flex items-center gap-1" style=\{\{ color: '#3ecf5f' \}\}>\n\s*<CheckCircle2 size=\{12\} \/> Place reserved/);
    expect(status).toMatch(/className="flex flex-wrap items-center gap-2 mb-2"/); // wraps on narrow cards
  });
  it('the meta row is the original one', () => {
    expect(card()).toContain(`{/* Meta */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="type-micro flex items-center gap-1"><Calendar size={11} />{formatEventDate(event.date)}</span>
          <span className="type-micro flex items-center gap-1"><Clock size={11} />{event.time}</span>
          <span className="type-micro flex items-center gap-1"><MapPin size={11} />{event.location}</span>
        </div>`);
  });
});

describe('Register / Registered ✓ button state (Events card rules, reused by Home)', () => {
  const ev = (o: Partial<{ isRegistered: boolean; registeredCount: number; capacity: number }> = {}) =>
    ({ isRegistered: false, registeredCount: 3, capacity: 10, ...o });
  it('not registered: the caller’s call to action, enabled', () => {
    expect(rsvpButtonState(ev(), false)).toEqual({ registered: false, disabled: false, label: null });
  });
  it('pending: Registering… / Updating…, disabled so it can’t be sent twice', () => {
    expect(rsvpButtonState(ev(), true)).toEqual({ registered: false, disabled: true, label: 'Registering…' });
    expect(rsvpButtonState(ev({ isRegistered: true }), true)).toEqual({ registered: true, disabled: true, label: 'Updating…' });
  });
  it('registered: Registered ✓, still enabled (the toggle that cancels)', () => {
    expect(rsvpButtonState(ev({ isRegistered: true }), false)).toEqual({ registered: true, disabled: false, label: 'Registered ✓' });
  });
  it('full: can’t join, but a registered student can still cancel', () => {
    expect(rsvpButtonState(ev({ registeredCount: 10 }), false)).toEqual({ registered: false, disabled: true, label: 'Event full' });
    expect(rsvpButtonState(ev({ registeredCount: 10, isRegistered: true }), false).disabled).toBe(false);
  });
});

describe('Home spotlight event actions', () => {
  const file = (name: string) => ({ name, size: 2048, url: `https://cdn.example/${name}` });
  const base = { registrationFormUrl: null, attachment: null, isRegistered: false };
  const FORM = 'https://forms.gle/abc123';

  it('PDFs and images are viewed, DOCX/PPTX/ZIP downloaded — the Events page’s own list', () => {
    for (const n of ['brief.pdf', 'brief.png', 'brief.jpg', 'brief.jpeg', 'brief.webp']) {
      const a = eventCardActions({ ...base, attachment: file(n) }, false).attachment!;
      expect([a.label, a.opensInBrowser, a.url]).toEqual(['View problem statement', true, `https://cdn.example/${n}`]);
    }
    for (const n of ['brief.docx', 'brief.pptx', 'brief.zip']) {
      const a = eventCardActions({ ...base, attachment: file(n) }, false).attachment!;
      expect([a.label, a.opensInBrowser]).toEqual(['Download problem statement', false]);
    }
  });
  it('no attachment, no attachment action', () => {
    expect(eventCardActions(base, false).attachment).toBeNull();
  });
  it('registration states: Register, Registered ✓ toggle, or form + Cancel registration', () => {
    expect(eventCardActions(base, false)).toMatchObject({ primary: 'rsvp', showCancel: false });
    expect(eventCardActions({ ...base, isRegistered: true }, false)).toMatchObject({ primary: 'rsvp', showCancel: false });
    expect(eventCardActions({ ...base, registrationFormUrl: FORM }, false)).toMatchObject({ primary: 'rsvp', registersViaForm: true, showCancel: false });
    expect(eventCardActions({ ...base, registrationFormUrl: FORM, isRegistered: true }, false)).toMatchObject({ primary: 'form', showCancel: true });
  });
  it('a past event offers no registration unless already registered', () => {
    expect(eventCardActions(base, true).primary).toBe('none');
    expect(eventCardActions({ ...base, attachment: file('brief.pdf') }, true).attachment).not.toBeNull();
  });

  // Static wiring guards (node-only tests; rendering is covered by browser QA).
  const home = read('components/EventSpotlight.tsx');
  it('reuses the Events decisions and context handlers — no second registration path', () => {
    expect(home).toMatch(/eventCardActions\(nextEvent, nextStatus === 'past'\)/);
    expect(home).toMatch(/rsvpButtonState\(nextEvent, pending\)/);
    expect(home).toMatch(/const \{ events, rsvpEvent, cancelRegistration, rsvpPendingId \} = useAppData\(\)/);
    expect(home).toMatch(/if \(!studentSession\) \{ openRollModal\(\); return; \}\n\s*rsvpEvent\(id\);/);
    expect(home).toMatch(/onClick=\{\(\) => cancelRegistration\(nextEvent\.id\)\}/);
    expect(home).not.toMatch(/api\.events|fetch\(/);
  });
  it('the attachment is the Events link: server URL, new tab, labelled; separate from registration', () => {
    const link = home.slice(home.indexOf('{actions.attachment && ('), home.indexOf('{actions.showCancel && ('));
    expect(link).toMatch(/<a\n\s*href=\{actions\.attachment\.url\}\n\s*target="_blank"\n\s*rel="noopener noreferrer"/);
    expect(link).toMatch(/aria-label=\{`\$\{actions\.attachment\.label\} for \$\{nextEvent\.title\}/);
    expect(link).toMatch(/\{actions\.attachment\.label\}/);
    expect(link).not.toMatch(/onClick|handleRSVP|rsvpEvent/);
  });
  it('Cancel registration and Registered ✓ keep the Events page’s pending text', () => {
    expect(home).toMatch(/\{pending \? 'Updating…' : 'Cancel registration'\}/);
    expect(home).toMatch(/\{rsvp\.label \?\? 'Register Now'\}/);
  });
});

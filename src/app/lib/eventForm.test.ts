import { describe, expect, it } from 'vitest';
import { applyRsvpResult, checkEventAttachment, checkGoogleFormUrl, eventCardActions, formActionLabel, safeFormUrl } from './eventForm';

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
    expect(eventCardActions(neither, false)).toEqual({ problemStatement: false, formUrl: null, formLabel: 'Complete Registration', primary: 'rsvp', registersViaForm: false });
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

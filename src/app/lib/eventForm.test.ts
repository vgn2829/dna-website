import { describe, expect, it } from 'vitest';
import { checkEventAttachment, checkGoogleFormUrl, formActionLabel, safeFormUrl } from './eventForm';

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

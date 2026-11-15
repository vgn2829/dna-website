// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { FooterControls } from './FooterControls';
import { buildDraftPayload, buildPayload, newComposer, stateFromDraft, type ComposerState } from '../../../lib/emailCentre';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let latest: ComposerState = newComposer();
function Harness({ initial }: { initial: ComposerState }) {
  const [state, setState] = useState(initial);
  latest = state;
  return <FooterControls state={state} setState={setState} />;
}
async function mount(initial = newComposer()) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness initial={initial} />));
  const q = <T extends Element>(sel: string) => host.querySelector(sel) as T;
  const input = (label: string) => q<HTMLInputElement>(`input[aria-label="${label}"]`);
  const toggle = (name: RegExp) => [...host.querySelectorAll('label')].find(l => name.test(l.textContent ?? ''))!.querySelector('input') as HTMLInputElement;
  const click = (el: HTMLElement) => act(async () => { el.click(); });
  const type = (el: HTMLInputElement, v: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { host, q, input, toggle, click, type, unmount: () => act(async () => root.unmount()) };
}

describe('Footer & sign-off controls', () => {
  it('both default to ON with the default texts for a new manual email', async () => {
    const m = await mount();
    expect(m.toggle(/sign-off/).checked).toBe(true);
    expect(m.toggle(/design credit/).checked).toBe(true);
    expect(m.input('Sign-off text').value).toBe('All the best!');
    expect(m.input('Design credit text').value).toBe('designed by venugopal');
    expect(m.q('[data-testid="footer-preview-signoff"]').textContent).toBe('All the best!');
    expect(m.q('[data-testid="footer-preview-credit"]').textContent).toBe('designed by venugopal');
    await m.unmount();
  });

  it('the texts are editable and show in the live footer preview', async () => {
    const m = await mount();
    await m.type(m.input('Sign-off text'), 'DNA Coordinators');
    await m.type(m.input('Design credit text'), 'made with care');
    expect(m.q('[data-testid="footer-preview-signoff"]').textContent).toBe('DNA Coordinators');
    expect(m.q('[data-testid="footer-preview-credit"]').textContent).toBe('made with care');
    expect(buildPayload(latest).shellOptions).toMatchObject({ tagline: 'DNA Coordinators', credit: 'made with care' });
    await m.unmount();
  });

  it('each toggle works independently and disables only its own input', async () => {
    const m = await mount();
    await m.click(m.toggle(/design credit/));
    expect(m.q('[data-testid="footer-preview-credit"]')).toBeNull();
    expect(m.q('[data-testid="footer-preview-signoff"]')).not.toBeNull();
    expect(m.input('Design credit text').disabled).toBe(true);
    expect(m.input('Sign-off text').disabled).toBe(false);
    await m.click(m.toggle(/design credit/));
    await m.click(m.toggle(/sign-off/));
    expect(m.q('[data-testid="footer-preview-signoff"]')).toBeNull();
    expect(m.q('[data-testid="footer-preview-credit"]')).not.toBeNull();
    expect(m.input('Sign-off text').disabled).toBe(true);
    expect(latest.shellOptions).toMatchObject({ showSignoff: false, showCredit: true });
    await m.unmount();
  });

  it('turning both OFF removes both lines from the preview and keeps the typed text', async () => {
    const m = await mount();
    await m.click(m.toggle(/sign-off/)); await m.click(m.toggle(/design credit/));
    expect(m.q('[data-testid="footer-preview-signoff"]')).toBeNull();
    expect(m.q('[data-testid="footer-preview-credit"]')).toBeNull();
    expect(m.q('[data-testid="footer-preview"]').textContent).toBe('No footer text');
    expect(latest.shellOptions).toMatchObject({ showSignoff: false, showCredit: false, tagline: 'All the best!' });
    await m.unmount();
  });

  it('empty text renders no empty line', async () => {
    const m = await mount();
    await m.type(m.input('Sign-off text'), '   ');
    expect(m.q('[data-testid="footer-preview-signoff"]')).toBeNull();
    await m.unmount();
  });

  it('restores a template-provided footer (and keeps the template wording when untouched)', async () => {
    const s = { ...newComposer(), shellOptions: { labelLeft: 'digital arts cup', tagline: 'Regards,' } };
    const m = await mount(s);
    expect(m.input('Sign-off text').value).toBe('Regards,');
    expect(m.toggle(/sign-off/).checked).toBe(true);
    await m.click(m.toggle(/design credit/));
    expect(latest.shellOptions).toMatchObject({ labelLeft: 'digital arts cup', tagline: 'Regards,', showCredit: false });
    await m.unmount();
  });

  it('is laid out as a wrapping grid so it fits a phone-width composer', async () => {
    const m = await mount();
    const grid = m.q<HTMLElement>('[data-testid="footer-controls"] > div');
    expect(grid.style.gridTemplateColumns).toContain('auto-fit');
    expect(grid.style.gridTemplateColumns).toContain('minmax(240px');
    await m.unmount();
  });

  it('a draft round-trip preserves the exact footer configuration', async () => {
    const m = await mount();
    await m.click(m.toggle(/design credit/));
    await m.type(m.input('Sign-off text'), 'Best regards,');
    const draft = { id: 'm', status: 'draft', revision: 0, updatedAt: '', attachments: [], payload: buildDraftPayload(latest) } as never;
    const back = stateFromDraft(draft);
    expect(back.shellOptions).toEqual(latest.shellOptions);
    expect(back.shellOptions).toMatchObject({ showCredit: false, showSignoff: true, tagline: 'Best regards,' });
    await m.unmount();
  });
});

describe('footer defaults are per email', () => {
  it('editing one composer never changes the defaults of the next new email', () => {
    const a = newComposer();
    (a.shellOptions as { tagline: string }).tagline = 'mutated';
    expect(newComposer().shellOptions).toMatchObject({ showSignoff: true, tagline: 'All the best!', showCredit: true, credit: 'designed by venugopal' });
  });
});

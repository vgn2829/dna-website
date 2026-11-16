// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  me: vi.fn(), update: vi.fn(), create: vi.fn(), setVisibility: vi.fn(), credits: vi.fn(), disciplines: vi.fn(), handleAvailable: vi.fn(),
  openRollModal: vi.fn(), logout: vi.fn(), token: { current: null as string | null },
  session: { current: { rollNumber: '230001', name: 'Asha Rao' } as { rollNumber: string; name: string } | null },
}));

vi.mock('../lib/api', () => ({
  getStudentToken: () => mocks.token.current,
  api: {
    designers: {
      me: mocks.me, update: mocks.update, create: mocks.create, setVisibility: mocks.setVisibility, credits: mocks.credits,
      handleAvailable: mocks.handleAvailable, setLinks: vi.fn(), setSkills: vi.fn(), setDisciplines: vi.fn(), preview: vi.fn(),
      uploadAvatar: vi.fn(), removeAvatar: vi.fn(), respondToCredit: vi.fn(),
    },
    showcase: { disciplines: mocks.disciplines },
  },
}));
vi.mock('../context/StudentContext', () => ({
  useStudent: () => ({ studentSession: mocks.session.current, openRollModal: mocks.openRollModal, logout: mocks.logout }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ProfilePage from './ProfilePage';

const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`;
const VERIFIED = jwt({ typ: 'student', roll: '230001', identityVerified: true });
const LEGACY = jwt({ typ: 'student', roll: '230001' });

const PROFILE = {
  handle: 'asha-rao', displayName: 'Asha Rao', headline: 'Illustrator', bio: 'Posters', department: null, batch: null, verified: false,
  avatarUrl: null, coverUrl: null, disciplines: [], skills: ['figma'], links: [], worksCount: 0,
  showBatch: false, visibility: 'private', moderationStatus: 'active', handleChangeableAt: null, createdAt: '2026-01-01',
};

async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ProfilePage /></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
  return { host, text: () => host.textContent ?? '', unmount: () => act(async () => root.unmount()) };
}
const change = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => {
  document.body.innerHTML = '';
  Object.values(mocks).forEach(m => { if (typeof m === 'function' && 'mockReset' in m) (m as ReturnType<typeof vi.fn>).mockReset(); });
  mocks.token.current = VERIFIED;
  mocks.session.current = { rollNumber: '230001', name: 'Asha Rao' };
  mocks.me.mockResolvedValue(PROFILE);
  mocks.credits.mockResolvedValue([]);
  mocks.disciplines.mockResolvedValue({ disciplines: [{ id: 'illus', title: 'Illustration' }] });
  mocks.handleAvailable.mockResolvedValue({ available: true });
});

describe('ProfilePage', () => {
  it('asks a signed-out visitor to sign in and loads nothing', async () => {
    mocks.session.current = null;
    const { text } = await mount();
    expect(text()).toContain('Sign in to create and manage your creator profile');
    expect(mocks.me).not.toHaveBeenCalled();
  });

  it('shows the verify banner and locks every editor for a legacy (non-OTP) session', async () => {
    mocks.token.current = LEGACY;
    const { host, text } = await mount();
    expect(text()).toContain('Verify with an email code to edit your profile');
    expect((host.querySelector('#pe-name') as HTMLInputElement).disabled).toBe(true);
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save changes') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('never offers a way to set verified status, and says only the club can', async () => {
    const { host, text } = await mount();
    expect(text()).toContain('granted by the club');
    expect(host.querySelector('input[name*="verif" i], [id*="verif" i], label[for*="verif" i]')).toBeNull();
  });

  it('sends only the fields that changed, then reflects the server response', async () => {
    mocks.update.mockResolvedValue({ ...PROFILE, headline: 'Illustrator & animator' });
    const { host } = await mount();
    const save = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save changes') as HTMLButtonElement;
    expect(save().disabled).toBe(true);                                       // nothing changed yet
    await change(host.querySelector('#pe-headline') as HTMLInputElement, 'Illustrator & animator');
    expect(save().disabled).toBe(false);
    await act(async () => { save().click(); });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith('230001', { headline: 'Illustrator & animator' });   // no handle/name/bio re-sent
  });

  it('blocks an invalid username on the client and does not call the server', async () => {
    const { host, text } = await mount();
    await change(host.querySelector('#pe-handle') as HTMLInputElement, 'Bad Handle!');
    expect(text()).toContain('Start with a letter');
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save changes') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('locks the username while the 30-day cooldown is running', async () => {
    mocks.me.mockResolvedValue({ ...PROFILE, handleChangeableAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const { host, text } = await mount();
    expect((host.querySelector('#pe-handle') as HTMLInputElement).disabled).toBe(true);
    expect(text()).toContain('You can change this again on');
  });

  it('offers the create form (pre-filled, private by default) when no profile exists yet', async () => {
    mocks.me.mockResolvedValue(null);
    mocks.create.mockResolvedValue(PROFILE);
    const { host, text } = await mount();
    expect(text()).toContain('Create your profile');
    expect((host.querySelector('#pf-handle') as HTMLInputElement).value).toBe('asha-rao');
    await act(async () => { await new Promise(r => setTimeout(r, 400)); });
    const create = [...host.querySelectorAll('button')].find(b => b.textContent === 'Create profile') as HTMLButtonElement;
    await act(async () => { create.click(); });
    expect(mocks.create).toHaveBeenCalledWith('230001', { handle: 'asha-rao', displayName: 'Asha Rao' });   // no visibility/verified field exists to send
  });

  it('explains a hidden (moderated) profile and keeps the owner from re-publishing it', async () => {
    mocks.me.mockResolvedValue({ ...PROFILE, moderationStatus: 'hidden' });
    const { host, text } = await mount();
    expect(text()).toContain('An administrator has hidden this profile');
    const radios = [...host.querySelectorAll('input[name="visibility"]')] as HTMLInputElement[];
    expect(radios.filter(r => r.disabled).length).toBe(2);                     // members + public are locked; "Only me" stays available
  });

  it('shows a retryable error when the profile cannot be loaded', async () => {
    mocks.me.mockRejectedValue(new Error('boom'));
    const { host, text } = await mount();
    expect(text()).toContain('We couldn’t load your profile');
    mocks.me.mockResolvedValue(PROFILE);
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });
    expect(text()).toContain('Your profile');
  });
});

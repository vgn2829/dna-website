// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({ me: vi.fn(), token: { current: 'tok' as string | null } }));
vi.mock('../lib/api', () => ({
  getStudentToken: () => mocks.token.current,
  api: { designers: { me: mocks.me } },
}));

import { AccountMenu, OPEN_NOTIFICATIONS_EVENT } from './AccountMenu';
import { clearMyProfile, publishMyProfile } from '../lib/myProfile';

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}{l.hash}</output>; }

const PROFILE = { handle: 'asha-rao', displayName: 'Asha Rao', avatarUrl: 'https://cdn.example/a.png' };

async function mount(props: Partial<React.ComponentProps<typeof AccountMenu>> = {}) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const onChangeEmail = vi.fn(); const onLogout = vi.fn();
  await act(async () => root.render(
    <MemoryRouter><AccountMenu roll="230001" sessionName="Session Name" onChangeEmail={onChangeEmail} onLogout={onLogout} {...props} /><Where /></MemoryRouter>,
  ));
  await act(async () => { await Promise.resolve(); });
  const trigger = () => host.querySelector<HTMLButtonElement>('.acct-trigger')!;
  const items = () => Array.from(host.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const where = () => host.querySelector('[data-testid="where"]')!.textContent;
  return { host, trigger, items, where, onChangeEmail, onLogout, unmount: () => act(async () => root.unmount()) };
}
const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });

beforeEach(() => {
  document.body.innerHTML = '';
  clearMyProfile(); mocks.me.mockReset(); mocks.token.current = 'tok';
  mocks.me.mockResolvedValue({ ...PROFILE });
});

describe('AccountMenu', () => {
  it('shows the profile display name and image, and opens a labelled menu with the spec entries', async () => {
    const m = await mount();
    expect(m.trigger().textContent).toContain('Asha');
    expect(m.trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(m.trigger().getAttribute('aria-expanded')).toBe('false');
    expect(m.host.querySelector('img')?.getAttribute('src')).toBe(PROFILE.avatarUrl);
    await click(m.trigger());
    expect(m.trigger().getAttribute('aria-expanded')).toBe('true');
    expect(m.items().map(i => i.textContent?.trim())).toEqual(['My Profile', 'Edit Profile', 'Account Settings', 'Notifications', 'Invitations', 'Sign out']);
    // keyboard users land on the first item
    expect(document.activeElement).toBe(m.items()[0]);
    await m.unmount();
  });

  it('falls back to initials, then the session name, when there is no profile image or profile', async () => {
    mocks.me.mockResolvedValue(null);
    const m = await mount();
    expect(m.host.querySelector('img')).toBeNull();
    expect(m.trigger().textContent).toContain('Session');   // session name, first word
    expect(m.trigger().textContent).toContain('SN');         // initials avatar
    await m.unmount();
  });

  it('never renders a broken image: a failing avatar swaps to initials', async () => {
    const m = await mount();
    const img = m.host.querySelector('img')!;
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(m.host.querySelector('img')).toBeNull();
    expect(m.trigger().textContent).toContain('AR');
    await m.unmount();
  });

  it('updates immediately when the profile is saved elsewhere (no reload)', async () => {
    const m = await mount();
    await act(async () => { publishMyProfile('230001', { handle: 'asha-rao', displayName: 'Ashaa Updated', avatarUrl: null }); });
    expect(m.trigger().textContent).toContain('Ashaa');
    expect(m.host.querySelector('img')).toBeNull();
    await m.unmount();
  });

  it('navigates to the profile and edit anchors and closes', async () => {
    const m = await mount();
    await click(m.trigger()); await click(m.items()[1]);
    expect(m.where()).toBe('/profile#edit-profile');
    expect(m.host.querySelector('[role="menu"]')).toBeNull();
    await click(m.trigger()); await click(m.items()[0]);
    expect(m.where()).toBe('/profile');
    await m.unmount();
  });

  it('runs the settings, notifications and sign-out actions', async () => {
    const m = await mount();
    const opened = vi.fn(); window.addEventListener(OPEN_NOTIFICATIONS_EVENT, opened);
    await click(m.trigger()); await click(m.items()[2]);
    expect(m.onChangeEmail).toHaveBeenCalledTimes(1);
    await click(m.trigger()); await click(m.items()[3]);
    expect(opened).toHaveBeenCalledTimes(1);
    await click(m.trigger()); await click(m.items()[5]);
    expect(m.onLogout).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, opened);
    await m.unmount();
  });

  it('supports arrow keys, Home/End, and Escape returning focus to the trigger', async () => {
    const m = await mount();
    await click(m.trigger());
    const list = m.items();
    await key(list[0], 'ArrowDown'); expect(document.activeElement).toBe(list[1]);
    await key(list[1], 'End'); expect(document.activeElement).toBe(list[5]);
    await key(list[5], 'ArrowDown'); expect(document.activeElement).toBe(list[0]);
    await key(list[0], 'ArrowUp'); expect(document.activeElement).toBe(list[5]);
    await key(list[5], 'Escape');
    expect(m.host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(m.trigger());
    await m.unmount();
  });

  it('opens from the keyboard with ArrowDown on the trigger', async () => {
    const m = await mount();
    await key(m.trigger(), 'ArrowDown');
    expect(m.host.querySelector('[role="menu"]')).not.toBeNull();
    await m.unmount();
  });

  it('closes on an outside click', async () => {
    const m = await mount();
    await click(m.trigger());
    await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(m.host.querySelector('[role="menu"]')).toBeNull();
    await m.unmount();
  });

  it('does not call the profile API without a token, and never leaks another account’s identity', async () => {
    mocks.token.current = null;
    const m = await mount();
    expect(mocks.me).not.toHaveBeenCalled();
    await m.unmount();
    publishMyProfile('999999', { handle: 'someone-else', displayName: 'Someone Else', avatarUrl: null });
    const m2 = await mount();   // different roll in the store → must not show it
    expect(m2.trigger().textContent).not.toContain('Someone');
    await m2.unmount();
  });
});

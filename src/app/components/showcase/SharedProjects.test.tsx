// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const m = vi.hoisted(() => ({ invitations: vi.fn(), shared: vi.fn(), accept: vi.fn(), decline: vi.fn() }));
vi.mock('../../lib/api', () => ({ api: { showcase: { collab: m } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./ShowcaseDialogs', () => ({
  TextPromptDialog: ({ initial, onSubmit }: { initial?: string; onSubmit: (v: string) => Promise<void> }) => <button data-testid="name-dialog" onClick={() => void onSubmit(initial ?? '')}>confirm name</button>,
}));

import { SharedProjects } from './SharedProjects';

const inv = (over: object = {}) => ({ id: 'i1', accessRole: 'editor', invitedAt: new Date().toISOString(), projectTitle: 'Festival Identity', projectStatus: 'draft', ownerName: 'Asha Rao', creditProposed: false, creditRole: null, ...over });
async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><SharedProjects roll="BOB" studentName="Bala Iyer" onSessionExpired={() => {}} /></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
  const btn = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  return { host, text: () => host.textContent ?? '', btn };
}
beforeEach(() => { document.body.innerHTML = ''; Object.values(m).forEach(f => f.mockReset()); m.shared.mockResolvedValue({ projects: [] }); });

describe('SharedProjects', () => {
  it('renders nothing at all when there is nothing to show', async () => {
    m.invitations.mockResolvedValue({ invitations: [] });
    expect((await mount()).host.innerHTML).toBe('');
  });
  it('accepts access only — without agreeing to any public credit', async () => {
    m.invitations.mockResolvedValueOnce({ invitations: [inv({ creditProposed: true, creditRole: 'Illustrator' })] }).mockResolvedValue({ invitations: [] });
    m.accept.mockResolvedValue({ success: true, projectId: 'p1', credited: false });
    const { btn, text } = await mount();
    expect(text()).toContain('Asha Rao invited you as an editor');
    expect(text()).toContain('only appears publicly if you accept it');
    await act(async () => { btn('Accept')!.click(); });
    expect(m.accept).toHaveBeenCalledWith('BOB', 'i1');                 // no display name ⇒ the server leaves the credit pending
  });
  it('accepts the credit too only through the name dialog', async () => {
    m.invitations.mockResolvedValue({ invitations: [inv({ creditProposed: true })] });
    m.accept.mockResolvedValue({ success: true, projectId: 'p1', credited: true });
    const { btn, host } = await mount();
    await act(async () => { btn('Accept & be credited…')!.click(); });
    await act(async () => { (host.ownerDocument.querySelector('[data-testid="name-dialog"]') as HTMLElement).click(); });
    expect(m.accept).toHaveBeenCalledWith('BOB', 'i1', 'Bala Iyer');
  });
  it('offers no credit option when none was proposed', async () => {
    m.invitations.mockResolvedValue({ invitations: [inv()] });
    expect((await mount()).btn('Accept & be credited…')).toBeUndefined();
  });
  it('declines, and declines-and-blocks, with the right request', async () => {
    m.invitations.mockResolvedValue({ invitations: [inv()] });
    m.decline.mockResolvedValue({ success: true, blocked: false });
    const { btn } = await mount();
    await act(async () => { btn('Decline')!.click(); });
    expect(m.decline).toHaveBeenLastCalledWith('BOB', 'i1');
    await act(async () => { btn('Decline & block')!.click(); });
    expect(m.decline).toHaveBeenLastCalledWith('BOB', 'i1', true);
  });
  it('lists projects shared with me with my role and the owner’s name', async () => {
    m.invitations.mockResolvedValue({ invitations: [] });
    m.shared.mockResolvedValue({ projects: [{ id: 'p9', slug: 's', title: 'Poster Set', status: 'draft', updatedAt: new Date().toISOString(), accessRole: 'viewer', ownerName: 'Chitra Nair', coverUrl: null }] });
    const { text, host } = await mount();
    expect(text()).toContain('Poster Set');
    expect(text()).toContain('Chitra Nair’s project · you’re a viewer');
    expect(host.querySelector('a')!.getAttribute('href')).toBe('/showcase/manage/p9');
  });
  it('shows a retry when it cannot load', async () => {
    m.invitations.mockRejectedValue(new Error('x'));
    const { text } = await mount();
    expect(text()).toContain('Couldn’t load your collaboration invitations');
  });
});

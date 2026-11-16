// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ projects: vi.fn() }));
vi.mock('../../lib/api', () => ({ api: { creators: { projects: mocks.projects } } }));

import { MoreByCreator } from './MoreByCreator';

const P = (slug: string, title = slug) => ({ slug, title, summary: null, category: 'branding', featured: false, publishedAt: '2026-01-01', roleLabel: 'Designer', isOwner: true, coverUrl: null });
const OWNER = [{ displayName: 'Asha Rao', isOwner: true, profile: { handle: 'asha-rao' } }];

async function mount(credits = OWNER) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><MoreByCreator slug="current" credits={credits} /></MemoryRouter>));
  await act(async () => { await Promise.resolve(); });
  return { host, text: () => host.textContent ?? '', links: () => [...host.querySelectorAll('a')].map(a => a.getAttribute('href')) };
}
beforeEach(() => { document.body.innerHTML = ''; mocks.projects.mockReset(); });

describe('MoreByCreator', () => {
  it('lists the creator’s OTHER published projects (no repeat of the current one) and links to their profile', async () => {
    mocks.projects.mockResolvedValue({ projects: [P('current'), P('one'), P('two'), P('one')], total: 4, hasMore: false });
    const { links, text } = await mount();
    expect(mocks.projects).toHaveBeenCalledWith('asha-rao');
    expect(text()).toContain('More by Asha Rao');
    expect(links()).toEqual(['/designers/asha-rao', '/showcase/one', '/showcase/two']);
  });
  it('says so, and still links back to the profile, when it is their only project', async () => {
    mocks.projects.mockResolvedValue({ projects: [P('current')], total: 1, hasMore: false });
    const { text, links } = await mount();
    expect(text()).toContain('only published project so far');
    expect(links()).toEqual(['/designers/asha-rao']);
  });
  it('renders nothing — and makes no request — when the owner has no publicly linkable profile', async () => {
    const { host } = await mount([{ displayName: 'Asha Rao', isOwner: true }]);
    expect(host.innerHTML).toBe('');
    expect(mocks.projects).not.toHaveBeenCalled();
  });
  it('renders nothing when the directory answers 404 (profile went private)', async () => {
    mocks.projects.mockRejectedValue(new Error('Creator not found'));
    const { host } = await mount();
    expect(host.innerHTML).toBe('');
  });
  it('shows a retry on a transient failure and recovers', async () => {
    mocks.projects.mockRejectedValueOnce(new Error('Failed to fetch'));
    const { host, text } = await mount();
    expect(text()).toContain('Couldn’t load more projects');
    mocks.projects.mockResolvedValue({ projects: [P('one')], total: 1, hasMore: false });
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(text()).toContain('one');
  });
});

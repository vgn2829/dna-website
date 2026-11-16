// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const m = vi.hoisted(() => ({
  getMine: vi.fn(), update: vi.fn(), setWorks: vi.fn(), action: vi.fn(),
  collab: { activity: vi.fn(), comments: vi.fn(), invite: vi.fn(), setRole: vi.fn(), remove: vi.fn(), leave: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn() },
}));
vi.mock('../lib/api', () => ({
  api: {
    showcase: { getMine: m.getMine, update: m.update, setWorks: m.setWorks, action: m.action, disciplines: async () => ({ disciplines: [{ id: 'illus', title: 'Illustration' }] }), collab: m.collab },
    boards: { getMyBoards: async () => [{ id: 'b1', name: 'Secret moodboard' }] },
  },
}));
// Stable references, exactly as the real contexts provide them: a new function/object per render would re-trigger the page's load effect forever.
const ctx = vi.hoisted(() => {
  const session = { rollNumber: 'BOB', name: 'Bala Iyer' };
  const openRollModal = () => {};
  const ws = { id: 'w1', name: 'Me', is_personal: true, role: 'owner' };
  return { student: { studentSession: session, openRollModal }, workspace: { activeWorkspaceId: 'w1', workspaces: [ws], personalWorkspace: ws } };
});
vi.mock('../context/StudentContext', () => ({ useStudent: () => ctx.student }));
vi.mock('../context/WorkspaceContext', () => ({ useWorkspace: () => ctx.workspace }));
vi.mock('../components/showcase/ShowcaseAssetPicker', () => ({ ShowcaseAssetPicker: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ShowcaseEditorPage from './ShowcaseEditorPage';

const ALL = ['view', 'comment', 'edit_content', 'edit_works', 'remove_any_work', 'edit_references', 'manage_collaborators', 'manage_credits', 'lifecycle', 'delete_project', 'moderate_comments'];
const PERMS = { owner: ALL, editor: ['view', 'comment', 'edit_content', 'edit_works'], viewer: ['view', 'comment'] };

function project(access: 'owner' | 'editor' | 'viewer', over: object = {}) {
  return {
    id: 'p1', slug: 'festival', title: 'Festival Identity', summary: 'A festival identity system', description: 'Posters and wayfinding for the festival, designed as one system.', category: 'branding',
    tags: [], links: [], status: 'draft', reviewNote: null, featured: false, submittedAt: null, publishedAt: null, createdAt: '', updatedAt: '2026-11-01T00:00:00Z', editable: true,
    disciplines: [{ id: 'illus', title: 'Illustration' }],
    works: [
      { id: 'w-own', assetId: 'a1', caption: 'Hero', isCover: true, position: 0, filename: 'hero.png', previewUrl: '/x/hero.png', width: 40, height: 24, sourceMissing: false, published: false, addedByYou: access === 'owner' },
      { id: 'w-bob', assetId: 'a2', caption: null, isCover: false, position: 1, filename: 'bob.png', previewUrl: '/x/bob.png', width: 40, height: 24, sourceMissing: false, published: false, addedByYou: access === 'editor' },
    ],
    credits: [{ id: 'k1', roll: access === 'owner' ? 'ALICE' : null, roleLabel: 'Creator', contribution: null, displayName: 'Asha Rao', status: 'accepted', isOwner: true }],
    boards: access === 'owner' ? [{ id: 'b1', name: 'Secret moodboard' }] : [], artworks: [], events: [{ from: null, to: 'draft', by: 'student', reason: null, at: '2026-11-01T00:00:00Z' }], problems: [], viewerIsOwner: access === 'owner',
    access, permissions: PERMS[access], contentEditable: true,
    collaborators: [{ id: 'owner', name: 'Asha Rao', accessRole: 'owner', status: 'accepted', isYou: access === 'owner', invitedAt: null }, ...(access === 'owner' ? [] : [{ id: 'c1', name: 'Bala Iyer', accessRole: access, status: 'accepted', isYou: true, invitedAt: '2026-11-01T00:00:00Z' }])],
    ...over,
  };
}

async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={['/showcase/manage/p1']}><Routes><Route path="/showcase/manage/:id" element={<ShowcaseEditorPage />} /></Routes></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const btn = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const disabled = (sel: string) => (host.querySelector(sel) as HTMLInputElement).closest('fieldset[disabled]') !== null || (host.querySelector(sel) as HTMLInputElement).disabled;
  return { host, text: () => host.textContent ?? '', btn, disabled };
}
beforeEach(() => {
  document.body.innerHTML = ''; vi.clearAllMocks();
  m.collab.activity.mockResolvedValue({ items: [], next: null }); m.collab.comments.mockResolvedValue({ comments: [] });
});

describe('ShowcaseEditorPage by role', () => {
  it('OWNER sees every control', async () => {
    m.getMine.mockResolvedValue(project('owner'));
    const { text, btn, host } = await mount();
    expect(btn('Submit for review')).toBeDefined();
    expect(btn('Save details')).toBeDefined();
    expect(host.querySelector('#sc-credit-name')).not.toBeNull();
    expect(text()).toContain('Process moodboards');
    expect(host.querySelector('form[aria-label="Invite a collaborator"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Remove image 1"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Remove image 2"]')).not.toBeNull();
  });

  it('EDITOR edits details and their own images only — no owner credit, moodboards, lifecycle, invitations or removing others’ images', async () => {
    m.getMine.mockResolvedValue(project('editor'));
    const { text, btn, host } = await mount();
    expect(text()).toContain('You’re an editor');
    expect(btn('Save details')).toBeDefined();
    expect(btn('Submit for review')).toBeUndefined();
    expect(btn('Delete')).toBeUndefined();
    expect(host.querySelector('#sc-credit-name')).toBeNull();
    expect(text()).not.toContain('Process moodboards');
    expect(text()).not.toContain('Secret moodboard');
    expect(host.querySelector('form[aria-label="Invite a collaborator"]')).toBeNull();
    expect(host.querySelector('select[aria-label^="Role for"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Remove image 1"]')).toBeNull();     // the owner's image
    expect(host.querySelector('button[aria-label="Remove image 2"]')).not.toBeNull();  // their own
    expect(host.querySelector('#sc-title')!.closest('fieldset[disabled]')).toBeNull();
    expect(btn('Leave project')).toBeDefined();
  });

  it('EDITOR never sends the owner-credit fields when saving', async () => {
    m.getMine.mockResolvedValue(project('editor'));
    m.update.mockResolvedValue(project('editor', { title: 'Renamed' }));
    const { host, btn } = await mount();
    const title = host.querySelector('#sc-title') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Renamed'); title.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { btn('Save details')!.click(); });
    expect(m.update).toHaveBeenCalledTimes(1);
    const sent = m.update.mock.calls[0][2];
    expect(sent.title).toBe('Renamed');
    expect('owner_display_name' in sent).toBe(false);
    expect('owner_role_label' in sent).toBe(false);
  });

  it('VIEWER gets a read-only form, can still discuss and leave, and sees why', async () => {
    m.getMine.mockResolvedValue(project('viewer'));
    const { text, btn, host, disabled } = await mount();
    expect(text()).toContain('You’re a viewer');
    expect(text()).toContain('only editors and the owner can change it');
    expect(disabled('#sc-title')).toBe(true);
    expect(btn('Save details')).toBeUndefined();
    expect(btn('Submit for review')).toBeUndefined();
    expect(host.querySelector('button[aria-label^="Remove image"]')).toBeNull();
    expect(host.querySelector('#disc-draft')).not.toBeNull();                       // discussion stays open
    expect(btn('Leave project')).toBeDefined();
    expect(text()).not.toContain('Secret moodboard');
  });

  it('freezes everyone — owner included — once submitted, and says so', async () => {
    m.getMine.mockResolvedValue(project('editor', { status: 'submitted', editable: false, contentEditable: false }));
    const { text, btn, disabled } = await mount();
    expect(disabled('#sc-title')).toBe(true);
    expect(btn('Save details')).toBeUndefined();
    expect(text()).toContain('in review');
  });

  it('shows “not found” for a project the server hides (stranger / removed collaborator)', async () => {
    m.getMine.mockRejectedValue(new Error('Project not found'));
    const { text } = await mount();
    expect(text()).toContain('Project not found');
  });
});

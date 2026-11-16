// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const m = vi.hoisted(() => ({
  invite: vi.fn(), setRole: vi.fn(), remove: vi.fn(), leave: vi.fn(), activity: vi.fn(), comments: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn(),
  invitations: vi.fn(), shared: vi.fn(), accept: vi.fn(), decline: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api: { showcase: { collab: m } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ActivityFeed, CollaboratorsPanel, DiscussionPanel } from './Collaboration';
import type { ProjectCollaborator, ShowcaseProject } from '../../lib/api';

const OWNER_PERMS = ['view', 'comment', 'edit_content', 'edit_works', 'remove_any_work', 'edit_references', 'manage_collaborators', 'manage_credits', 'lifecycle', 'delete_project', 'moderate_comments'];
const people: ProjectCollaborator[] = [
  { id: 'owner', name: 'Asha Rao', accessRole: 'owner', status: 'accepted', isYou: true, invitedAt: null },
  { id: 'c1', name: 'Bala Iyer', accessRole: 'editor', status: 'accepted', isYou: false, invitedAt: '2026-11-01T00:00:00Z' },
  { id: 'c2', name: 'Chitra Nair', accessRole: 'viewer', status: 'pending', isYou: false, invitedAt: '2026-11-02T00:00:00Z' },
];
const project = (over: Partial<ShowcaseProject> = {}) => ({ id: 'p1', access: 'owner', permissions: OWNER_PERMS, contentEditable: true, collaborators: people, ...over }) as unknown as ShowcaseProject;

async function mount(node: React.ReactElement) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  await act(async () => { await Promise.resolve(); });
  return { host, text: () => host.textContent ?? '', q: <T extends Element>(sel: string) => host.querySelector(sel) as T | null, qa: <T extends Element>(sel: string) => [...host.querySelectorAll(sel)] as T[] };
}
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
beforeEach(() => { document.body.innerHTML = ''; Object.values(m).forEach(f => f.mockReset()); });

describe('CollaboratorsPanel', () => {
  it('lets the owner manage roles, withdraw/remove people, and invite — and nobody else', async () => {
    const { q, qa, text } = await mount(<CollaboratorsPanel project={project()} roll="ALICE" onChanged={() => {}} onLeft={() => {}} />);
    expect(text()).toContain('Waiting for a reply'.replace('W', 'w'));                    // pending shown honestly
    expect(qa('select[aria-label^="Role for"]').map(s => s.getAttribute('aria-label'))).toEqual(['Role for Bala Iyer', 'Role for Chitra Nair']);
    expect(q('button[aria-label="Remove Bala Iyer"]')).not.toBeNull();
    expect(q('button[aria-label="Withdraw invitation to Chitra Nair"]')).not.toBeNull();   // pending → withdraw, not remove
    expect(q('form[aria-label="Invite a collaborator"]')).not.toBeNull();
  });

  it('shows an editor the team and a Leave button, with no management controls', async () => {
    const me = people.map(p => (p.id === 'c1' ? { ...p, isYou: true } : { ...p, isYou: false }));
    const { q, qa, text } = await mount(<CollaboratorsPanel project={project({ access: 'editor', permissions: ['view', 'comment', 'edit_content', 'edit_works'] as never, collaborators: me })} roll="BOB" onChanged={() => {}} onLeft={() => {}} />);
    expect(qa('select').length).toBe(0);
    expect(q('form[aria-label="Invite a collaborator"]')).toBeNull();
    expect(qa('button[aria-label^="Remove"], button[aria-label^="Withdraw"]').length).toBe(0);
    expect([...document.querySelectorAll('button')].some(b => b.textContent === 'Leave project')).toBe(true);
    expect(text()).toContain('Bala Iyer (you)');
  });

  it('sends exactly one identifier, shows the server’s answer inline, and keeps what was typed', async () => {
    m.invite.mockRejectedValue(new Error('That student can’t be invited to this project'));
    const { q } = await mount(<CollaboratorsPanel project={project()} roll="ALICE" onChanged={() => {}} onLeft={() => {}} />);
    await type(q<HTMLInputElement>('#co-value')!, ' @Dev-Menon ');
    await click(q('form button[type="submit"]'));
    expect(m.invite).toHaveBeenCalledWith('ALICE', 'p1', { handle: 'dev-menon', access_role: 'editor' });
    expect(q('#co-error')!.textContent).toBe('That student can’t be invited to this project');
    expect(q<HTMLInputElement>('#co-value')!.value).toBe(' @Dev-Menon ');
  });

  it('proposes a public credit only when asked, and refuses an empty or malformed target client-side', async () => {
    m.invite.mockResolvedValue({ collaborators: people });
    const onChanged = vi.fn();
    const { q } = await mount(<CollaboratorsPanel project={project()} roll="ALICE" onChanged={onChanged} onLeft={() => {}} />);
    await type(q<HTMLInputElement>('#co-value')!, 'bad value!');
    await click(q('form button[type="submit"]'));
    expect(m.invite).not.toHaveBeenCalled();
    expect(q('#co-error')!.textContent).toMatch(/letters, numbers and hyphens/);
    await type(q<HTMLInputElement>('#co-value')!, 'dev-menon');
    await click(q('input[type="checkbox"]'));
    await type(q<HTMLInputElement>('input[aria-label="Credited role"]')!, 'Illustrator');
    await click(q('form button[type="submit"]'));
    expect(m.invite).toHaveBeenCalledWith('ALICE', 'p1', { handle: 'dev-menon', access_role: 'editor', role_label: 'Illustrator' });
    expect(onChanged).toHaveBeenCalledWith(people);
  });

  it('pauses invitations while the project is frozen for review', async () => {
    const { q, text } = await mount(<CollaboratorsPanel project={project({ contentEditable: false })} roll="ALICE" onChanged={() => {}} onLeft={() => {}} />);
    expect(q('form[aria-label="Invite a collaborator"]')).toBeNull();
    expect(text()).toContain('Invitations are paused');
  });
});

describe('ActivityFeed', () => {
  it('renders readable sentences, paginates, and de-duplicates', async () => {
    m.activity.mockResolvedValueOnce({ items: [{ id: '3', kind: 'collaborator.invited', at: new Date().toISOString(), actorName: 'Asha Rao', you: true, detail: { name: 'Bala Iyer', role: 'editor' } }], next: '3' })
      .mockResolvedValueOnce({ items: [{ id: '3', kind: 'x', at: '', actorName: 'dup', you: false, detail: {} }, { id: '2', kind: 'comment.added', at: new Date().toISOString(), actorName: 'Bala Iyer', you: false, detail: {} }], next: null });
    const { text, host } = await mount(<ActivityFeed projectId="p1" roll="ALICE" />);
    expect(text()).toContain('You invited Bala Iyer as an editor');
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Show older activity')!);
    expect(text()).toContain('Bala Iyer commented');
    expect(text()).not.toContain('dup');
    expect(host.querySelectorAll('li').length).toBe(2);
  });
  it('has distinct empty and error states', async () => {
    m.activity.mockResolvedValueOnce({ items: [], next: null });
    expect((await mount(<ActivityFeed projectId="p1" roll="ALICE" />)).text()).toContain('Nothing has happened yet');
    document.body.innerHTML = '';
    m.activity.mockRejectedValueOnce(new Error('x'));
    const failed = await mount(<ActivityFeed projectId="p1" roll="ALICE" />);
    expect(failed.text()).toContain('Couldn’t load activity');
    m.activity.mockResolvedValueOnce({ items: [], next: null });
    await click([...failed.host.querySelectorAll('button')].find(b => b.textContent === 'Try again')!);
    expect(failed.text()).toContain('Nothing has happened yet');
  });
});

describe('DiscussionPanel', () => {
  const c = (over: object = {}) => ({ id: 'k1', body: 'Hello team', at: new Date().toISOString(), authorName: 'Bala Iyer', mine: false, canDelete: false, ...over });
  it('renders message text as TEXT — markup in a comment never becomes elements', async () => {
    m.comments.mockResolvedValue({ comments: [c({ body: '<img src=x onerror="alert(1)"><b>bold</b>' })] });
    const { host, text } = await mount(<DiscussionPanel projectId="p1" roll="ALICE" canPost />);
    expect(text()).toContain('<img src=x onerror="alert(1)"><b>bold</b>');
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
  });
  it('shows delete only where the server allows it', async () => {
    m.comments.mockResolvedValue({ comments: [c({ id: 'a', canDelete: true, mine: true }), c({ id: 'b', authorName: 'Chitra Nair', canDelete: false })] });
    const { qa } = await mount(<DiscussionPanel projectId="p1" roll="BOB" canPost />);
    expect(qa('button[aria-label^="Delete comment"]').map(b => b.getAttribute('aria-label'))).toEqual(['Delete comment by you']);
  });
  it('posts a trimmed message, clears the box, then reloads; empty is not sendable', async () => {
    m.comments.mockResolvedValue({ comments: [] });
    m.addComment.mockResolvedValue({ id: 'new' });
    const onPosted = vi.fn();
    const { q, text } = await mount(<DiscussionPanel projectId="p1" roll="ALICE" canPost onPosted={onPosted} />);
    expect(text()).toContain('No messages yet');
    expect(q<HTMLButtonElement>('form button[type="submit"]')!.disabled).toBe(true);
    await type(q<HTMLTextAreaElement>('#disc-draft')!, '  Looks good!  ');
    await click(q('form button[type="submit"]'));
    expect(m.addComment).toHaveBeenCalledWith('ALICE', 'p1', 'Looks good!');
    expect(q<HTMLTextAreaElement>('#disc-draft')!.value).toBe('');
    expect(m.comments).toHaveBeenCalledTimes(2);
    expect(onPosted).toHaveBeenCalled();
  });
  it('hides the composer when the viewer cannot post, and offers a retry on failure', async () => {
    m.comments.mockRejectedValueOnce(new Error('x'));
    const { q, text, host } = await mount(<DiscussionPanel projectId="p1" roll="ALICE" canPost={false} />);
    expect(q('#disc-draft')).toBeNull();
    expect(text()).toContain('Couldn’t load the discussion');
    m.comments.mockResolvedValueOnce({ comments: [c()] });
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Try again')!);
    expect(text()).toContain('Hello team');
  });
});

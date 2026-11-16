// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const m = vi.hoisted(() => ({
  getMine: vi.fn(), update: vi.fn(), setWorks: vi.fn(), action: vi.fn(), setBoards: vi.fn(),
  collab: { activity: vi.fn(), comments: vi.fn(), invite: vi.fn(), setRole: vi.fn(), remove: vi.fn(), leave: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn() },
}));
vi.mock('../lib/api', () => ({
  api: {
    showcase: { getMine: m.getMine, update: m.update, setWorks: m.setWorks, action: m.action, setBoards: m.setBoards, disciplines: async () => ({ disciplines: [{ id: 'illus', title: 'Illustration' }] }), collab: m.collab },
    boards: { getMyBoards: async () => [{ id: 'b1', name: 'Mood' }] },
  },
}));
const ctx = vi.hoisted(() => {
  const session = { rollNumber: 'ALICE', name: 'Asha Rao' };
  const ws = { id: 'w1', name: 'Me', is_personal: true, role: 'owner' };
  return { student: { studentSession: session, openRollModal: () => {} }, workspace: { activeWorkspaceId: 'w1', workspaces: [ws], personalWorkspace: ws } };
});
vi.mock('../context/StudentContext', () => ({ useStudent: () => ctx.student }));
vi.mock('../context/WorkspaceContext', () => ({ useWorkspace: () => ctx.workspace }));
vi.mock('../components/showcase/ShowcaseAssetPicker', () => ({ ShowcaseAssetPicker: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ShowcaseEditorPage from './ShowcaseEditorPage';

const ALL = ['view', 'comment', 'edit_content', 'edit_works', 'remove_any_work', 'edit_references', 'manage_collaborators', 'manage_credits', 'lifecycle', 'delete_project', 'moderate_comments'];
function project(over: object = {}) {
  return {
    id: 'p1', slug: 'festival', title: 'Festival Identity', summary: 'A festival identity system', description: 'Posters and wayfinding for the festival, designed as one system.', category: 'branding',
    tags: ['festival'], links: [], status: 'draft', reviewNote: null, featured: false, submittedAt: null, publishedAt: null, createdAt: '', updatedAt: '2026-11-01T00:00:00Z', editable: true,
    disciplines: [{ id: 'illus', title: 'Illustration' }],
    works: [{ id: 'w1', assetId: 'a1', caption: null, isCover: true, position: 0, filename: 'hero.png', previewUrl: '/x/hero.png', width: 40, height: 24, sourceMissing: false, published: false, addedByYou: true }],
    credits: [{ id: 'k1', roll: 'ALICE', roleLabel: 'Creator', contribution: null, displayName: 'Asha Rao', status: 'accepted', isOwner: true }],
    boards: [], artworks: [], events: [{ from: null, to: 'draft', by: 'student', reason: null, at: '2026-11-01T00:00:00Z' }], problems: [], viewerIsOwner: true,
    access: 'owner', permissions: ALL, contentEditable: true,
    collaborators: [{ id: 'owner', name: 'Asha Rao', accessRole: 'owner', status: 'accepted', isYou: true, invitedAt: null }],
    ...over,
  };
}

function Where() { const l = useLocation(); return <output data-testid="loc">{l.search}</output>; }
async function mount(path = '/showcase/manage/p1') {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/showcase/manage/:id" element={<><ShowcaseEditorPage /><Where /></>} /></Routes></MemoryRouter>));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const btn = (label: string | RegExp) => [...host.querySelectorAll('button')].find(b => typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
  const click = (b: HTMLElement | undefined) => act(async () => { b!.click(); await Promise.resolve(); });
  const type = (sel: string, value: string) => act(async () => {
    const el = host.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
    const proto = el instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const current = () => host.querySelector('[aria-current="step"]')?.getAttribute('aria-label') ?? '';
  return { host, text: () => host.textContent ?? '', btn, click, type, current, loc: () => host.querySelector('[data-testid="loc"]')!.textContent };
}

beforeEach(() => {
  document.body.innerHTML = ''; vi.clearAllMocks();
  m.collab.activity.mockResolvedValue({ items: [], next: null }); m.collab.comments.mockResolvedValue({ comments: [] });
});

describe('seven-step wizard', () => {
  it('shows seven numbered steps with the current one marked', async () => {
    m.getMine.mockResolvedValue(project());
    const w = await mount('/showcase/manage/p1?step=3');
    const steps = w.host.querySelectorAll('ol.wiz-steps button');
    expect(steps).toHaveLength(7);
    expect(w.current()).toMatch(/^Step 3: Project story/);
    expect(w.host.querySelector('[role="progressbar"][aria-label="Submission progress"]')?.getAttribute('aria-valuenow')).toBe('3');
  });

  it('resumes a saved draft at the first incomplete step, and at review when nothing is missing', async () => {
    m.getMine.mockResolvedValue(project({ works: [], summary: 'ok summary here' }));
    const a = await mount();
    expect(a.current()).toMatch(/^Step 2: Cover and media/);
    document.body.innerHTML = '';
    m.getMine.mockResolvedValue(project());
    const b = await mount();
    expect(b.current()).toMatch(/^Step 7: Review and submit/);
  });

  it('a brand-new empty project starts at step 1', async () => {
    m.getMine.mockResolvedValue(project({ title: 'New project', summary: null, description: null, category: null, disciplines: [], works: [], tags: [] }));
    expect((await mount()).current()).toMatch(/^Step 1/);
  });

  it('blocks Continue with step-specific messages, and does not call the server', async () => {
    m.getMine.mockResolvedValue(project({ summary: null }));
    const w = await mount('/showcase/manage/p1?step=1');
    await w.click(w.btn(/Continue/));
    expect(w.host.querySelector('[role="alert"]')?.textContent).toContain('Add a short summary');
    expect(w.current()).toMatch(/^Step 1/);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('Continue saves the step’s edits, advances, and updates the URL', async () => {
    m.getMine.mockResolvedValue(project({ summary: null }));
    m.update.mockResolvedValue(project({ summary: 'A fresh summary line' }));
    const w = await mount('/showcase/manage/p1?step=1');
    await w.type('#sc-summary', 'A fresh summary line');
    await w.click(w.btn(/Continue/));
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0][2]).toMatchObject({ summary: 'A fresh summary line', title: 'Festival Identity' });
    expect(w.current()).toMatch(/^Step 2/);
    expect(w.loc()).toBe('?step=2');
  });

  it('Back keeps unsaved edits and never validates; they are saved with the next Continue', async () => {
    m.getMine.mockResolvedValue(project());
    m.update.mockResolvedValue(project({ description: 'x' }));
    const w = await mount('/showcase/manage/p1?step=3');
    await w.type('#sc-desc', 'x');                       // now invalid (too short) but Back must still work
    await w.click(w.btn(/Back/));
    expect(w.current()).toMatch(/^Step 2/);
    expect(m.update).not.toHaveBeenCalled();             // Back saves nothing
    await w.click(w.btn(/Continue/));                    // step 2 is valid; the pending edit is saved now
    expect(w.current()).toMatch(/^Step 3/);
    expect((w.host.querySelector('#sc-desc') as HTMLTextAreaElement).value).toBe('x');   // preserved across steps
    expect(m.update.mock.calls[0][2].description).toBe('x');
    await w.click(w.btn(/Continue/));
    expect(w.host.querySelector('[role="alert"]')?.textContent).toContain('at least 30 characters');   // and step 3 validates it
  });

  it('the stepper lets you revisit completed steps but not jump past an incomplete one', async () => {
    m.getMine.mockResolvedValue(project({ works: [] }));
    const w = await mount('/showcase/manage/p1?step=1');
    const steps = [...w.host.querySelectorAll('ol.wiz-steps button')] as HTMLButtonElement[];
    expect(steps[0].disabled).toBe(false);
    expect(steps[1].disabled).toBe(false);   // first incomplete step is reachable
    expect(steps[2].disabled).toBe(true);    // beyond it is not
    expect(steps[6].disabled).toBe(true);
  });

  it('story step offers prompts that append headings to the description', async () => {
    m.getMine.mockResolvedValue(project());
    const w = await mount('/showcase/manage/p1?step=3');
    await w.click(w.btn(/My process/));
    expect((w.host.querySelector('#sc-desc') as HTMLTextAreaElement).value).toMatch(/My process: $/);
  });

  it('shows the pending-contributor warning on the people step without blocking Continue', async () => {
    m.getMine.mockResolvedValue(project({ credits: [
      { id: 'k1', roll: 'ALICE', roleLabel: 'Creator', contribution: null, displayName: 'Asha Rao', status: 'accepted', isOwner: true },
      { id: 'k2', roll: 'BOB', roleLabel: 'Motion', contribution: null, displayName: null, status: 'pending', isOwner: false },
    ] }));
    const w = await mount('/showcase/manage/p1?step=4');
    expect(w.text()).toContain('hasn’t accepted yet');
    await w.click(w.btn(/Continue/));
    expect(w.current()).toMatch(/^Step 5/);
  });

  it('discovery step explains visibility (private until an admin publishes)', async () => {
    m.getMine.mockResolvedValue(project());
    const w = await mount('/showcase/manage/p1?step=6');
    expect(w.text()).toContain('only becomes public if the club approves and publishes it');
  });
});

describe('review and submit', () => {
  it('summarises every section with Edit links back to the right step', async () => {
    m.getMine.mockResolvedValue(project());
    const w = await mount('/showcase/manage/p1?step=7');
    for (const t of ['Project basics', 'Cover and media', 'Project story', 'Contributors', 'Tools and resources', 'Discovery details']) expect(w.host.querySelector(`section[aria-label="${t}"]`), t).not.toBeNull();
    await w.click(w.host.querySelector('button[aria-label="Edit Project story"]') as HTMLElement);
    expect(w.current()).toMatch(/^Step 3/);
  });

  it('shows server-side problems with a link to the step that fixes each, and disables Submit', async () => {
    m.getMine.mockResolvedValue(project({ problems: ['Waiting for contributors to accept their credit — remove or wait for them'] }));
    const w = await mount('/showcase/manage/p1?step=7');
    expect(w.text()).toContain('Fix these before submitting');
    expect(w.btn('Submit for review')!.disabled).toBe(true);
    await w.click(w.btn('Go to step'));
    expect(w.current()).toMatch(/^Step 4/);
  });

  it('submits exactly once even if clicked twice, then shows the success state and leaves the wizard', async () => {
    m.getMine.mockResolvedValue(project());
    let resolve!: (p: unknown) => void;
    m.action.mockImplementation(() => new Promise(r => { resolve = r; }));
    const w = await mount('/showcase/manage/p1?step=7');
    const submit = w.btn('Submit for review')!;
    await act(async () => { submit.click(); submit.click(); await Promise.resolve(); });
    expect(m.action).toHaveBeenCalledTimes(1);
    expect(m.action).toHaveBeenCalledWith('ALICE', 'p1', 'submit');
    expect(w.btn('Submitting…')?.disabled).toBe(true);
    await act(async () => { resolve(project({ status: 'submitted', editable: false, contentEditable: false })); await new Promise(r => setTimeout(r, 0)); });
    expect(w.host.querySelector('section[aria-label="Submitted"]')).not.toBeNull();
    expect(w.host.querySelector('ol.wiz-steps')).toBeNull();
  });

  it('keeps the wizard and surfaces the server’s current problems when submission fails', async () => {
    m.getMine.mockResolvedValue(project());
    m.action.mockRejectedValue(new Error('Waiting for contributors to accept their credit'));
    const w = await mount('/showcase/manage/p1?step=7');
    m.getMine.mockResolvedValue(project({ problems: ['Choose a cover image'] }));
    await w.click(w.btn('Submit for review'));
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(w.host.querySelector('ol.wiz-steps')).not.toBeNull();
    expect(w.text()).toContain('Choose a cover image');
    expect(w.btn('Submit for review')!.disabled).toBe(true);   // and can be retried once fixed
  });

  it('flushes unsaved edits before submitting', async () => {
    m.getMine.mockResolvedValue(project());
    m.update.mockResolvedValue(project());
    m.action.mockResolvedValue(project({ status: 'submitted', editable: false }));
    const w = await mount('/showcase/manage/p1?step=2');
    await w.click(w.btn(/Continue/));                    // 2 → 3
    await w.type('#sc-desc', 'An updated description that is comfortably long enough.');
    for (let i = 0; i < 4; i++) await w.click(w.btn(/Continue/));   // 3 → 7
    expect(w.current()).toMatch(/^Step 7/);
    await w.click(w.btn('Submit for review'));
    expect(m.action).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls.at(-1)![2].description).toContain('updated description');
  });
});

describe('outside the wizard', () => {
  it('a submitted (frozen) project shows the normal read-only page, not the wizard', async () => {
    m.getMine.mockResolvedValue(project({ status: 'submitted', editable: false, contentEditable: false }));
    const w = await mount();
    expect(w.host.querySelector('ol.wiz-steps')).toBeNull();
    expect((w.host.querySelector('#sc-title') as HTMLInputElement).closest('fieldset[disabled]')).not.toBeNull();
  });
  it('changes-requested projects re-enter the wizard and show the reviewer’s note', async () => {
    m.getMine.mockResolvedValue(project({ status: 'changes_requested', reviewNote: 'Please add a longer description' }));
    const w = await mount();
    expect(w.host.querySelector('ol.wiz-steps')).not.toBeNull();
    expect(w.text()).toContain('Please add a longer description');
  });
  it('ignores a malformed ?step= and resumes normally', async () => {
    m.getMine.mockResolvedValue(project());
    expect((await mount('/showcase/manage/p1?step=99')).current()).toMatch(/^Step 7/);
  });
});

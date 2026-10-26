import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { workspaceListLoading, workspacePageGate } from './workspaceLoad';

describe('workspaceListLoading (hard refresh / direct URL / new tab)', () => {
  it('is loading on the first render for a signed-in user, before any fetch has started', () => {
    expect(workspaceListLoading('230301', false, null)).toBe(true);
  });
  it('is loading while a fetch is in flight, and done once it settled for this roll', () => {
    expect(workspaceListLoading('230301', true, null)).toBe(true);
    expect(workspaceListLoading('230301', true, '230301')).toBe(true); // a refresh in flight
    expect(workspaceListLoading('230301', false, '230301')).toBe(false);
  });
  it('treats a list settled for a different (previous) user as not loaded', () => {
    expect(workspaceListLoading('230302', false, '230301')).toBe(true);
  });
  it('is not loading when signed out', () => {
    expect(workspaceListLoading(null, false, null)).toBe(false);
  });
});

describe('workspacePageGate', () => {
  const base = { loading: false, loadError: null, workspaceCount: 0, hasTargetWorkspace: false } as const;
  it('first render after a refresh shows loading — never "no workspace"', () => {
    expect(workspacePageGate({ ...base, loading: workspaceListLoading('230301', false, null) })).toBe('loading');
  });
  it('a failed load shows an error (retry / sign in), not an empty "no workspace" state', () => {
    expect(workspacePageGate({ ...base, loadError: 'failed' })).toBe('error');
    expect(workspacePageGate({ ...base, loadError: 'session-expired' })).toBe('error');
  });
  it('a loaded list shows the page', () => {
    expect(workspacePageGate({ ...base, workspaceCount: 2, hasTargetWorkspace: true })).toBe('ready');
  });
  it('keeps an already-shown list usable while it reloads or after a failed refresh', () => {
    expect(workspacePageGate({ ...base, loading: true, workspaceCount: 2, hasTargetWorkspace: true })).toBe('ready');
    expect(workspacePageGate({ ...base, loadError: 'failed', workspaceCount: 2, hasTargetWorkspace: true })).toBe('ready');
  });
  it('"no workspace" only when the load genuinely succeeded with nothing to show', () => {
    expect(workspacePageGate(base)).toBe('no-workspace');
  });
});

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('workspace-scoped pages and context use these decisions', () => {
  it('WorkspaceContext derives loading from workspaceListLoading and reports load errors', () => {
    const ctx = read('context/WorkspaceContext.tsx');
    expect(ctx).toMatch(/const loading = workspaceListLoading\(roll, fetching, settledRoll\)/);
    expect(ctx).toMatch(/setLoadError\(/);
    expect(ctx).not.toMatch(/useState\(false\);\s*\n\s*const \[activeWorkspaceId/); // the old `loading` initialised to false
  });
  it.each(['pages/AssetsPage.tsx', 'pages/TemplatesPage.tsx', 'pages/ProjectsPage.tsx'])('%s gates on workspacePageGate and renders the load error', file => {
    const src = read(file);
    expect(src).toMatch(/workspacePageGate\(/);
    expect(src).toMatch(/<WorkspaceLoadErrorState/);
  });
  it('board comments are not fetched before the board id is known (no /api/boards//comments)', () => {
    expect(read('components/hooks/useBoardComments.ts')).toMatch(/if \(!roll \|\| !boardId\) return;\s*\n\s*let cancelled = false;\s*\n\s*setLoading\(true\);/);
  });
});

import { describe, it, expect } from 'vitest';
import { filterWorkspaces, showAllWorkspacesOption, workspaceLabel, workspaceContext, personalFallbackNote, ALL_WORKSPACES_LABEL } from './workspaceSearch';

const ws = [
  { is_personal: true, name: 'roll-123 personal' },
  { is_personal: false, name: 'Design Team' },
  { is_personal: false, name: 'Branding — Campaign 2026' },
];

describe('workspaceLabel', () => {
  it('shows the personal workspace as "Personal", never its stored name', () => {
    expect(workspaceLabel(ws[0])).toBe('Personal');
    expect(workspaceLabel(ws[1])).toBe('Design Team');
  });
});

describe('filterWorkspaces', () => {
  it('returns the list unchanged for a blank query', () => {
    expect(filterWorkspaces(ws, '   ')).toBe(ws);
  });
  it('matches the display label case-insensitively', () => {
    expect(filterWorkspaces(ws, 'design').map(w => w.name)).toEqual(['Design Team']);
    expect(filterWorkspaces(ws, 'PERSONAL')).toEqual([ws[0]]);
  });
  it('does not match the personal workspace by its hidden stored name', () => {
    expect(filterWorkspaces(ws, 'roll-123')).toEqual([]);
  });
});

describe('showAllWorkspacesOption', () => {
  it('is offered only when there is more than one workspace', () => {
    expect(showAllWorkspacesOption([])).toBe(false);
    expect(showAllWorkspacesOption([ws[0]])).toBe(false);
    expect(showAllWorkspacesOption(ws.slice(0, 2))).toBe(true);
    expect(showAllWorkspacesOption(ws)).toBe(true);
  });
  it('depends on the full list, not the search-filtered one', () => {
    // A query that matches nothing (or one workspace) must not hide it.
    expect(filterWorkspaces(ws, 'no such workspace')).toEqual([]);
    expect(showAllWorkspacesOption(ws)).toBe(true);
  });
});

describe('workspaceContext (one source for the switcher and page captions)', () => {
  const personal = { id: 'p', name: 'roll personal', is_personal: true };
  const team = { id: 'd', name: 'Design Team', is_personal: false };

  it('names a selected workspace the same way everywhere', () => {
    expect(workspaceContext(team, { spansAllWorkspaces: true })).toEqual({ label: 'Design Team', fallbackToPersonal: false });
    expect(workspaceContext(team, { spansAllWorkspaces: false })).toEqual({ label: 'Design Team', fallbackToPersonal: false });
    expect(workspaceContext(personal, { spansAllWorkspaces: false })).toEqual({ label: 'Personal', fallbackToPersonal: false });
  });

  it('says "All Workspaces" (never a specific workspace) where the page spans them all', () => {
    expect(workspaceContext(null, { spansAllWorkspaces: true })).toEqual({ label: ALL_WORKSPACES_LABEL, fallbackToPersonal: false });
  });

  it('on per-workspace pages, "Personal" under "All Workspaces" is flagged as a fallback, not presented as the selection', () => {
    expect(workspaceContext(null, { spansAllWorkspaces: false })).toEqual({ label: 'Personal', fallbackToPersonal: true });
    expect(personalFallbackNote('assets')).toBe("All Workspaces doesn't apply to assets — showing your Personal workspace.");
  });
});

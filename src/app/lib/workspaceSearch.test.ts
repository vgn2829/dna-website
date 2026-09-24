import { describe, it, expect } from 'vitest';
import { filterWorkspaces, workspaceLabel } from './workspaceSearch';

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

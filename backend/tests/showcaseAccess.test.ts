import { describe, expect, it } from 'vitest';
import { can, contentIsEditable, type Access, type Permission } from '../src/lib/showcaseAccess';

// The permission matrix is the contract the routes enforce. Spelling it out
// here means widening a role by accident fails a test, not a code review.
const ALL: Permission[] = ['view', 'comment', 'edit_content', 'edit_works', 'remove_any_work', 'edit_references', 'manage_collaborators', 'manage_credits', 'lifecycle', 'delete_project', 'moderate_comments'];
const EXPECT: Record<Access, Permission[]> = {
  owner: ALL,
  editor: ['view', 'comment', 'edit_content', 'edit_works'],
  viewer: ['view', 'comment'],
};

describe('permission matrix', () => {
  for (const role of ['owner', 'editor', 'viewer'] as Access[]) {
    it(`${role} has exactly the documented permissions`, () => {
      expect(ALL.filter(p => can(role, p)).sort()).toEqual([...EXPECT[role]].sort());
    });
  }
  it('gives a non-collaborator nothing', () => {
    for (const p of ALL) { expect(can(null, p)).toBe(false); expect(can(undefined, p)).toBe(false); }
  });
  it('never lets an editor invite, publish/submit/archive, delete, or transfer anything', () => {
    for (const p of ['manage_collaborators', 'manage_credits', 'lifecycle', 'delete_project', 'remove_any_work', 'edit_references'] as Permission[]) expect(can('editor', p)).toBe(false);
  });
  it('lets a viewer read and discuss but never change content', () => {
    for (const p of ['edit_content', 'edit_works'] as Permission[]) expect(can('viewer', p)).toBe(false);
  });
});

describe('contentIsEditable', () => {
  it('freezes content during review and after publication, for every role alike', () => {
    expect(contentIsEditable('draft')).toBe(true);
    expect(contentIsEditable('changes_requested')).toBe(true);
    for (const s of ['submitted', 'approved', 'published', 'rejected', 'archived'] as const) expect(contentIsEditable(s)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { buildInviteBody, can, describeActivity, inviteProblem, readOnlyReason, relativeTime } from './collaboration';

const item = (kind: string, detail: Record<string, unknown> = {}, over: Partial<{ actorName: string; you: boolean }> = {}) => ({ kind, detail, actorName: 'Asha Rao', you: false, ...over });

describe('can', () => {
  it('trusts only the server-provided permission list', () => {
    expect(can({ permissions: ['view', 'comment'] }, 'comment')).toBe(true);
    expect(can({ permissions: ['view', 'comment'] }, 'edit_content')).toBe(false);
    expect(can({ permissions: [] }, 'view')).toBe(false);
  });
});

describe('invite input', () => {
  it('validates the kind of identifier before sending', () => {
    expect(inviteProblem('username', '@asha-rao')).toBeNull();
    expect(inviteProblem('username', 'has space')).not.toBeNull();
    expect(inviteProblem('username', '')).toMatch(/Enter a username/);
    expect(inviteProblem('roll', '230123')).toBeNull();
    expect(inviteProblem('roll', '23 01')).not.toBeNull();
    expect(inviteProblem('roll', '  ')).toMatch(/roll number/);
  });
  it('builds exactly one identifier, normalised, with an optional credit proposal', () => {
    expect(buildInviteBody({ kind: 'username', value: ' @Asha-Rao ', role: 'editor', creditRole: '', contribution: '' })).toEqual({ handle: 'asha-rao', access_role: 'editor' });
    expect(buildInviteBody({ kind: 'roll', value: 'y20123', role: 'viewer', creditRole: ' Illustrator ', contribution: ' Poster set ' })).toEqual({ roll: 'Y20123', access_role: 'viewer', role_label: 'Illustrator', contribution: 'Poster set' });
    expect(buildInviteBody({ kind: 'roll', value: '', role: 'viewer', creditRole: '', contribution: '' })).toBeNull();
    const b = buildInviteBody({ kind: 'username', value: 'bo', role: 'editor', creditRole: '', contribution: '' })!;
    expect('roll' in b && 'handle' in b).toBe(false);
  });
});

describe('describeActivity', () => {
  it('words each kind as one plain sentence, using “You” for the viewer’s own actions', () => {
    expect(describeActivity(item('collaborator.invited', { name: 'Bala', role: 'editor' }))).toBe('Asha Rao invited Bala as an editor');
    expect(describeActivity(item('collaborator.invited', { name: 'Bala', role: 'viewer' }, { you: true }))).toBe('You invited Bala as a viewer');
    expect(describeActivity(item('collaborator.accepted', { name: 'Bala', role: 'editor', credited: true }))).toBe('Bala joined as an editor and accepted a credit');
    expect(describeActivity(item('collaborator.declined', { name: 'Bala' }))).toBe('Bala declined an invitation');
    expect(describeActivity(item('collaborator.withdrawn', { name: 'Bala' }))).toBe('Asha Rao withdrew the invitation to Bala');
    expect(describeActivity(item('collaborator.removed', { name: 'Bala', removedWorks: 2 }))).toBe('Asha Rao removed Bala and their 2 images');
    expect(describeActivity(item('collaborator.removed', { name: 'Bala', removedWorks: 0 }))).toBe('Asha Rao removed Bala');
    expect(describeActivity(item('collaborator.left', { name: 'Bala', removedWorks: 1 }))).toBe('Bala left the project and took 1 image with them');
    expect(describeActivity(item('collaborator.role_changed', { name: 'Bala', role: 'viewer' }))).toBe('Asha Rao made Bala a viewer');
    expect(describeActivity(item('comment.added'))).toBe('Asha Rao commented');
  });
  it('summarises edits without leaking content', () => {
    expect(describeActivity(item('content.updated', { fields: ['title', 'summary', 'links'] }))).toBe('Asha Rao edited the title, the summary and the links');
    expect(describeActivity(item('content.updated', { fields: ['owner_display_name', 'owner_role_label'] }))).toBe('Asha Rao edited the owner credit');
    expect(describeActivity(item('content.updated', {}))).toBe('Asha Rao edited the project');
    expect(describeActivity(item('works.updated', { added: 2, removed: 1 }))).toBe('Asha Rao added 2 images and removed 1 image');
    expect(describeActivity(item('works.updated', { added: 0, removed: 0 }))).toBe('Asha Rao reorganised the images');
  });
  it('words status changes, attributing reviewer actions to the team', () => {
    expect(describeActivity(item('status.changed', { to: 'submitted' }))).toMatch(/moved the project to “.+”/);
    expect(describeActivity(item('status.changed', { to: 'published' }, { actorName: 'The DnA team' }))).toMatch(/^The DnA team moved/);
    expect(describeActivity(item('status.changed', { to: 'nonsense' }))).toBe('Asha Rao changed the project status');
  });
  it('never throws on an unknown kind or malformed detail', () => {
    expect(describeActivity(item('future.kind'))).toBe('Asha Rao made a change');
    expect(describeActivity(item('collaborator.invited', { name: 42, role: null }))).toBe('Asha Rao invited someone as a collaborator');
    expect(describeActivity(item('content.updated', { fields: 'title' }))).toBe('Asha Rao edited the project');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  it('rounds sensibly', () => {
    expect(relativeTime('2026-11-16T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-11-16T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-11-16T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-14T12:00:00Z', now)).toBe('2 d ago');
    expect(relativeTime('2026-01-01T12:00:00Z', now)).toMatch(/2026/);
    expect(relativeTime('not a date', now)).toBe('');
    expect(relativeTime('2026-11-16T12:05:00Z', now)).toBe('just now');   // clock skew never shows "in the future"
  });
});

describe('readOnlyReason', () => {
  const base = { access: 'editor' as const, permissions: ['view', 'comment', 'edit_content', 'edit_works'] as never[], contentEditable: true, status: 'draft' as const };
  it('explains each read-only situation, and says nothing when editing is possible', () => {
    expect(readOnlyReason(base)).toBeNull();
    expect(readOnlyReason({ ...base, access: 'viewer', permissions: ['view', 'comment'] as never[] })).toMatch(/only editors and the owner/);
    expect(readOnlyReason({ ...base, contentEditable: false, status: 'submitted' })).toMatch(/in review/);
    expect(readOnlyReason({ ...base, contentEditable: false, status: 'published' })).toMatch(/published/);
  });
});

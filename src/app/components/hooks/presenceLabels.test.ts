import { describe, it, expect } from 'vitest';
import {
  PLACEHOLDER_USER_NAME,
  activityWord,
  collaboratorAriaLabel,
  collaboratorCountLabel,
  collaboratorDisplayName,
  collaboratorInitial,
} from './presenceLabels';

// Unit tests for the only branching logic in the Phase 1 collaborator UI.
// Everything else (cursors, selections, join/leave, the presence records
// themselves) is tldraw's own behavior driven by real websocket data, and
// is verified by the two-client browser QA rather than mocked here — see
// presenceLabels.ts's own header for why the split is drawn at this line.

describe('collaboratorDisplayName', () => {
  it('prefers the presence record name', () => {
    expect(collaboratorDisplayName('Bhavna Editor', '240280')).toBe('Bhavna Editor');
  });

  it('falls back to the userId when presence has no name yet', () => {
    // useCollaboratorIds can be one tick ahead of the presence detail for
    // a just-joined user; the avatar must still render something stable.
    expect(collaboratorDisplayName(undefined, '240280')).toBe('240280');
  });

  it('falls back when @tldraw/sync is still using its placeholder name', () => {
    // sync seeds presence with 'New User' before the client's real
    // userInfo propagates — showing it would flash a meaningless avatar.
    expect(collaboratorDisplayName(PLACEHOLDER_USER_NAME, '240280')).toBe('240280');
  });

  it('falls back on a blank or whitespace-only name', () => {
    expect(collaboratorDisplayName('', '240280')).toBe('240280');
    expect(collaboratorDisplayName('   ', '240280')).toBe('240280');
  });
});

describe('collaboratorInitial', () => {
  it('uppercases the first character', () => {
    expect(collaboratorInitial('bhavna')).toBe('B');
    expect(collaboratorInitial('Aarav Owner')).toBe('A');
  });

  it('handles a numeric roll-number fallback', () => {
    expect(collaboratorInitial('240280')).toBe('2');
  });

  it('never returns empty, so the avatar always has a glyph', () => {
    expect(collaboratorInitial('')).toBe('?');
  });
});

describe('activityWord', () => {
  it('renders each tldraw activity state as text, not colour', () => {
    expect(activityWord('active')).toBe('active');
    expect(activityWord('idle')).toBe('idle');
    expect(activityWord('inactive')).toBe('away');
  });
});

describe('collaboratorAriaLabel', () => {
  it('names the person and their state', () => {
    expect(collaboratorAriaLabel('Aarav Owner', 'active', false))
      .toBe('Aarav Owner, active. Activate to follow.');
  });

  it('describes the follow affordance differently while following', () => {
    expect(collaboratorAriaLabel('Aarav Owner', 'idle', true))
      .toBe('Aarav Owner, idle. Following — activate to stop following.');
  });

  it('always includes the state as a word (never colour-only)', () => {
    for (const state of ['active', 'idle', 'inactive'] as const) {
      expect(collaboratorAriaLabel('X', state, false)).toContain(activityWord(state));
    }
  });
});

describe('collaboratorCountLabel', () => {
  it('uses the singular for one other person', () => {
    expect(collaboratorCountLabel(1)).toBe('1 other person on this board');
  });

  it('uses the plural for more than one', () => {
    expect(collaboratorCountLabel(2)).toBe('2 other people on this board');
    expect(collaboratorCountLabel(7)).toBe('7 other people on this board');
  });

  it('uses the plural for zero', () => {
    // The list renders nothing at zero, but the label must still read
    // correctly if it is ever announced during a transition.
    expect(collaboratorCountLabel(0)).toBe('0 other people on this board');
  });
});

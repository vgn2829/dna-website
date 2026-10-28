import { describe, expect, it } from 'vitest';
import type { Board } from './api';
import { favoriteShortcuts } from './boardShortcuts';
const board = (id: string, patch: Partial<Board> = {}) => ({ id, is_favorite:true, is_archived:false, updated_at:'2026-10-29', ...patch } as Board);
describe('favorite board shortcuts', () => {
  it('deduplicates an owned shared board and excludes archived/non-favorite boards', () => {
    const owned = [board('overlap'), board('archived',{is_archived:true}), board('ordinary',{is_favorite:false})];
    const shared = [board('overlap'), board('older',{updated_at:'2026-10-28'})];
    expect(favoriteShortcuts(owned,shared).map(b=>b.id)).toEqual(['overlap','older']);
    expect(owned).toHaveLength(3);
    expect(shared).toHaveLength(2);
  });
  it('handles empty collections', () => expect(favoriteShortcuts([],[])).toEqual([]));
});

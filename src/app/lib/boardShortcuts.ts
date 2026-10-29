import type { Board } from './api';

/** A shared board can also be owned: shortcuts contain each board only once. */
export function favoriteShortcuts(owned: Board[], shared: Board[]): Board[] {
  return [...new Map([...owned, ...shared].filter(b => b.is_favorite && !b.is_archived).map(b => [b.id, b])).values()]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

import type { VideoResource } from '../context/AppDataContext';

/** Count only distinct lessons that still exist in the displayed catalog. */
export function lessonProgress(videos: Pick<VideoResource, 'id'>[], watchedIds: string[]) {
  const ids = new Set(videos.map(v => v.id));
  const watched = new Set(watchedIds);
  const completed = [...ids].filter(id => watched.has(id)).length;
  return { completed, total: ids.size, remaining: ids.size - completed, pct: ids.size ? Math.round(completed / ids.size * 100) : 0 };
}

/** The API owns ordering (sequence, then creation time). Never re-sort ties. */
export function suggestedLesson(videos: VideoResource[], watchedIds: string[]) {
  const watched = new Set(watchedIds);
  return videos.find(v => !watched.has(v.id)) ?? videos[0] ?? null;
}

export function filterLessons(videos: VideoResource[], watchedIds: string[], query: string, difficulty: string, status: string) {
  const watched = new Set(watchedIds);
  const q = query.trim().toLocaleLowerCase();
  return videos.filter(v => (!q || v.title.toLocaleLowerCase().includes(q)) &&
    (!difficulty || v.difficulty === difficulty) &&
    (status === 'unfinished' ? !watched.has(v.id) : status === 'watched' ? watched.has(v.id) : true));
}

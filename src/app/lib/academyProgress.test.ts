import { describe, expect, it } from 'vitest';
import { filterLessons, lessonProgress, suggestedLesson } from './academyProgress';
import type { VideoResource } from '../context/AppDataContext';
const videos: VideoResource[] = [
  { id: 'a', title: 'Layers and Masks', difficulty: 'Beginner', duration: '10 mins', ytId: 'one', sequence: 1 },
  { id: 'b', title: 'Advanced Color', difficulty: 'Advanced', duration: '20 mins', ytId: 'two', sequence: 1 },
  { id: 'c', title: 'Color study', difficulty: 'Intermediate', duration: '12 mins', ytId: 'three', sequence: 2 },
];
describe('Academy discovery and progress', () => {
  it('excludes removed IDs and duplicate progress/catalog IDs', () => {
    expect(lessonProgress([...videos, videos[0]], ['a', 'a', 'removed'])).toEqual({completed:1,total:3,remaining:2,pct:33});
    expect(lessonProgress([], ['removed']).pct).toBe(0);
  });
  it('recommends first unfinished in API order, including sequence ties', () => {
    expect(suggestedLesson(videos, ['a'])?.id).toBe('b');
    expect(suggestedLesson(videos, ['a','b','c'])?.id).toBe('a');
    expect(suggestedLesson([], [])).toBeNull();
  });
  it('combines title, difficulty and completion filters without mutating order', () => {
    expect(filterLessons(videos,['b'],' COLOR ','','unfinished').map(v=>v.id)).toEqual(['c']);
    expect(filterLessons(videos,['b'],'','Advanced','watched').map(v=>v.id)).toEqual(['b']);
    expect(filterLessons(videos,[],'missing','','')).toEqual([]);
    expect(videos.map(v=>v.id)).toEqual(['a','b','c']);
  });
});

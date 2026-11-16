import { describe, expect, it } from 'vitest';
import { readingOrder, startIndexFor, stepIndex, swipeDirection, type BoardImageShape } from './lightbox';

const img = (id: string, x: number, y: number, o: Partial<BoardImageShape> = {}): BoardImageShape => ({ id, x, y, w: 200, h: 150, src: `/i/${id}.png`, ...o });

describe('stepIndex', () => {
  it('wraps both ways and tolerates empty lists', () => {
    expect(stepIndex(0, -1, 5)).toBe(4); expect(stepIndex(4, 1, 5)).toBe(0); expect(stepIndex(2, 1, 5)).toBe(3);
    expect(stepIndex(0, 1, 1)).toBe(0); expect(stepIndex(3, 1, 0)).toBe(0); expect(stepIndex(1, -7, 5)).toBe(4);
  });
});
describe('readingOrder', () => {
  it('orders rows top-to-bottom and each row left-to-right, regardless of creation order', () => {
    const r = readingOrder([img('d', 300, 400), img('b', 300, 5), img('a', 0, 0), img('c', 0, 405)]);
    expect(r.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('treats slightly misaligned neighbours as one row', () => {
    expect(readingOrder([img('right', 250, 20), img('left', 0, 0)]).map(i => i.id)).toEqual(['left', 'right']);
  });
  it('drops images with no usable source instead of showing a broken one', () => {
    const r = readingOrder([img('ok', 0, 0), img('none', 10, 0, { src: null }), img('blank', 20, 0, { src: '  ' }), img('undef', 30, 0, { src: undefined })]);
    expect(r.map(i => i.id)).toEqual(['ok']);
  });
  it('carries labels through and handles an empty board', () => {
    expect(readingOrder([img('a', 0, 0, { label: 'ref.png' })])[0]).toEqual({ id: 'a', src: '/i/a.png', label: 'ref.png' });
    expect(readingOrder([])).toEqual([]);
  });
});
describe('startIndexFor', () => {
  it('opens on the selected image, else the first', () => {
    const items = readingOrder([img('a', 0, 0), img('b', 300, 0), img('c', 600, 0)]);
    expect(startIndexFor(items, ['c'])).toBe(2);
    expect(startIndexFor(items, ['nope'])).toBe(0);
    expect(startIndexFor(items, [])).toBe(0);
  });
});
describe('swipeDirection', () => {
  it('needs a long, mostly horizontal swipe', () => {
    expect(swipeDirection(-80, 5)).toBe(1); expect(swipeDirection(80, 5)).toBe(-1);
    expect(swipeDirection(20, 0)).toBe(0); expect(swipeDirection(60, 90)).toBe(0);
  });
});

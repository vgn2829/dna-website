import { describe, expect, it } from 'vitest';
import {
  EXPORT_MAX_PIXELS,
  EXPORT_MAX_SIDE,
  exportFileName,
  fitInsertSize,
  planExport,
  planTidyGrid,
  type LayoutBox,
} from './boardLayout';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('planTidyGrid', () => {
  const messy: LayoutBox[] = [
    { id: 'a', x: 500, y: 40, w: 300, h: 200 },
    { id: 'b', x: 10, y: 0, w: 120, h: 400 },
    { id: 'c', x: 90, y: 700, w: 250, h: 250 },
    { id: 'd', x: 700, y: 600, w: 180, h: 90 },
    { id: 'e', x: 300, y: 330, w: 400, h: 120 },
    { id: 'f', x: 20, y: 900, w: 60, h: 60 },
  ];

  it('returns one placement per box and nothing for an empty list', () => {
    expect(planTidyGrid([])).toEqual([]);
    expect(planTidyGrid(messy).map(p => p.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('never overlaps boxes (each keeps its own size)', () => {
    const placed = planTidyGrid(messy).map(p => ({ ...messy.find(b => b.id === p.id)!, x: p.x, y: p.y }));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i], placed[j])).toBe(false);
    }
  });

  it('stays anchored at the original top-left corner', () => {
    const placed = planTidyGrid(messy);
    expect(Math.min(...placed.map(p => p.x))).toBe(10);
    expect(Math.min(...placed.map(p => p.y))).toBe(0);
  });

  it('keeps reading order: items on the same visual row stay left-to-right', () => {
    const row: LayoutBox[] = [
      { id: 'right', x: 400, y: 5, w: 100, h: 100 },
      { id: 'left', x: 0, y: 0, w: 100, h: 100 },
      { id: 'mid', x: 200, y: 12, w: 100, h: 100 },
    ];
    expect(planTidyGrid(row).map(p => p.id)).toEqual(['left', 'mid', 'right']);
  });

  it('wraps into several rows instead of one long strip', () => {
    const many: LayoutBox[] = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, x: i * 500, y: 0, w: 200, h: 200 }));
    const ys = new Set(planTidyGrid(many).map(p => p.y));
    expect(ys.size).toBeGreaterThan(1);
  });

  it('handles a single box without moving it', () => {
    expect(planTidyGrid([{ id: 'only', x: 7, y: 9, w: 50, h: 50 }])).toEqual([{ id: 'only', x: 7, y: 9 }]);
  });
});

describe('planExport', () => {
  it('leaves a normal board at the requested scale', () => {
    const plan = planExport(1000, 600, 2);
    expect(plan).toMatchObject({ scale: 2, reduced: false, ok: true, width: 2128, height: 1328 });
  });

  it('reduces the scale for huge boards so the bitmap stays inside browser limits', () => {
    const plan = planExport(20000, 12000, 3);
    expect(plan.reduced).toBe(true);
    expect(plan.ok).toBe(true);
    expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(EXPORT_MAX_SIDE);
    expect(plan.width * plan.height).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
    expect(plan.scale).toBeLessThan(1);
  });

  it('preserves the aspect ratio when scaling down', () => {
    const plan = planExport(18000, 6000, 2);
    expect(plan.width / plan.height).toBeCloseTo((18000 + 64) / (6000 + 64), 2);
  });

  it('reports degenerate bounds as not ok', () => {
    expect(planExport(Number.NaN, 100, 1, 0).ok).toBe(false);
    expect(planExport(0, 0, 1, 0).ok).toBe(false);
  });

  it('falls back to scale 1 for a nonsense request', () => {
    expect(planExport(100, 100, -3).scale).toBe(1);
  });
});

describe('exportFileName', () => {
  it('makes a safe, readable file name', () => {
    expect(exportFileName('My Board: Spring/Summer 2026!', 'png')).toBe('my-board-springsummer-2026.png');
  });
  it('never returns an empty base name', () => {
    expect(exportFileName('///', 'svg')).toBe('moodboard.svg');
  });
});

describe('fitInsertSize', () => {
  it('shrinks large images to fit while preserving aspect ratio', () => {
    const r = fitInsertSize(4000, 2000);
    expect(r).toEqual({ w: 400, h: 200 });
  });
  it('never upscales small images', () => {
    expect(fitInsertSize(120, 80)).toEqual({ w: 120, h: 80 });
  });
  it('keeps extreme panoramas visible', () => {
    const r = fitInsertSize(8000, 10);
    expect(r.w).toBe(400);
    expect(r.h).toBeGreaterThanOrEqual(32);
  });
  it('falls back to a square for unknown dimensions', () => {
    expect(fitInsertSize(0, 0)).toEqual({ w: 300, h: 300 });
    expect(fitInsertSize(Number.NaN, 10)).toEqual({ w: 300, h: 300 });
  });
});

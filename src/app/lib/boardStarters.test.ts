import { describe, expect, it } from 'vitest';
import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultHorizontalAlignStyle,
  DefaultSizeStyle,
  DefaultVerticalAlignStyle,
  GeoShapeGeoStyle,
} from 'tldraw';
import { STARTER_LAYOUTS, cellGrid, countStarterShapes, getStarterLayout, type StarterShape } from './boardStarters';
import { starterShapeToPartial } from './tldrawBoardTools';

const NOTE = 200;
const TEXT_SIZE_PX = { s: 18, m: 24, l: 36, xl: 44 } as const;

function extent(s: StarterShape): { w: number; h: number } {
  switch (s.kind) {
    case 'note': return { w: NOTE, h: NOTE };
    case 'text': return { w: s.text.length * TEXT_SIZE_PX[s.size ?? 'm'] * 0.6, h: TEXT_SIZE_PX[s.size ?? 'm'] * 1.4 };
    default: return { w: s.w, h: s.h };
  }
}

describe('starter layouts', () => {
  it('ships a useful set with unique ids and distinct use cases', () => {
    expect(STARTER_LAYOUTS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(STARTER_LAYOUTS.map(l => l.id)).size).toBe(STARTER_LAYOUTS.length);
    expect(new Set(STARTER_LAYOUTS.map(l => l.useCase)).size).toBe(STARTER_LAYOUTS.length);
    for (const l of STARTER_LAYOUTS) {
      expect(l.name.trim()).not.toBe('');
      expect(countStarterShapes(l.shapes)).toBeGreaterThan(4);
    }
  });

  it('looks layouts up by id and rejects unknown ones', () => {
    expect(getStarterLayout('storyboard')?.id).toBe('storyboard');
    expect(getStarterLayout('nope')).toBeNull();
    expect(getStarterLayout('')).toBeNull();
    expect(getStarterLayout(null)).toBeNull();
  });

  for (const layout of STARTER_LAYOUTS) {
    describe(layout.id, () => {
      it('keeps every frame child inside its frame', () => {
        const check = (shapes: readonly StarterShape[]) => {
          for (const s of shapes) {
            if (s.kind !== 'frame') continue;
            for (const c of s.children) {
              const e = extent(c);
              expect(c.x, `${s.name}: child x`).toBeGreaterThanOrEqual(0);
              expect(c.y, `${s.name}: child y`).toBeGreaterThanOrEqual(0);
              expect(c.x + e.w, `${s.name}: child right edge`).toBeLessThanOrEqual(s.w);
              expect(c.y + e.h, `${s.name}: child bottom edge`).toBeLessThanOrEqual(s.h);
            }
            check(s.children);
          }
        };
        check(layout.shapes);
      });

      it('has no overlapping top-level frames', () => {
        const frames = layout.shapes.filter((s): s is Extract<StarterShape, { kind: 'frame' }> => s.kind === 'frame');
        for (let i = 0; i < frames.length; i++) {
          for (let j = i + 1; j < frames.length; j++) {
            const a = frames[i], b = frames[j];
            const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            expect(hit, `${a.name} vs ${b.name}`).toBe(false);
          }
        }
      });

      it('only uses style values tldraw accepts (so shapes are valid, editable records)', () => {
        const visit = (spec: StarterShape) => {
          const p = starterShapeToPartial(spec).props as Record<string, unknown>;
          if (spec.kind === 'slot' || spec.kind === 'swatch') {
            expect(() => GeoShapeGeoStyle.validate(p.geo)).not.toThrow();
            expect(() => DefaultFillStyle.validate(p.fill)).not.toThrow();
            expect(() => DefaultDashStyle.validate(p.dash)).not.toThrow();
            expect(() => DefaultSizeStyle.validate(p.size)).not.toThrow();
            expect(() => DefaultColorStyle.validate(p.color)).not.toThrow();
            expect(() => DefaultColorStyle.validate(p.labelColor)).not.toThrow();
            expect(() => DefaultHorizontalAlignStyle.validate(p.align)).not.toThrow();
            expect(() => DefaultVerticalAlignStyle.validate(p.verticalAlign)).not.toThrow();
          }
          if (spec.kind === 'note' || spec.kind === 'text') {
            expect(() => DefaultColorStyle.validate(p.color)).not.toThrow();
          }
          if (spec.kind === 'text') expect(() => DefaultSizeStyle.validate(p.size)).not.toThrow();
          if (spec.kind === 'frame') {
            expect(typeof p.name).toBe('string');
            spec.children.forEach(visit);
          }
        };
        layout.shapes.forEach(visit);
      });
    });
  }
});

describe('cellGrid', () => {
  it('tiles cells inside the box without overlap', () => {
    const cells = cellGrid(10, 20, 500, 300, 3, 2, 20);
    expect(cells).toHaveLength(6);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(10);
      expect(c.x + c.w).toBeLessThanOrEqual(510);
      expect(c.y + c.h).toBeLessThanOrEqual(320);
    }
  });
});

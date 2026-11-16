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
import { STARTER_LAYOUTS, cellGrid, countImageSlots, countStarterShapes, getStarterLayout, starterPreview, type StarterShape } from './boardStarters';
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

describe('starter catalogue and previews', () => {
  it('covers the creative workflows the club works in (ten layouts, one per use case)', () => {
    expect(STARTER_LAYOUTS.map(l => l.id)).toEqual(expect.arrayContaining(['inspiration', 'palette-type', 'character-sheet', 'brand-identity', 'storyboard', 'project-brief', 'ui-ux-reference', 'motion-style-frames', 'photo-series', 'poster-exploration']));
    expect(STARTER_LAYOUTS).toHaveLength(10);
    for (const l of STARTER_LAYOUTS) expect(l.description.length, l.id).toBeGreaterThan(30);
  });
  it('every layout has a non-degenerate preview whose items all sit inside its bounds', () => {
    for (const l of STARTER_LAYOUTS) {
      const p = starterPreview(l);
      expect(p.width, l.id).toBeGreaterThan(100); expect(p.height, l.id).toBeGreaterThan(100);
      expect(p.items.length, l.id).toBeGreaterThan(4);
      for (const i of p.items) {
        expect(i.x, l.id).toBeGreaterThanOrEqual(0); expect(i.y, l.id).toBeGreaterThanOrEqual(0);
        expect(i.x + i.w, l.id).toBeLessThanOrEqual(p.width + 0.001); expect(i.y + i.h, l.id).toBeLessThanOrEqual(p.height + 0.001);
      }
    }
  });
  it('the preview is derived from the real shapes (item count tracks the layout, nested frames are absolute)', () => {
    const sb = getStarterLayout('storyboard')!;
    expect(starterPreview(sb).items.filter(i => i.kind === 'frame')).toHaveLength(6);
    const brand = starterPreview(getStarterLayout('brand-identity')!);
    expect(brand.items.filter(i => i.kind === 'swatch')).toHaveLength(4);
  });
  it('counts image slots, including those nested in frames', () => {
    expect(countImageSlots(getStarterLayout('photo-series')!.shapes)).toBe(7);
    expect(countImageSlots(getStarterLayout('ui-ux-reference')!.shapes)).toBe(10);
    expect(countImageSlots([])).toBe(0);
  });
});

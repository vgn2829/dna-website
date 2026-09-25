import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guards for the two design-token rules added in the first UI remediation
// batch. theme.css is plain CSS, so these read the rule text directly.
const css = fs.readFileSync(path.resolve(__dirname, 'theme.css'), 'utf8');
const rule = (selector: string) => {
  const m = css.match(new RegExp(`${selector.replace(/[.:]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  expect(m, `${selector} not found in theme.css`).not.toBeNull();
  return m![1];
};
const prop = (body: string, name: string) => body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();

describe('display typography tracking', () => {
  // Spec (Typography › Hierarchy) at the desktop size each clamp tops out at.
  const SPEC = { 'type-display-xxl': [110, -5.5], 'type-display-xl': [85, -4.25], 'type-display-lg': [62, -3.1], 'type-display-md': [32, -1.0] } as const;

  for (const [cls, [size, px]] of Object.entries(SPEC)) {
    it(`.${cls} scales tracking with size and matches the spec at ${size}px`, () => {
      const body = rule(`.${cls}`);
      const ls = prop(body, 'letter-spacing')!;
      expect(ls, 'tracking must be proportional (em), not fixed px').toMatch(/^-?[\d.]+em$/);
      expect(parseFloat(ls) * size).toBeCloseTo(px, 2);
      expect(prop(body, 'font-size')).toContain(`${size}px)`); // clamp max unchanged
    });
  }

  it('keeps the same percentage at the mobile clamp minimum (no word collisions)', () => {
    const body = rule('.type-display-xxl');
    const min = parseFloat(prop(body, 'font-size')!.match(/clamp\(([\d.]+)px/)![1]);
    const trackingPx = parseFloat(prop(body, 'letter-spacing')!) * min;
    expect(trackingPx / min).toBeCloseTo(-0.05, 5); // was -5.5 / 52 = -10.6%
  });
});

describe('.touch-target', () => {
  it('grows the hit area with a centred ::after of at least --touch-min', () => {
    const after = rule('.touch-target::after');
    expect(prop(after, 'content')).toBe("''");
    expect(prop(after, 'position')).toBe('absolute');
    expect(prop(after, 'width')).toBe('max(100%, var(--touch-min))');
    expect(prop(after, 'height')).toBe('max(100%, var(--touch-min))');
    expect(prop(after, 'transform')).toBe('translate(-50%, -50%)');
  });

  it('is 40px by default and 44px on coarse (touch) pointers', () => {
    expect(prop(rule('.touch-target'), '--touch-min')).toBe('40px');
    const coarse = css.match(/@media \(pointer: coarse\)\s*\{\s*\.touch-target\s*\{([^}]*)\}/);
    expect(coarse, 'pointer: coarse override missing').not.toBeNull();
    expect(prop(coarse![1], '--touch-min')).toBe('44px');
  });

  it('only adds a containing block — no visual properties', () => {
    const body = rule('.touch-target');
    expect(body).not.toMatch(/\b(width|height|padding|margin|background|border)\b/);
  });
});

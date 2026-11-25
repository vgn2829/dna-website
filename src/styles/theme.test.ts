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

describe('button primitives (H4)', () => {
  it('primary = inverse pill, secondary = charcoal pill, both 44px pills at the spec size', () => {
    const primary = rule('.btn-primary'), secondary = rule('.btn-secondary');
    expect(prop(primary, 'background')).toBe('var(--color-inverse-canvas)');
    expect(prop(secondary, 'background')).toBe('var(--color-surface-1)');
    for (const b of [primary, secondary]) {
      expect(prop(b, 'border-radius')).toBe('var(--radius-pill)');
      expect(prop(b, 'min-height')).toBe('44px');
      expect(prop(b, 'font-size')).toBe('14px');
      expect(prop(b, 'font-weight')).toBe('500');
      expect(prop(b, 'border')).toBe('none'); // no bordered ghost treatment
    }
  });

  it('.btn-sm is a compact VISUAL size only (the hit area stays with .touch-target)', () => {
    const sm = rule('.btn-sm');
    expect(prop(sm, 'min-height')).toBe('32px');
    expect(prop(sm, 'font-size')).toBe('13px'); // caption tier
    expect(sm).not.toMatch(/::after|--touch-min/);
    const iconSm = rule('.btn-icon.btn-sm');
    expect([prop(iconSm, 'width'), prop(iconSm, 'height')]).toEqual(['32px', '32px']);
  });

  it('translucent (lifted) secondary keeps its surface-2 lift when combined with .btn-icon', () => {
    expect(prop(rule('.btn-translucent'), 'background')).toBe('var(--color-surface-2)');
    expect(prop(rule('.btn-translucent.btn-icon'), 'background')).toBe('var(--color-surface-2)');
    // declared after .btn-icon so it actually wins
    expect(css.indexOf('.btn-translucent.btn-icon {')).toBeGreaterThan(css.indexOf('.btn-icon {'));
  });

  it('destructive variants use only the existing semantic error tokens', () => {
    expect(prop(rule('.btn-danger'), 'background')).toBe('var(--color-error-fill)');
    expect(css).toMatch(/\.btn-secondary\.is-danger,\s*\.btn-translucent\.is-danger,\s*\.btn-icon\.is-danger \{ color: var\(--color-error\); \}/);
  });

  it('disabled buttons are dimmed and not-allowed, with no pressed transform', () => {
    const d = css.match(/\.btn-primary:disabled,\s*\.btn-secondary:disabled,\s*\.btn-translucent:disabled,\s*\.btn-icon:disabled \{([^}]*)\}/);
    expect(d, 'disabled rule missing').not.toBeNull();
    expect(prop(d![1], 'opacity')).toBe('0.5');
    expect(prop(d![1], 'cursor')).toBe('not-allowed');
    expect(prop(d![1], 'transform')).toBe('none');
  });

  it('an active toggle (aria-pressed) takes the brand accent as a selected indicator', () => {
    expect(css).toMatch(/\.btn-secondary\[aria-pressed="true"\],\s*\.btn-translucent\[aria-pressed="true"\],\s*\.btn-icon\[aria-pressed="true"\] \{ background: var\(--color-brand\); color: #fff; \}/);
  });
});

describe('.segmented control (H4)', () => {
  it('selected item is a surface lift, not a colour fill (spec: pricing-tab-selected)', () => {
    const sel = css.match(/\.segmented-item\[aria-selected="true"\],\s*\.segmented-item\[aria-pressed="true"\] \{([^}]*)\}/);
    expect(sel).not.toBeNull();
    expect(prop(sel![1], 'background')).toBe('var(--color-surface-2)');
    expect(sel![1]).not.toMatch(/--color-brand/);
    expect(prop(rule('.segmented'), 'border-radius')).toBe('var(--radius-pill)');
    const item = css.match(/\n\s*\.segmented-item \{([^}]*)\}/)![1]; // the standalone rule, not `.is-block > .segmented-item`
    expect(prop(item, 'font-weight')).toBe('500');
    expect(prop(item, 'border-radius')).toBe('var(--radius-pill)');
    expect(prop(item, 'padding')).toBe('7px 14px'); // 31px item + 4px inset = 40px tab (H3)
  });
});

describe('spacing + touch tokens (Batch 3)', () => {
  it('.ws-main padding is built from spacing tokens (was 32/36/56px and 20/16/48px)', () => {
    expect(css).toContain('.ws-main { padding: var(--space-xl) var(--space-xl) var(--space-xxl); }');
    expect(css).toContain('.ws-main { padding: var(--space-lg) var(--space-md) var(--space-xxl); }');
  });

  it('on touch, segmented items pad themselves to a 44px control (their scroll container clips ::after growth)', () => {
    const m = css.match(/@media \(pointer: coarse\) \{[^{}]*\.segmented-item \{([^}]*)\}/);
    expect(m, 'coarse .segmented-item rule missing').not.toBeNull();
    expect(prop(m![1], 'padding-top')).toBe('10px');
    expect(prop(m![1], 'padding-bottom')).toBe('10px');
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

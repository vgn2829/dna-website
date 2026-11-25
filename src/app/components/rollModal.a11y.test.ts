import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Frontend tests run in node (no DOM — see vitest.config.mts), so the
// sign-in dialog's runtime behaviour (Escape, focus trap, focus return,
// inert background) is covered by browser QA. This guards the markup
// contract those behaviours depend on, so a refactor can't silently drop it.
const src = fs.readFileSync(path.resolve(__dirname, 'RollModal.tsx'), 'utf8');

describe('RollModal accessibility contract', () => {
  it('is a labelled modal dialog', () => {
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/aria-labelledby=\{titleId\}/);
    expect(src).toMatch(/<h2 id=\{titleId\}/);
  });

  it('uses useModalA11y (Escape, focus trap, focus return) with focus starting on the roll field', () => {
    expect(src).toMatch(/useModalA11y\(dialogOpen, handleClose, \{ initialFocus: \(\) => rollInputRef\.current \}\)/);
    expect(src).toMatch(/rollInputRef\.current = el;/);
  });

  it('does not autoFocus the roll field (it would steal focus before the opener is recorded)', () => {
    const rollInput = src.slice(src.indexOf('id={rollInputId}'), src.indexOf('{rollMessage && ('));
    expect(rollInput).not.toMatch(/\bautoFocus\b/);
  });

  it('makes the page behind it inert, and portals itself outside #root', () => {
    expect(src).toMatch(/setAttribute\('inert', ''\)/);
    expect(src).toMatch(/removeAttribute\('inert'\)/);
    expect(src).toMatch(/createPortal\(/);
    // the inert effect must be declared before the hook so focus can return on close
    expect(src.indexOf("setAttribute('inert'")).toBeLessThan(src.indexOf('useModalA11y(dialogOpen'));
  });

  it('associates every visible field label with its input', () => {
    for (const id of ['rollInputId', 'nameInputId', 'emailInputId', 'codeInputId']) {
      expect(src, id).toMatch(new RegExp(`<label htmlFor=\\{${id}\\}`));
      expect(src, id).toMatch(new RegExp(`id=\\{${id}\\}`));
    }
  });

  it('exposes roll validation errors accessibly and validates before the network call', () => {
    expect(src).toMatch(/aria-invalid=\{rollMessage \? true : undefined\}/);
    expect(src).toMatch(/aria-describedby=\{rollMessage \? rollErrorId : undefined\}/);
    expect(src).toMatch(/<p id=\{rollErrorId\} role="alert"/);
    const handler = src.slice(src.indexOf('const handleRollContinue'), src.indexOf('// Step 2'));
    expect(handler.indexOf("check.status === 'invalid'")).toBeLessThan(handler.indexOf('api.students.checkExists'));
  });

  it('gives the icon-only close button a name', () => {
    expect(src).toMatch(/aria-label="Close sign-in"/);
  });
});

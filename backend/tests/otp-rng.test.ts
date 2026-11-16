import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { newOtpCode } from '../src/routes/auth';

// Login and email-change codes are credentials. They must come from a CSPRNG,
// never Math.random() (predictable from its own outputs).
describe('OTP code generation', () => {
  it('produces uniform-looking six-digit codes without touching Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random must not be used for OTP codes'); });
    try {
      const seen = new Set<string>();
      const lead = new Array(10).fill(0);
      for (let i = 0; i < 5000; i++) {
        const c = newOtpCode();
        expect(c).toMatch(/^[1-9][0-9]{5}$/);          // always six digits, never a leading zero (a stripped zero would break the input mask)
        seen.add(c); lead[Number(c[0])]++;
      }
      expect(seen.size).toBeGreaterThan(4900);           // essentially no collisions in 5000 draws from 900k
      for (let d = 1; d <= 9; d++) expect(lead[d]).toBeGreaterThan(300);   // each leading digit ≈ 555 expected
    } finally { spy.mockRestore(); }
  });
  it('is the only code generator in the auth routes', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/auth.ts'), 'utf8');
    expect(src).not.toMatch(/Math\.random\(\)/);
    expect((src.match(/newOtpCode\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

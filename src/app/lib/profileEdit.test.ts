import { describe, expect, it } from 'vitest';
import { avatarFileProblem, cleanSkills, diffFields, handleProblem, linkProblem, skillProblem, suggestHandle, tokenIdentityVerified } from './profileEdit';

const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

describe('handles', () => {
  it('accepts well-formed handles and explains bad ones', () => {
    expect(handleProblem('asha-rao')).toBeNull();
    expect(handleProblem('ab')).toMatch(/at least 3/);
    expect(handleProblem('x'.repeat(31))).toMatch(/at most 30/);
    for (const bad of ['1abc', 'Asha Rao', 'a--b', '-abc', 'abc-', 'a_b_c']) expect(handleProblem(bad)).not.toBeNull();
    expect(handleProblem('  Asha-Rao ')).toBeNull();  // trimmed + lowercased like the server
  });
  it('suggests a valid handle from a display name', () => {
    expect(suggestHandle('Asha Rao')).toBe('asha-rao');
    expect(suggestHandle('  Ñoño  García 99 ')).toBe('nono-garcia-99');
    expect(suggestHandle('2024 Batch')).toBe('batch');
    expect(suggestHandle('')).toBe('');
    expect(handleProblem(suggestHandle('Dr. Asha K. Rao-Iyer'))).toBeNull();
    expect(suggestHandle('x'.repeat(80)).length).toBeLessThanOrEqual(30);
  });
});

describe('links', () => {
  it('requires https and a host that matches the network', () => {
    expect(linkProblem('behance', 'https://www.behance.net/asha')).toBeNull();
    expect(linkProblem('youtube', 'https://youtu.be/abc')).toBeNull();
    expect(linkProblem('website', 'https://asha.design')).toBeNull();
    expect(linkProblem('behance', 'https://dribbble.com/asha')).toMatch(/Behance/);
    expect(linkProblem('website', 'http://asha.design')).toMatch(/https/);
    expect(linkProblem('website', 'https://user:pw@asha.design')).toMatch(/username/);
    for (const bad of ['https://localhost/x', 'https://127.0.0.1', 'https://intranet', 'javascript:alert(1)', '', 'asha.design']) {
      expect(linkProblem('other', bad)).not.toBeNull();
    }
  });
});

describe('skills', () => {
  it('lowercases, de-duplicates and validates', () => {
    expect(cleanSkills(['Figma', ' figma ', 'After  Effects', ''])).toEqual(['figma', 'after effects']);
    expect(skillProblem('c++')).toBeNull();
    expect(skillProblem('a')).toMatch(/at least 2/);
    expect(skillProblem('x'.repeat(31))).toMatch(/at most 30/);
    expect(skillProblem('<b>')).not.toBeNull();
  });
});

describe('tokenIdentityVerified (a hint only; the server enforces)', () => {
  it('is true only for an OTP-issued, non-bypass token', () => {
    expect(tokenIdentityVerified(jwt({ typ: 'student', roll: 'X', identityVerified: true }))).toBe(true);
    expect(tokenIdentityVerified(jwt({ typ: 'student', roll: 'X' }))).toBe(false);                               // legacy 90-day token
    expect(tokenIdentityVerified(jwt({ typ: 'student', roll: 'X', bypass: true }))).toBe(false);
    expect(tokenIdentityVerified(jwt({ identityVerified: true, bypass: true }))).toBe(false);
    expect(tokenIdentityVerified('garbage')).toBe(false);
    expect(tokenIdentityVerified(null)).toBe(false);
  });
});

describe('diffFields', () => {
  it('returns only changed fields', () => {
    expect(diffFields({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: null })).toEqual({ b: 'y' });
    expect(diffFields({ a: 1 }, { a: 1 })).toEqual({});
  });
});

describe('avatarFileProblem', () => {
  it('allows small JPG/PNG/WebP only', () => {
    expect(avatarFileProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(avatarFileProblem({ type: 'image/gif', size: 1000 })).toMatch(/JPG, PNG or WebP/);
    expect(avatarFileProblem({ type: 'image/svg+xml', size: 10 })).not.toBeNull();
    expect(avatarFileProblem({ type: 'image/jpeg', size: 3 * 1024 * 1024 })).toMatch(/2 MB/);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { checkRollNumber, ROLL_NUMBER_PATTERN, ROLL_NUMBER_MAX_LENGTH, ROLL_NUMBER_ERROR } from './rollNumber';

describe('checkRollNumber', () => {
  it('treats empty and whitespace-only input as empty, not invalid', () => {
    expect(checkRollNumber('')).toEqual({ status: 'empty' });
    expect(checkRollNumber('   ')).toEqual({ status: 'empty' });
  });

  it('rejects clearly invalid input with the inline message', () => {
    for (const bad of ['ab', 'abc123', '2', '23', '23456', 'AB1234', '23-0182', '23 0182', '230182!', '2301820123456']) {
      expect(checkRollNumber(bad), bad).toEqual({ status: 'invalid', message: ROLL_NUMBER_ERROR });
    }
  });

  it('accepts the real formats the backend accepts, trimmed', () => {
    expect(checkRollNumber('230182')).toEqual({ status: 'valid', value: '230182' });
    expect(checkRollNumber(' 230182 ')).toEqual({ status: 'valid', value: '230182' });
    expect(checkRollNumber('26uia001')).toEqual({ status: 'valid', value: '26uia001' }); // server uppercases
    expect(checkRollNumber('231040045')).toEqual({ status: 'valid', value: '231040045' }); // 9-digit PG roll
    expect(checkRollNumber('230000000000')).toEqual({ status: 'valid', value: '230000000000' }); // 12 = upper bound
  });

  it('keeps the input maxLength equal to the pattern upper bound', () => {
    expect(ROLL_NUMBER_MAX_LENGTH).toBe(12);
    expect(ROLL_NUMBER_PATTERN.test('2'.repeat(12))).toBe(true);
    expect(ROLL_NUMBER_PATTERN.test('2'.repeat(13))).toBe(false);
  });

  it('matches the backend ROLL_SCHEMA exactly (no frontend/backend mismatch)', () => {
    const auth = fs.readFileSync(path.resolve(__dirname, '../../../backend/src/routes/auth.ts'), 'utf8');
    const m = auth.match(/const ROLL_SCHEMA = z\.string\(\)\.regex\(\/(.+?)\/(\w*),/);
    expect(m, 'ROLL_SCHEMA not found in backend/src/routes/auth.ts').not.toBeNull();
    expect(ROLL_NUMBER_PATTERN.source).toBe(m![1]);
    expect(ROLL_NUMBER_PATTERN.flags).toBe(m![2]);
  });
});

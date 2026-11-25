import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Frontend tests run in node (no DOM — see vitest.config.mts), so the
// sign-in dialog's runtime behaviour (Escape, focus trap, focus return,
// inert background) is covered by browser QA. This guards the markup
// contract those behaviours depend on, so a refactor can't silently drop it.
const src = fs.readFileSync(path.resolve(__dirname, 'RollModal.tsx'), 'utf8');

describe('RollModal: change-email action on OTP screen', () => {
  it('tracks whether the OTP screen was reached via the new-student registration flow', () => {
    // isNewStudentFlow must be set to true when going to profile step, false for existing
    expect(src).toMatch(/isNewStudentFlow/);
    expect(src).toMatch(/setIsNewStudentFlow\(true\)/);
    expect(src).toMatch(/setIsNewStudentFlow\(false\)/);
  });

  it('shows Change email address only for the new-student flow', () => {
    // The button is conditionally rendered only when isNewStudentFlow is true
    expect(src).toMatch(/isNewStudentFlow.*Change email address/s);
    expect(src).toMatch(/handleChangeEmail/);
  });

  it('handleChangeEmail returns to profile step, clears the code and OTP error', () => {
    const handler = src.slice(src.indexOf('const handleChangeEmail'), src.indexOf('const handleBypass'));
    expect(handler).toMatch(/setStep\('profile'\)/);
    expect(handler).toMatch(/setCode\(''\)/);
    expect(handler).toMatch(/setOtpError\(''\)/);
    // Must NOT clear name or email (pre-filled for correction convenience)
    expect(handler).not.toMatch(/setName\(''\)/);
    expect(handler).not.toMatch(/setEmail\(''\)/);
  });

  it('profile step retains the confirmed roll number and cannot be changed from there to a new roll', () => {
    // The confirmed roll banner shows roll and a "Change" button that goes back to 'roll' step
    expect(src).toMatch(/step === 'profile'/);
    // "Change" in the profile step must navigate to 'roll' step (not allow arbitrary change here)
    const profileSection = src.slice(src.indexOf("key=\"profile\""), src.indexOf("key=\"otp\""));
    expect(profileSection).toMatch(/setStep\('roll'\)/);
    // Roll value is displayed but only the existing roll state is used (never re-entered on this step)
    expect(profileSection).toMatch(/\{roll\}/);
  });

  it('Use a different roll number is preserved and unchanged', () => {
    expect(src).toMatch(/Use a different roll number/);
    // The "Use a different roll number" button must call setStep('roll') and
    // setCode('') — search the whole OTP step block (from key="otp" onward)
    const otpStart = src.indexOf('key="otp"');
    const otpBlock = src.slice(otpStart);
    // The Use-a-different-roll-number button appears after the primary Verify button
    const diffRollIdx = otpBlock.indexOf('Use a different roll number');
    expect(diffRollIdx).toBeGreaterThan(0);
    // The onClick just before it must set step to roll
    const surroundingClick = otpBlock.slice(Math.max(0, diffRollIdx - 400), diffRollIdx + 50);
    expect(surroundingClick).toMatch(/setStep\('roll'\)/);
    expect(surroundingClick).toMatch(/setCode\(''\)/);
  });

  it('resetAll clears isNewStudentFlow on modal close', () => {
    const reset = src.slice(src.indexOf('const resetAll'), src.indexOf('const errMsg'));
    expect(reset).toMatch(/setIsNewStudentFlow\(false\)/);
  });

  it('existing-student path sets isNewStudentFlow to false before entering OTP', () => {
    // When an existing profile is found, isNewStudentFlow is set false before moving to 'otp'
    const handleRollSection = src.slice(
      src.indexOf('const handleRollContinue'),
      src.indexOf('const handleSendCode')
    );
    expect(handleRollSection).toMatch(/setIsNewStudentFlow\(false\)/);
  });

  it('Change email address link has visible label text', () => {
    expect(src).toMatch(/Entered the wrong email\?/);
    expect(src).toMatch(/Change email address/);
  });

  it('Change email address is visually secondary (no primary button style applied)', () => {
    // The change-email element must not use primaryBtn style (which would make it compete visually)
    const changeEmailSection = src.slice(
      src.indexOf('Entered the wrong email'),
      src.indexOf('Use a different roll number')
    );
    expect(changeEmailSection).not.toMatch(/primaryBtn/);
  });
});

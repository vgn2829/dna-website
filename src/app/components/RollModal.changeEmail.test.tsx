// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  checkExists: vi.fn(),
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
  bypassLogin: vi.fn(),
  getPublic: vi.fn(),
  closeRollModal: vi.fn(),
  login: vi.fn(),
  clearReverifyNotice: vi.fn(),
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef(({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: any, ref: any) => (
      <div ref={ref} {...rest}>{children}</div>
    )),
  },
}));

vi.mock('../lib/api', () => ({
  api: {
    students: {
      checkExists: mocks.checkExists,
      requestOtp: mocks.requestOtp,
      verifyOtp: mocks.verifyOtp,
      bypassLogin: mocks.bypassLogin,
    },
    settings: {
      getPublic: mocks.getPublic,
    },
  },
}));

vi.mock('../context/StudentContext', () => ({
  useStudent: () => ({
    isRollModalOpen: true,
    closeRollModal: mocks.closeRollModal,
    login: mocks.login,
    needsReverify: false,
    clearReverifyNotice: mocks.clearReverifyNotice,
  }),
  hasSeenWelcome: () => true,
  markWelcomeSeen: vi.fn(),
}));

vi.mock('./WelcomeOverlay', () => ({
  default: () => null,
}));

import { RollModal } from './RollModal';

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function findButton(text: string): HTMLButtonElement {
  const btn = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  if (!btn) throw new Error(`Button "${text}" not found`);
  return btn;
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

async function mountModal() {
  const rootEl = document.createElement('div');
  rootEl.id = 'root';
  document.body.appendChild(rootEl);
  const host = document.createElement('div');
  rootEl.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<RollModal />); });
  await flush();
  return { root, host };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  mocks.getPublic.mockResolvedValue({ student_otp_bypass_enabled: 'false' });
});

describe('RollModal email correction interaction', () => {
  it('allows a new student to return from OTP, correct their email while keeping roll locked, and see the newly masked destination', async () => {
    mocks.checkExists.mockResolvedValue({ exists: false, hasProfile: false });
    mocks.requestOtp
      .mockResolvedValueOnce({ sent: true, isNew: true, email: 'w****@iitk.ac.in' })
      .mockResolvedValueOnce({ sent: true, isNew: true, email: 'f****@iitk.ac.in' });

    await mountModal();

    // Step 1: Enter roll number
    const rollInput = document.body.querySelector<HTMLInputElement>('input[placeholder="e.g. 230182"]')!;
    await act(async () => { setInputValue(rollInput, '230182'); });
    await act(async () => { findButton('Continue').click(); });
    await flush();

    // Step 2: Enter name and wrong email
    const nameInput = document.body.querySelector<HTMLInputElement>('input[placeholder="e.g. Rahul Kumar"]')!;
    const emailInput = document.body.querySelector<HTMLInputElement>('input[placeholder="e.g. yourname23@iitk.ac.in"]')!;
    await act(async () => {
      setInputValue(nameInput, 'Ada Lovelace');
      setInputValue(emailInput, 'wrong@iitk.ac.in');
    });
    await act(async () => { findButton('Send verification code').click(); });
    await flush();

    // Step 3: OTP screen shows masked wrong email + Change email address + Use a different roll number
    expect(document.body.textContent).toContain('w****@iitk.ac.in');
    expect(document.body.textContent).toContain('Entered the wrong email?');
    expect(findButton('Change email address')).toBeTruthy();
    expect(findButton('Use a different roll number')).toBeTruthy();

    // Click Change email address -> back to profile step with roll retained and previous-code invalidation note
    await act(async () => { findButton('Change email address').click(); });
    await flush();

    expect(document.body.textContent).toContain('230182');
    expect(document.body.textContent).toContain('Sending a new code will invalidate your previous verification code.');

    const correctedEmailInput = document.body.querySelector<HTMLInputElement>('input[placeholder="e.g. yourname23@iitk.ac.in"]')!;
    expect(correctedEmailInput.value).toBe('wrong@iitk.ac.in');
    expect(document.activeElement).toBe(correctedEmailInput);

    // Invalid (non-IITK) email disables submission and shows inline validation error
    await act(async () => { setInputValue(correctedEmailInput, 'bad@gmail.com'); });
    expect(document.body.textContent).toContain('Must be an @iitk.ac.in email address');
    expect(findButton('Send verification code').disabled).toBe(true);

    // Correct the email and submit
    await act(async () => { setInputValue(correctedEmailInput, 'fixed@iitk.ac.in'); });
    expect(findButton('Send verification code').disabled).toBe(false);
    await act(async () => { findButton('Send verification code').click(); });
    await flush();

    expect(mocks.requestOtp).toHaveBeenNthCalledWith(2, '230182', {
      name: 'Ada Lovelace',
      email: 'fixed@iitk.ac.in',
    });

    // Returned to OTP screen with newly masked email and previous-code-invalid notice
    expect(document.body.textContent).toContain('f****@iitk.ac.in');
    expect(document.body.textContent).toContain('Your previous code is no longer valid.');
  });

  it('does not show Change email address for returning students whose email is server-controlled', async () => {
    mocks.checkExists.mockResolvedValue({ exists: true, hasProfile: true });
    mocks.requestOtp.mockResolvedValueOnce({ sent: true, isNew: false, email: 'r***@iitk.ac.in' });

    await mountModal();

    const rollInput = document.body.querySelector<HTMLInputElement>('input[placeholder="e.g. 230182"]')!;
    await act(async () => { setInputValue(rollInput, '230001'); });
    await act(async () => { findButton('Continue').click(); });
    await flush();

    expect(document.body.textContent).toContain('r***@iitk.ac.in');
    expect(document.body.textContent).not.toContain('Change email address');
    expect(findButton('Use a different roll number')).toBeTruthy();
  });
});

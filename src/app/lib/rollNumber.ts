// Roll number validation for the sign-in modal (components/RollModal.tsx).
//
// This is a mirror, not a new rule: ROLL_SCHEMA in
// backend/src/routes/auth.ts gates request-otp, verify-otp and
// bypass-login, so a roll outside this pattern can never sign in. It is
// deliberately wide (2 leading digits, then 4–10 letters/digits — see the
// comment there). Checking it here only rejects, before any network call,
// what the server would reject a step later. rollNumber.test.ts reads the
// backend source and fails if the two patterns drift apart.
export const ROLL_NUMBER_PATTERN = /^[0-9]{2}[a-zA-Z0-9]{4,10}$/i;

// Same bound as the pattern (2 + 10) — the input's maxLength.
export const ROLL_NUMBER_MAX_LENGTH = 12;

export const ROLL_NUMBER_ERROR =
  'Enter a valid IITK roll number: 2 digits followed by 4–10 letters or numbers (e.g. 230182).';

export type RollNumberCheck =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'valid'; value: string };

// The server trims before matching (ROLL_SCHEMA), so trimming here keeps
// the two in step; `value` is what gets sent.
export function checkRollNumber(raw: string): RollNumberCheck {
  const value = raw.trim();
  if (!value) return { status: 'empty' };
  if (!ROLL_NUMBER_PATTERN.test(value)) return { status: 'invalid', message: ROLL_NUMBER_ERROR };
  return { status: 'valid', value };
}

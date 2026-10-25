// ─────────────────────────────────────────────────────────────────────────
// Optional event extras — client side. Mirrors backend/src/lib/eventForm.ts
// so the admin form can explain a bad link before saving; the SERVER is the
// authority (it re-validates and stores only a link that passes). The event
// card also re-checks the link it got from the server before opening it.
// ─────────────────────────────────────────────────────────────────────────

export const GOOGLE_FORM_URL_MAX = 2048;

export type GoogleFormCheck = { ok: true; url: string } | { ok: false; error: string };

export function checkGoogleFormUrl(raw: string): GoogleFormCheck {
  const trimmed = raw.trim();
  const invalid = { ok: false as const, error: 'Use a Google Forms link (https://docs.google.com/forms/… or https://forms.gle/…)' };
  if (!trimmed || trimmed.length > GOOGLE_FORM_URL_MAX) return invalid;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return invalid;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return invalid;
  const host = url.hostname.toLowerCase();
  if (host === 'forms.gle') {
    if (!/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return invalid;
  } else if (host === 'docs.google.com') {
    if (!/^\/forms\/.+/.test(url.pathname)) return invalid;
    if (/\/edit\/?$/.test(url.pathname)) {
      return { ok: false, error: 'That is the form’s edit link — use the link from Send → Link in Google Forms' };
    }
  } else {
    return invalid;
  }
  return url.href.length > GOOGLE_FORM_URL_MAX ? invalid : { ok: true, url: url.href };
}

// The registration form link a card may open: the server's value, only if
// it still passes the allowlist (defence in depth — never an arbitrary URL).
export function safeFormUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const checked = checkGoogleFormUrl(url);
  return checked.ok ? checked.url : null;
}

// An RSVP response, as the server sends it. registrationFormUrl is present
// exactly when the event has a form NOW — the server re-reads the event in
// the same request — so its absence means "no form", never "not supplied".
export interface RsvpResult {
  registeredCount: number;
  isRegistered: boolean;
  registrationFormUrl?: string;
}

// Applies an RSVP response to a loaded event, treating the server as the
// authority on the form link: a form the admin removed after the page
// loaded is cleared (no stale Complete Registration link), and one added
// since is picked up.
export function applyRsvpResult<E extends { registeredCount: number; isRegistered: boolean; registrationFormUrl: string | null }>(event: E, result: RsvpResult): E {
  return { ...event, registeredCount: result.registeredCount, isRegistered: result.isRegistered, registrationFormUrl: result.registrationFormUrl ?? null };
}

// What an event card shows, from the event as loaded:
//   problemStatement — the attachment action;
//   primary — 'form': the persistent Complete Registration / Submit Response
//     link (registered for a form event); 'rsvp': the Register / Registered ✓
//     button; 'none': nothing (a past event the student didn't register for);
//   registersViaForm — Register records an idempotent registration and then
//     opens the form (instead of the original toggle).
export function eventCardActions(
  event: { registrationFormUrl: string | null; attachment: unknown | null; isRegistered: boolean },
  isPast: boolean,
) {
  const formUrl = safeFormUrl(event.registrationFormUrl);
  const showRsvp = !isPast || event.isRegistered;
  return {
    problemStatement: event.attachment !== null && event.attachment !== undefined,
    formUrl,
    formLabel: formActionLabel(event.attachment !== null && event.attachment !== undefined),
    primary: !showRsvp ? 'none' as const : formUrl && event.isRegistered ? 'form' as const : 'rsvp' as const,
    registersViaForm: formUrl !== null,
  };
}

// Label for the form action. With a problem statement the form is where
// participants submit their response; otherwise it completes registration.
export function formActionLabel(hasAttachment: boolean): 'Submit Response' | 'Complete Registration' {
  return hasAttachment ? 'Submit Response' : 'Complete Registration';
}

// Mirrors the server's attachment limits for instant admin feedback.
export const EVENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const EVENT_ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.pptx,.zip';
const ATTACHMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'pptx', 'zip'];

export function checkEventAttachment(file: { name: string; size: number }): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (!ATTACHMENT_EXTENSIONS.includes(ext)) return 'Attachment must be a PDF, PNG, JPG, WEBP, DOCX, PPTX or ZIP file';
  if (file.size === 0) return 'The attachment is empty (0 bytes)';
  if (file.size > EVENT_ATTACHMENT_MAX_BYTES) return 'Attachment exceeds the 25 MB limit';
  return null;
}

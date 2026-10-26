// ─────────────────────────────────────────────────────────────────────────
// Optional event extras — client side. Mirrors backend/src/lib/eventForm.ts
// so the admin form can explain a bad link before saving; the SERVER is the
// authority (it re-validates and stores only a link that passes). The event
// card also re-checks the link it got from the server before opening it.
// ─────────────────────────────────────────────────────────────────────────

import { formatSize } from './assetLibrary';

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
//   problemStatement — whether there is an attachment action;
//   attachment — its label ("View…" for files the browser opens, else
//     "Download…"), file name and "PDF · 1.2 MB" meta line, or null;
//   primary — 'form': the persistent Complete Registration / Submit Response
//     link (registered for a form event); 'rsvp': the Register / Registered ✓
//     button; 'none': nothing (a past event the student didn't register for);
//   registersViaForm — Register records an idempotent registration and then
//     opens the form (instead of the original toggle).
export function eventCardActions(
  event: { registrationFormUrl: string | null; attachment: { name: string; size: number | null; url: string } | null; isRegistered: boolean },
  isPast: boolean,
) {
  const formUrl = safeFormUrl(event.registrationFormUrl);
  const showRsvp = !isPast || event.isRegistered;
  const file = event.attachment ?? null;
  return {
    problemStatement: file !== null,
    attachment: file && {
      url: file.url,
      name: file.name,
      label: attachmentActionLabel(file.name),
      meta: attachmentMeta(file.name, file.size),
      opensInBrowser: attachmentTypeInfo(file.name).opensInBrowser,
    },
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

// ── Attachment presentation ─────────────────────────────────────────────
// What a file is, for labels: its type and whether the browser opens it
// (PDFs and images — the server serves those inline) or downloads it
// (DOCX/PPTX/ZIP — served as attachments). Mirrors ATTACHMENT_TYPES in
// backend/src/routes/events.ts; the stored name keeps its validated
// extension, so the name alone decides.
const ATTACHMENT_TYPE_LABEL: Record<string, string> = {
  pdf: 'PDF', png: 'PNG image', jpg: 'JPG image', jpeg: 'JPG image', webp: 'WEBP image',
  docx: 'Word document', pptx: 'PowerPoint', zip: 'ZIP archive',
};
const OPENS_IN_BROWSER = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp']);

export function attachmentTypeInfo(name: string): { label: string; opensInBrowser: boolean } {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return { label: ATTACHMENT_TYPE_LABEL[ext] ?? 'File', opensInBrowser: OPENS_IN_BROWSER.has(ext) };
}

// "PDF · 1.2 MB" — the type, plus the size when known.
export function attachmentMeta(name: string, size: number | null | undefined): string {
  return [attachmentTypeInfo(name).label, formatSize(size)].filter(Boolean).join(' · ');
}

// The card's attachment action: what it does with this file.
export function attachmentActionLabel(name: string): 'View problem statement' | 'Download problem statement' {
  return attachmentTypeInfo(name).opensInBrowser ? 'View problem statement' : 'Download problem statement';
}

// The admin form's attachment field, from what is saved and what is staged:
//   empty     — nothing saved, nothing chosen;
//   new       — a file chosen for an event with no saved attachment;
//   saved     — the saved attachment, unchanged;
//   replacing — a new file chosen to replace the saved one;
//   removing  — the saved attachment marked for removal (undoable).
// Nothing reaches the server until the event is saved.
export type AttachmentFieldState = 'empty' | 'new' | 'saved' | 'replacing' | 'removing';

export function attachmentFieldState(hasSaved: boolean, hasFile: boolean, removeSaved: boolean): AttachmentFieldState {
  if (hasFile) return hasSaved ? 'replacing' : 'new';
  if (!hasSaved) return 'empty';
  return removeSaved ? 'removing' : 'saved';
}

// The admin's save button while the request is in flight. With a file,
// say the upload is part of it — the server stores the event and its
// attachment together, and nothing is "done" before it confirms.
export function eventSavingLabel(creating: boolean, uploading: boolean): string {
  if (uploading) return 'Uploading attachment & saving…';
  return creating ? 'Scheduling…' : 'Saving…';
}

// ─────────────────────────────────────────────────────────────────────────
// Optional Google Forms registration link for an event (events.
// registration_form_url). An admin sets it; after a student's registration
// is recorded, the app sends them there to submit the extra details. The
// stored value is only ever a URL that passed this check, and the frontend
// opens only the URL the server returns — never a client-supplied one.
//
// Accepted: https only, no credentials, no custom port, on
//   docs.google.com/forms/…   (the full share link), or
//   forms.gle/<id>            (Google's short share link).
// Everything else — http:, javascript:, data:, lookalike hosts
// (docs.google.com.evil.example, forms.gle.example), other Google paths —
// is refused. A form's /edit link is refused too: it opens the editor,
// which students can't use; the admin needs the Send → link.
// Mirrored for instant feedback in src/app/lib/eventForm.ts.
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

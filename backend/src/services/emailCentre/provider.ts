// Provider seam for the Email Centre. Production uses the app's single shared
// Resend client (mailer.getResendClient); tests inject a fake via
// setEmailProvider so no real mail is ever sent from a test run.

import crypto from 'crypto';
import { MAIL_FROM, getResendClient } from '../mailer';

export interface ProviderAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  contentId?: string;
}

export interface ProviderEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: ProviderAttachment[];
}

export type ProviderResult =
  | { ok: true; id: string; mock?: boolean }
  // rate_limited: nothing was sent, try again shortly.
  // rejected:     provider refused the request (4xx) — nothing was sent.
  // transient:    5xx / network — the provider MAY have accepted it.
  // config:       email is not configured on this server.
  | { ok: false; kind: 'rate_limited' | 'rejected' | 'transient' | 'config'; message: string };

export interface EmailProvider {
  send(email: ProviderEmail, opts: { idempotencyKey: string }): Promise<ProviderResult>;
}

export const REPLY_TO = 'designandanimationclub.iitk@gmail.com';

class ResendProvider implements EmailProvider {
  async send(email: ProviderEmail, opts: { idempotencyKey: string }): Promise<ProviderResult> {
    try {
      const { data, error } = await getResendClient().emails.send({
        from: MAIL_FROM,
        replyTo: REPLY_TO,
        to: email.to,
        cc: email.cc?.length ? email.cc : undefined,
        bcc: email.bcc?.length ? email.bcc : undefined,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments?.map(a => ({
          filename: a.filename, content: a.content, contentType: a.contentType, contentId: a.contentId,
        })),
      }, { idempotencyKey: opts.idempotencyKey });
      if (error) {
        const status = (error as { statusCode?: number | null }).statusCode ?? 0;
        const kind = status === 429 ? 'rate_limited' : status >= 400 && status < 500 ? 'rejected' : 'transient';
        return { ok: false, kind, message: error.message || 'Provider error' };
      }
      if (!data?.id) return { ok: false, kind: 'transient', message: 'Provider returned no message id' };
      return { ok: true, id: data.id };
    } catch (err) {
      return { ok: false, kind: 'transient', message: err instanceof Error ? err.message : String(err) };
    }
  }
}

// Dev convenience (same spirit as campaignService's mock mode): with no
// RESEND_API_KEY outside production, accept the send locally and say so.
class MockProvider implements EmailProvider {
  async send(_email: ProviderEmail, opts: { idempotencyKey: string }): Promise<ProviderResult> {
    return { ok: true, id: `mock_${crypto.createHash('sha1').update(opts.idempotencyKey).digest('hex').slice(0, 16)}`, mock: true };
  }
}

class UnconfiguredProvider implements EmailProvider {
  async send(): Promise<ProviderResult> {
    return { ok: false, kind: 'config', message: 'Email service is not configured (RESEND_API_KEY unset)' };
  }
}

let override: EmailProvider | null = null;
export function setEmailProvider(p: EmailProvider | null): void { override = p; }

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  if (process.env.RESEND_API_KEY) return new ResendProvider();
  return process.env.NODE_ENV === 'production' ? new UnconfiguredProvider() : new MockProvider();
}

export function providerIsLive(): boolean {
  return Boolean(override) || Boolean(process.env.RESEND_API_KEY);
}

// ── Webhook signature (Svix scheme used by Resend) ─────────────────────────
// signed content = `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with
// the base64 part of the `whsec_…` secret, compared against every `v1,<sig>`.
export function verifySvixSignature(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  nowMs = Date.now(),
  toleranceSec = 300
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  for (const part of signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return true;
  }
  return false;
}

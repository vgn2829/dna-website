import { useId, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '../../ui/dialog';
import {
  MESSAGE_STATUS_LABEL, STATUS_LABEL,
  type ItemState, type MessageStatus, type RecipientStatus,
} from '../../../lib/emailCentre';

// Email Centre look: the existing admin tokens, a handful of scoped helpers.
export const EC_CSS = `
.ec-root { color: var(--color-ink); font-family: var(--font-body); }
.ec-card { background: var(--color-surface-1); border: 1px solid var(--color-hairline-soft); border-radius: var(--radius-lg); }
.ec-label { display:block; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--color-ink-muted); margin-bottom: 6px; }
.ec-hint { font-size: 12px; color: var(--color-ink-muted); line-height: 1.5; }
.ec-input { width:100%; box-sizing:border-box; background: var(--color-canvas); color: var(--color-ink); border:1px solid var(--color-hairline); border-radius: var(--radius-md); padding: 10px 12px; font: inherit; font-size: 14px; min-height: 40px; }
.ec-input:focus-visible, .ec-btn:focus-visible, .ec-chip button:focus-visible, .ec-tab:focus-visible, .ec-tb:focus-visible { outline: 2px solid var(--color-accent-blue); outline-offset: 2px; }
.ec-input[aria-invalid="true"] { border-color: var(--color-error); }
.ec-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:40px; padding: 8px 14px; border-radius: var(--radius-pill); border: 1px solid var(--color-hairline); background: var(--color-surface-1); color: var(--color-ink); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.ec-btn:hover:not(:disabled) { background: var(--color-surface-2); }
.ec-btn:disabled { opacity: .5; cursor: not-allowed; }
.ec-btn-primary { background: var(--color-inverse-canvas); color: var(--color-canvas); border-color: transparent; }
.ec-btn-primary:hover:not(:disabled) { background: var(--color-inverse-canvas); opacity: .88; }
.ec-btn-danger { color: var(--color-error); }
.ec-chip { display:inline-flex; align-items:center; gap:6px; max-width:100%; padding: 4px 6px 4px 10px; border-radius: var(--radius-pill); background: var(--color-surface-2); font-size: 12.5px; border: 1px solid var(--color-hairline); }
.ec-chip.is-bad { border-color: var(--color-error); }
.ec-chip.is-excluded { opacity: .55; text-decoration: line-through; }
.ec-chip button { display:inline-flex; background:none; border:0; color: var(--color-ink-muted); cursor:pointer; padding: 2px; border-radius: 50%; }
.ec-tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--color-ink-muted); padding: 10px 14px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.ec-tab[aria-selected="true"] { color: var(--color-ink); border-bottom-color: var(--color-brand); }
.ec-table { width:100%; border-collapse: collapse; font-size: 13px; }
.ec-table th { text-align:left; font-size: 11px; letter-spacing:.05em; text-transform: uppercase; color: var(--color-ink-muted); font-weight:600; padding: 8px 10px; border-bottom: 1px solid var(--color-hairline); position: sticky; top: 0; background: var(--color-surface-1); z-index: 1; }
.ec-table td { padding: 8px 10px; border-bottom: 1px solid var(--color-hairline-soft); vertical-align: middle; }
.ec-table tr:hover td { background: color-mix(in srgb, var(--color-surface-2) 40%, transparent); }
.ec-badge { display:inline-flex; align-items:center; gap:5px; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: var(--radius-pill); border: 1px solid transparent; white-space: nowrap; }
.ec-seg { display:inline-flex; padding:3px; gap:2px; background: var(--color-canvas); border:1px solid var(--color-hairline); border-radius: var(--radius-pill); }
.ec-seg button { border:0; background:transparent; color: var(--color-ink-muted); padding: 7px 16px; border-radius: var(--radius-pill); font: inherit; font-size: 13px; font-weight: 500; cursor:pointer; }
.ec-seg button[aria-checked="true"] { background: var(--color-surface-2); color: var(--color-ink); }
.ec-seg button:focus-visible { outline: 2px solid var(--color-accent-blue); }
.ec-editor-wrap { border:1px solid var(--color-hairline); border-radius: var(--radius-md); background: var(--color-canvas); overflow: hidden; }
.ec-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:2px; padding: 6px; border-bottom:1px solid var(--color-hairline); background: var(--color-surface-1); position: sticky; top: 0; z-index: 2; }
.ec-tb { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-width:32px; height:32px; padding: 0 8px; border:0; border-radius: var(--radius-sm); background: transparent; color: var(--color-ink); cursor:pointer; font: inherit; font-size:12.5px; }
.ec-tb:hover:not(:disabled) { background: var(--color-surface-2); }
.ec-tb[aria-pressed="true"] { background: var(--color-surface-2); color: var(--color-brand-text); }
.ec-tb:disabled { opacity:.35; cursor:not-allowed; }
.ec-sep { width:1px; height:20px; background: var(--color-hairline); margin: 0 4px; }
.ec-prose { padding: 16px 18px; min-height: 280px; max-height: 560px; overflow:auto; font-size: 15px; line-height: 1.65; outline: none; }
.ec-prose p { margin: 0 0 12px; } .ec-prose h1 { font-size: 26px; margin: 0 0 12px; } .ec-prose h2 { font-size: 21px; margin: 0 0 12px; } .ec-prose h3 { font-size: 17px; margin: 0 0 10px; }
.ec-prose ul { list-style: disc; padding-left: 22px; margin: 0 0 12px; } .ec-prose ol { list-style: decimal; padding-left: 22px; margin: 0 0 12px; }
.ec-prose hr { border: 0; border-top: 1px solid var(--color-hairline); margin: 14px 0 18px; } .ec-prose mark { background: #e0f55b; color: #111; padding: 0 3px; border-radius: 2px; }
.ec-prose a { color: var(--color-brand-text); text-decoration: underline; } .ec-prose img { max-width: 100%; height:auto; border-radius: 8px; }
.ec-prose .ProseMirror-focused { outline: none; }
.ec-var { background: color-mix(in srgb, var(--color-brand) 22%, transparent); border-radius: 4px; padding: 0 2px; color: var(--color-brand-text); }
.ec-var-bad { background: color-mix(in srgb, var(--color-error) 25%, transparent); color: var(--color-error); }
.ec-cond { border: 1px dashed color-mix(in srgb, var(--color-accent-blue) 60%, transparent); border-radius: var(--radius-md); padding: 8px; margin: 0 0 14px; background: color-mix(in srgb, var(--color-accent-blue) 6%, transparent); }
.ec-branch { border-left: 3px solid var(--color-accent-blue); padding: 6px 0 2px 10px; margin: 6px 0; border-radius: 2px; }
.ec-branch.is-else { border-left-color: var(--color-ink-muted); }
.ec-branch-head { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom: 6px; font-size: 12px; }
.ec-mini { height: 32px; min-height: 32px; padding: 4px 8px; font-size: 12.5px; border-radius: var(--radius-sm); border: 1px solid var(--color-hairline); background: var(--color-canvas); color: var(--color-ink); font-family: inherit; }
.ec-mail { background: #fff; color:#111; border-radius: var(--radius-md); border: 1px solid var(--color-hairline); overflow:hidden; }
.ec-spin { animation: ec-spin 1s linear infinite; } @keyframes ec-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ec-spin { animation: none; } }
@media (max-width: 720px) { .ec-hide-sm { display:none !important; } .ec-table { font-size: 12px; } }
`;

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="ec-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p role="alert" className="ec-hint" style={{ color: 'var(--color-error)', marginTop: 4 }}>{error}</p>
        : hint ? <p className="ec-hint" style={{ marginTop: 4 }}>{hint}</p> : null}
    </div>
  );
}

export function useFieldId() { return useId(); }

export function Spinner({ size = 14 }: { size?: number }) { return <Loader2 size={size} className="ec-spin" aria-hidden />; }

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';
const TONES: Record<Tone, { c: string; bg: string; b: string }> = {
  neutral: { c: 'var(--color-ink-muted)', bg: 'var(--color-surface-2)', b: 'var(--color-hairline)' },
  good: { c: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 14%, transparent)', b: 'color-mix(in srgb, var(--color-success) 35%, transparent)' },
  warn: { c: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', b: 'color-mix(in srgb, var(--color-warning) 35%, transparent)' },
  bad: { c: 'var(--color-error)', bg: 'color-mix(in srgb, var(--color-error) 14%, transparent)', b: 'color-mix(in srgb, var(--color-error) 35%, transparent)' },
  info: { c: 'var(--color-accent-blue)', bg: 'color-mix(in srgb, var(--color-accent-blue) 14%, transparent)', b: 'color-mix(in srgb, var(--color-accent-blue) 35%, transparent)' },
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  const t = TONES[tone];
  return <span className="ec-badge" title={title} style={{ color: t.c, background: t.bg, borderColor: t.b }}>{children}</span>;
}

const RECIPIENT_TONE: Record<RecipientStatus, Tone> = {
  queued: 'neutral', sending: 'info', sent: 'info', delivered: 'good', bounced: 'bad', suppressed: 'bad',
  complained: 'bad', failed: 'bad', cancelled: 'neutral', excluded: 'neutral',
};
export function RecipientStatusBadge({ status }: { status: RecipientStatus }) {
  return <Badge tone={RECIPIENT_TONE[status]} title={status === 'sent' ? 'Accepted by the email provider — not yet confirmed delivered' : undefined}>{STATUS_LABEL[status]}</Badge>;
}

const MESSAGE_TONE: Record<MessageStatus, Tone> = { draft: 'neutral', queued: 'neutral', sending: 'info', completed: 'good', failed: 'bad', cancelled: 'neutral' };
export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  return <Badge tone={MESSAGE_TONE[status]}>{MESSAGE_STATUS_LABEL[status]}</Badge>;
}

const ITEM_LABEL: Record<ItemState, [string, Tone]> = {
  valid: ['Valid', 'good'], missing_data: ['Missing data', 'warn'], invalid_email: ['Invalid email', 'bad'],
  render_error: ['Rendering error', 'bad'], excluded: ['Excluded', 'neutral'],
};
export function ItemStateBadge({ state }: { state: ItemState }) {
  const [label, tone] = ITEM_LABEL[state];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Modal({ open, onClose, title, description, children, wide }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent style={{ zIndex: 1100, maxWidth: wide ? 1040 : 560, width: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 32px)', overflow: 'auto', background: 'var(--color-canvas)', border: '1px solid var(--color-hairline)', padding: 0 }}>
        <DialogHeader style={{ padding: '18px 22px 12px', borderBottom: '1px solid var(--color-hairline)' }}>
          <DialogTitle style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <div style={{ padding: 22 }}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function timeAgo(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

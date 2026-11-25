import type { LucideIcon } from 'lucide-react';
import type { WorkspaceLoadError } from '../../context/WorkspaceContext';

// ─────────────────────────────────────────────────────────────────────────
// Shown by workspace-scoped pages (Assets, Templates, Projects) when the
// workspace list couldn't be loaded — instead of an empty "no workspace /
// select a workspace" state, which reads as if the user had none. Same
// centered layout as those pages' own empty states.
// ─────────────────────────────────────────────────────────────────────────

export function WorkspaceLoadErrorState({
  error,
  icon: Icon,
  noun,
  onRetry,
  onSignIn,
}: {
  error: WorkspaceLoadError;
  icon: LucideIcon;
  // What the page shows, e.g. "assets".
  noun: string;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const expired = error === 'session-expired';
  return (
    <div role="alert" style={{ padding: '80px 0', textAlign: 'center' }}>
      <Icon size={28} strokeWidth={1.5} style={{ color: 'var(--color-ink-muted)', margin: '0 auto 14px' }} />
      <p className="type-body" style={{ margin: '0 0 16px', color: 'var(--color-ink-muted)' }}>
        {expired
          ? `Your session has expired. Sign in again to see your ${noun}.`
          : `Couldn’t load your workspaces, so your ${noun} can’t be shown right now.`}
      </p>
      {expired ? (
        <button type="button" onClick={onSignIn} className="btn-primary">Sign in again</button>
      ) : (
        <button type="button" onClick={onRetry} className="btn-secondary">Try again</button>
      )}
    </div>
  );
}

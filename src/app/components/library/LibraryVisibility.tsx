import { Globe, Lock, Users } from 'lucide-react';
import type { AssetVisibility, LibraryScope } from '../../lib/api';
import { VISIBILITY_LABEL, communityAvailable, visibilityHint } from '../../lib/libraryVisibility';

// ─────────────────────────────────────────────────────────────────────────
// Shared Creative Library UI — used by templates (TemplatesPage, BoardPage's
// Save as Template) and assets (AssetBrowser, AssetCard, AddAssetDialog).
// Built only from existing primitives: the segmented control the Share
// dialog already uses for Private/Shared, the type-* scale, and the pill
// chip AssetCard uses for collections. Visibility is always spelled out in
// text next to an icon, never signalled by color alone.
// ─────────────────────────────────────────────────────────────────────────

// Community is club-wide only for assets; a template's Community is its
// workspace, so templates keep the people icon for it.
export const VISIBILITY_ICON: Record<AssetVisibility, typeof Lock> = { personal: Lock, workspace: Users, community: Globe };

export function VisibilityBadge({ visibility, kind = 'asset' }: { visibility: AssetVisibility; kind?: 'template' | 'asset' }) {
  const Icon = kind === 'template' && visibility === 'community' ? Users : VISIBILITY_ICON[visibility];
  return (
    <span className="type-micro" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      padding: '2px 8px', borderRadius: 'var(--radius-pill)',
      background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)', whiteSpace: 'nowrap',
    }}>
      <Icon size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
      {VISIBILITY_LABEL[visibility]}
    </span>
  );
}

// Visibility choice for save, upload and edit flows. Personal is every
// caller's default. Templates: Personal / Community, where Community is the
// workspace — disabled in a personal workspace (no one else to share with)
// and the hint says why. Assets: Personal / Workspace / Community, where
// Workspace is this workspace plus explicit shares and Community is the
// whole club, so both are always available.
export function VisibilityPicker<V extends AssetVisibility>({
  value,
  onChange,
  kind,
  workspaceName,
  isPersonalWorkspace,
  disabled,
}: {
  value: V;
  onChange: (value: V) => void;
  kind: 'template' | 'asset';
  workspaceName: string;
  isPersonalWorkspace: boolean;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p className="type-caption" style={{ margin: 0 }}>
        Visibility
      </p>
      <div role="group" aria-label={`Who can use this ${kind}`} className="segmented is-block">
        {((kind === 'asset' ? ['personal', 'workspace', 'community'] : ['personal', 'community']) as V[]).map(option => {
          const unavailable = disabled || (option === 'community' && !communityAvailable(kind, isPersonalWorkspace));
          const Icon = kind === 'template' && option === 'community' ? Users : VISIBILITY_ICON[option];
          return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            disabled={unavailable}
            aria-pressed={value === option}
            className="segmented-item touch-target"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: unavailable ? 0.5 : 1, cursor: unavailable ? 'not-allowed' : 'pointer' }}
          >
            <Icon size={14} aria-hidden="true" />
            {VISIBILITY_LABEL[option]}
          </button>
          );
        })}
      </div>
      <p className="type-micro" style={{ margin: 0 }}>
        {visibilityHint(value, kind, workspaceName, isPersonalWorkspace)}
      </p>
    </div>
  );
}

// All / My … / Community filter. Server-side: the caller passes the scope
// to the list API, never filters a full list in React.
export function ScopeTabs({
  value,
  onChange,
  mineLabel,
  allLabel = 'All',
  label,
}: {
  value: LibraryScope;
  onChange: (value: LibraryScope) => void;
  mineLabel: string;
  allLabel?: string;
  label: string;
}) {
  const options: [LibraryScope, string][] = [['all', allLabel], ['mine', mineLabel], ['community', 'Community']];
  return (
    <div role="group" aria-label={label} className="segmented">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className="segmented-item touch-target"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

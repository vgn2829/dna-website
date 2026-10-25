import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Users } from 'lucide-react';
import { api, type Asset } from '../../lib/api';
import { notifyAssetsChanged } from '../../lib/assetRefresh';
import { shareDialogMode } from '../../lib/libraryVisibility';
import { LibraryDialog } from './LibraryDialog';

// ─────────────────────────────────────────────────────────────────────────
// Share with workspace — the owner's explicit, per-workspace grants for one
// community asset (routes/assetSharing.ts). Sharing adds the asset to the
// chosen workspace's library; nothing is copied, and the owner, source
// workspace and stored file never change. Stopping sharing removes it from
// that workspace's library and picker; boards that already placed it keep
// it. Targets are the team workspaces the owner belongs to — the server
// decides, this only lists what it returns.
// ─────────────────────────────────────────────────────────────────────────

type Sharing = Awaited<ReturnType<typeof api.assets.shares>>;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function ShareAssetDialog({
  asset,
  roll,
  onClose,
  onPublish,
}: {
  asset: Asset;
  roll: string;
  onClose: () => void;
  // Publishes a Personal asset to Community (only community assets can be
  // shared); resolves once the browser holds the updated asset.
  onPublish: (asset: Asset) => Promise<void>;
}) {
  const [data, setData] = useState<Sharing | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.assets.shares(roll, asset.id), [roll, asset.id]);

  useEffect(() => {
    let active = true;
    load()
      .then(d => { if (active) setData(d); })
      .catch(() => { if (active) setError('Couldn’t load sharing for this asset.'); });
    return () => { active = false; };
  }, [load]);

  const isCommunity = asset.visibility === 'community';
  // Until sharing info loads, assume the owner may share (the common case).
  const mode = shareDialogMode(data?.canShare ?? true, isCommunity);

  // One row per workspace: every current grant, plus every workspace the
  // owner may still share into.
  const rows = data
    ? [
        ...data.grants.map(g => ({ id: g.workspace_id, name: g.name, shared: true })),
        ...data.targets.filter(t => !data.grants.some(g => g.workspace_id === t.id)).map(t => ({ id: t.id, name: t.name, shared: false })),
      ].sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const toggle = async (row: { id: string; name: string; shared: boolean }) => {
    setBusyId(row.id);
    setError(null);
    try {
      if (row.shared) await api.assets.revoke(roll, asset.id, row.id);
      else await api.assets.grant(roll, asset.id, row.id);
      setData(await load());
      notifyAssetsChanged();
      toast.success(row.shared ? `Stopped sharing with ${row.name}` : `Shared with ${row.name}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      await onPublish(asset);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <LibraryDialog
      title="Share with workspace"
      subtitle={asset.filename}
      maxWidth={440}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ minHeight: 40 }}>Done</button>
        {mode === 'publish-first' && (
          <button type="button" className="btn-primary" onClick={publish} disabled={publishing} style={{ minHeight: 40, opacity: publishing ? 0.6 : 1 }}>
            {publishing ? 'Publishing…' : 'Publish to Community'}
          </button>
        )}
      </>}
    >
      <p className="type-body-sm" style={{ margin: '0 0 14px', color: 'var(--color-ink-muted)' }}>
        {mode === 'manage-only'
          ? 'You’re no longer a member of this asset’s workspace, so you can’t share it with new workspaces. You can still stop sharing it where it’s shared now — boards that already use it keep it.'
          : mode === 'share'
            ? 'Everyone in a workspace you share with can find and use this asset. It stays yours, and the file is never copied. If you stop sharing, boards that already use it keep it.'
            : 'Only Community assets can be shared with other workspaces. Publish it to Community first — it stays yours, and the file is never copied.'}
      </p>

      {!data && !error && (
        <p role="status" className="type-caption" style={{ margin: 0 }}>Loading…</p>
      )}

      {data && rows.length === 0 && (
        <p className="type-caption" style={{ margin: 0 }}>
          {mode === 'manage-only'
            ? 'It isn’t shared with any workspace.'
            : 'You can share with team workspaces you’re a member of. Join or create a team workspace to share this asset.'}
        </p>
      )}

      {data && rows.length > 0 && (
        <ul aria-label="Workspaces" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(row => (
            <li
              key={row.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 12px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${row.shared ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
                background: row.shared ? 'color-mix(in srgb, var(--color-brand) 6%, transparent)' : 'none',
                opacity: !isCommunity && !row.shared ? 0.6 : 1,
              }}
            >
              <Users size={15} style={{ flexShrink: 0, color: 'var(--color-ink-muted)' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-ink)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
                {row.name}
              </span>
              {row.shared && (
                <span className="type-micro" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-brand-text)', flexShrink: 0 }}>
                  <Check size={13} /> {isCommunity ? 'Shared' : 'Paused'}
                </span>
              )}
              <button
                type="button"
                className={row.shared ? 'btn-translucent btn-sm touch-target' : 'btn-secondary btn-sm touch-target'}
                onClick={() => toggle(row)}
                disabled={busyId !== null || (!isCommunity && !row.shared)}
                aria-label={row.shared ? `Stop sharing with ${row.name}` : `Share with ${row.name}`}
                style={{ flexShrink: 0 }}
              >
                {busyId === row.id ? 'Saving…' : row.shared ? 'Stop sharing' : 'Share'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{error}</p>
      )}
    </LibraryDialog>
  );
}

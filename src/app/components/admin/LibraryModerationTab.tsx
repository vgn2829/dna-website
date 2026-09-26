import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EyeOff, FileText, Link2, LayoutTemplate, Search } from 'lucide-react';
import { api, type AdminAsset, type AdminTemplate, type LibraryAdminFilters, type LibraryStatus, type LibraryVisibility } from '../../lib/api';
import { formatSize } from '../../lib/assetLibrary';
import { VisibilityBadge } from '../library/LibraryVisibility';
import { VISIBILITY_LABEL } from '../../lib/libraryVisibility';

// ─────────────────────────────────────────────────────────────────────────
// Admin moderation for the Shared Creative Library — the Admin panel's
// Assets and Templates tabs (one component, two kinds). Every call goes to
// the /admin endpoints with the admin token (requireAdmin enforces it
// server-side; nothing here is a security boundary on its own).
//
// Admins see everything — all workspaces, personal and community, active and
// hidden — and can override visibility or hide/restore. Hiding never deletes
// anything: the item leaves every normal flow and comes back intact on
// restore. Layout follows the Moodboards admin tab (header + search, one
// card row per item, controls on the right, native confirm for Hide).
// ─────────────────────────────────────────────────────────────────────────

type Kind = 'assets' | 'templates';
type Row = AdminAsset | AdminTemplate;

const nameOf = (kind: Kind, row: Row) => (kind === 'assets' ? (row as AdminAsset).filename : (row as AdminTemplate).name);

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function Preview({ kind, row }: { kind: Kind; row: Row }) {
  const box: React.CSSProperties = {
    width: 56, height: 56, flexShrink: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden',
    background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--color-ink-muted)',
  };
  if (kind === 'templates') {
    const t = row as AdminTemplate;
    return <div style={box}>{t.thumbnail_url ? <img src={t.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <LayoutTemplate size={20} aria-hidden="true" />}</div>;
  }
  const a = row as AdminAsset;
  if (a.kind === 'image' && (a.thumb_url || a.url)) {
    return <div style={box}><img src={a.thumb_url || a.url || ''} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>;
  }
  return <div style={box}>{a.kind === 'link' ? <Link2 size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />}</div>;
}

export function LibraryModerationTab({ kind }: { kind: Kind }) {
  const noun = kind === 'assets' ? 'asset' : 'template';
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<LibraryAdminFilters['status']>('all');
  const [visibility, setVisibility] = useState<LibraryAdminFilters['visibility']>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    setLoadError(false);
    const filters = { q: debounced, status, visibility };
    const request = kind === 'assets'
      ? api.assets.adminList(filters).then(r => r.assets as Row[])
      : api.templates.adminList(filters).then(r => r.templates as Row[]);
    request
      .then(list => { if (mine === seq.current) setRows(list); })
      .catch(() => { if (mine === seq.current) setLoadError(true); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [kind, debounced, status, visibility]);

  useEffect(() => { load(); }, [load]);

  // Keep a changed row in place, or drop it when it no longer matches the
  // active status/visibility filter.
  const applyUpdated = (updated: Row) => {
    const fits = (status === 'all' || updated.status === status) && (visibility === 'all' || updated.visibility === visibility);
    setRows(prev => fits ? prev.map(r => (r.id === updated.id ? updated : r)) : prev.filter(r => r.id !== updated.id));
  };

  const update = async (row: Row, body: { visibility?: LibraryVisibility; status?: LibraryStatus }, success: string) => {
    setBusyId(row.id);
    try {
      const updated = kind === 'assets'
        ? await api.assets.adminUpdate(row.id, body)
        : await api.templates.adminUpdate(row.id, body);
      applyUpdated(updated as Row);
      toast.success(success);
    } catch {
      toast.error(`Failed to update ${noun}`);
    } finally {
      setBusyId(null);
    }
  };

  const hide = (row: Row) => {
    const name = nameOf(kind, row);
    if (!confirm(`Hide "${name}" by ${row.owner_name ?? row.owner_roll}? It disappears from every library view — its owner's included — until you restore it. Nothing is deleted.`)) return;
    update(row, { status: 'hidden' }, `“${name}” hidden`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 className="type-headline" style={{ margin: '0 0 4px' }}>
            {kind === 'assets' ? 'Assets' : 'Templates'}
          </h2>
          <p className="type-caption" style={{ margin: 0 }}>
            Every {noun} in every workspace — change visibility, or hide and restore. Hiding never deletes anything.
          </p>
        </div>
        <label className="search-field" style={{ flex: '0 1 280px', minWidth: 0 }}>
          <Search size={14} aria-hidden="true" />
          <input
            className="input-base"
            type="search"
            placeholder="Search by name, owner or workspace…"
            aria-label={`Search ${kind}`}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <div role="group" aria-label="Filter by status" className="segmented">
          {(['all', 'active', 'hidden'] as const).map(v => (
            <button key={v} type="button" onClick={() => setStatus(v)} aria-pressed={status === v} className="segmented-item touch-target" style={{ textTransform: 'capitalize' }}>
              {v}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Filter by visibility" className="segmented">
          {(['all', 'personal', 'community'] as const).map(v => (
            <button key={v} type="button" onClick={() => setVisibility(v)} aria-pressed={visibility === v} className="segmented-item touch-target" style={{ textTransform: 'capitalize' }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)' }} aria-busy="true">Loading…</p>
      ) : loadError ? (
        <p className="type-body" style={{ margin: 0, color: 'var(--color-error)' }}>
          Could not load {kind}. <button type="button" onClick={load} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-brand-text)', cursor: 'pointer', font: 'inherit' }}>Retry</button>
        </p>
      ) : rows.length === 0 ? (
        <p className="type-body" style={{ margin: 0, padding: '40px 0', textAlign: 'center', color: 'var(--color-ink-muted)' }}>
          {debounced || status !== 'all' || visibility !== 'all' ? `No ${kind} match these filters.` : `No ${kind} yet.`}
        </p>
      ) : (
        <ul aria-label={kind === 'assets' ? 'Assets' : 'Templates'} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(row => {
            const name = nameOf(kind, row);
            const busy = busyId === row.id;
            const meta = kind === 'assets'
              ? [(row as AdminAsset).kind === 'link' ? 'Link' : formatSize((row as AdminAsset).size_bytes) || (row as AdminAsset).kind]
              : [];
            return (
              <li key={row.id} data-library-row={row.id} style={{
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px',
                background: 'var(--color-surface-1)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                opacity: busy ? 0.6 : 1,
              }}>
                <Preview kind={kind} row={row} />
                <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                    <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={name}>
                      {name}
                    </p>
                    <VisibilityBadge visibility={row.visibility} />
                    {row.status === 'hidden' && (
                      <span className="type-micro" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 'var(--radius-pill)',
                        background: 'color-mix(in srgb, var(--color-error) 12%, transparent)', color: 'var(--color-error)', whiteSpace: 'nowrap',
                      }}>
                        <EyeOff size={11} aria-hidden="true" /> Hidden
                      </span>
                    )}
                  </div>
                  <p className="type-caption" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                    by {row.owner_name ?? 'Unknown'} ({row.owner_roll})
                    {' · '}{row.workspace_is_personal ? 'Personal workspace' : row.workspace_name}
                    {meta.filter(Boolean).map(m => ` · ${m}`).join('')}
                    {' · '}{formatDate(row.created_at)}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div role="group" aria-label={`Visibility of ${name}`} className="segmented">
                    {(['personal', 'community'] as const).map(v => (
                      <button
                        key={v}
                        type="button"
                        disabled={busy}
                        aria-pressed={row.visibility === v}
                        onClick={() => { if (row.visibility !== v) update(row, { visibility: v }, `“${name}” set to ${VISIBILITY_LABEL[v]}`); }}
                        className="segmented-item touch-target"
                      >
                        {VISIBILITY_LABEL[v]}
                      </button>
                    ))}
                  </div>
                  {row.status === 'hidden' ? (
                    <button type="button" disabled={busy} onClick={() => update(row, { status: 'active' }, `“${name}” restored`)} className="btn-secondary btn-sm touch-target" aria-label={`Restore ${name}`}>
                      Restore
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => hide(row)} className="btn-translucent btn-sm is-danger touch-target" aria-label={`Hide ${name}`}>
                      Hide
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

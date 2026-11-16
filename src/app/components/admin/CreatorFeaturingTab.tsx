import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Search, Star } from 'lucide-react';
import { api, type CreatorAdminItem } from '../../lib/api';
import { VerifiedMark } from '../creators/CreatorParts';

// Admin: feature / unfeature public creators. Only profiles that are public
// and active are listed; the server re-checks on every change, caps the set,
// and writes an audit entry. Verification is set elsewhere — shown read-only.
export function CreatorFeaturingTab() {
  const [q, setQ] = useState('');
  const [onlyFeatured, setOnlyFeatured] = useState(false);
  const [data, setData] = useState<{ creators: CreatorAdminItem[]; featuredCount: number; max: number; available: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try { setData(await api.creators.adminList(q.trim() || undefined, onlyFeatured)); } catch { setError(true); }
  }, [q, onlyFeatured]);
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [load]);

  const toggle = async (c: CreatorAdminItem) => {
    setBusy(c.id);
    try {
      await api.creators.adminFeature(c.id, !c.featured);
      toast.success(c.featured ? `${c.displayName} is no longer featured` : `${c.displayName} is now featured`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Couldn’t update'); } finally { setBusy(null); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 className="type-headline" style={{ margin: 0 }}>Featured creators</h2>
        <p className="type-caption" style={{ margin: '4px 0 0' }}>Only creators with a public profile can be featured. Hiding a profile or making it private removes it from the directory automatically.{data?.available && ` Featured: ${data.featuredCount} / ${data.max}.`}</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-muted)' }} />
          <input className="input-base" type="search" aria-label="Search creators" placeholder="Search by name or username" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30 }} />
        </div>
        <button type="button" className="btn-translucent btn-sm" aria-pressed={onlyFeatured} onClick={() => setOnlyFeatured(v => !v)}><Star size={13} aria-hidden="true" /> Featured only</button>
      </div>
      {error && <div role="alert"><p className="type-body-sm">Couldn’t load creators.</p><button className="btn-translucent btn-sm" onClick={() => void load()}>Try again</button></div>}
      {data && !data.available && <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>Creator profiles aren’t available on this deployment yet.</p>}
      {data?.available && data.creators.length === 0 && <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>No public creators match.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data?.creators.map(c => (
          <div key={c.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)' }}>
            <div style={{ minWidth: 0 }}>
              <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>{c.displayName}{c.verified && <VerifiedMark />}</p>
              <p className="type-caption" style={{ margin: 0 }}>@{c.handle} · {c.ownerRoll}</p>
            </div>
            <button type="button" className={c.featured ? 'btn-translucent btn-sm' : 'btn-primary btn-sm'} disabled={busy === c.id} onClick={() => void toggle(c)} aria-label={`${c.featured ? 'Unfeature' : 'Feature'} ${c.displayName}`}>
              <Star size={13} aria-hidden="true" /> {c.featured ? 'Unfeature' : 'Feature'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

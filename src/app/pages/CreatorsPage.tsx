import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, Star, X } from 'lucide-react';
import { api, type CreatorCapabilities, type CreatorCard, type CreatorFacets } from '../lib/api';
import { CATEGORY_LABELS, SORTS, hasCreatorFilters, mergeCards, type CreatorSortId } from '../lib/creators';
import { CreatorCardView } from '../components/creators/CreatorParts';

// ─────────────────────────────────────────────────────────────────────────
// Public Creator Discovery. Only creators who made their profile public (and
// are not hidden) are ever returned by the API. Filters live in the URL so a
// view can be shared. Featured creators are an admin-curated strip.
// ─────────────────────────────────────────────────────────────────────────

const PAGE = 24;

export default function CreatorsPage() {
  const [params, setParams] = useSearchParams();
  const discipline = params.get('discipline') ?? '';
  const skill = params.get('skill') ?? '';
  const category = params.get('category') ?? '';
  const sort = (params.get('sort') as CreatorSortId) || 'featured';
  const urlQ = params.get('q') ?? '';

  const [search, setSearch] = useState(urlQ);
  const [creators, setCreators] = useState<CreatorCard[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const [facets, setFacets] = useState<CreatorFacets | null>(null);
  const [featured, setFeatured] = useState<CreatorCard[]>([]);
  const [caps, setCaps] = useState<CreatorCapabilities | null>(null);

  const set = useCallback((patch: Record<string, string | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => { const t = setTimeout(() => { if (search.trim() !== urlQ) set({ q: search.trim() || null }); }, 300); return () => clearTimeout(t); }, [search, urlQ, set]);
  useEffect(() => {
    api.creators.capabilities().then(setCaps).catch(() => setCaps({ profiles: false, projects: false, artworkCredits: false }));
    api.creators.facets().then(setFacets).catch(() => {});
    api.creators.featured().then(r => setFeatured(r.creators)).catch(() => {});
  }, []);

  const query = useMemo(() => ({ q: urlQ, discipline, skill, category, sort }), [urlQ, discipline, skill, category, sort]);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      const res = await api.creators.list({ ...query, limit: PAGE });
      if (mine !== seq.current) return;
      setCreators(res.creators); setTotal(res.total); setHasMore(res.hasMore); setState('ready');
    } catch { if (mine === seq.current) setState('error'); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    setMore(true);
    try {
      const res = await api.creators.list({ ...query, limit: PAGE, offset: creators.length });
      setCreators(prev => mergeCards(prev, res.creators)); setHasMore(res.hasMore); setTotal(res.total);
    } catch { /* keep what we have */ } finally { setMore(false); }
  };

  const filtersOn = hasCreatorFilters({ q: urlQ, discipline, skill, category });
  const clear = () => { setSearch(''); setParams(sort === 'featured' ? {} : { sort }, { replace: true }); };
  const unavailable = caps !== null && !caps.profiles;
  // While the Featured strip is showing (no filters), don't repeat those creators in the main grid.
  const stripShown = !filtersOn && featured.length > 0;
  const featuredHandles = new Set(featured.map(c => c.handle));
  const shown = stripShown ? creators.filter(c => !featuredHandles.has(c.handle)) : creators;

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '6rem', paddingBottom: '5rem' }}>
      <div className="page-container">
        <header style={{ marginBottom: 'var(--space-xl)' }}>
          <p className="type-caption" style={{ marginBottom: 8 }}>DnA Club</p>
          <h1 className="type-display-md" style={{ margin: 0 }}>Creators</h1>
          <p className="type-body" style={{ margin: '10px 0 0', color: 'var(--color-ink-muted)', maxWidth: 640 }}>
            The designers, illustrators, animators and makers of the DnA community. Find someone by what they do, then explore their work.
          </p>
        </header>

        {unavailable ? (
          <div style={{ padding: '56px 16px', textAlign: 'center', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-xl)' }}>
            <h2 className="type-headline" style={{ margin: '0 0 6px' }}>Creator profiles are coming soon</h2>
            <p className="type-body-sm" style={{ margin: '0 auto', maxWidth: 440, color: 'var(--color-ink-muted)' }}>Check back once members start publishing their profiles.</p>
          </div>
        ) : (
          <>
            {!filtersOn && featured.length > 0 && (
              <section aria-label="Featured creators" style={{ marginBottom: 'var(--space-xl)' }}>
                <h2 className="type-headline" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Star size={16} aria-hidden="true" /> Featured creators</h2>
                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
                  {featured.map(c => <CreatorCardView key={c.handle} creator={c} />)}
                </div>
              </section>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0 }}>
                <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-muted)' }} />
                <input className="input-base" type="search" aria-label="Search creators" placeholder="Search by name, username, discipline or skill" value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 34 }} />
              </div>
              <select className="input-base" aria-label="Discipline" value={discipline} onChange={e => set({ discipline: e.target.value || null })} style={{ flex: '0 1 180px' }}>
                <option value="">All disciplines</option>
                {facets?.disciplines.map(d => <option key={d.id} value={d.id}>{d.title} ({d.count})</option>)}
              </select>
              {!!facets?.categories.length && (
                <select className="input-base" aria-label="Project category" value={category} onChange={e => set({ category: e.target.value || null })} style={{ flex: '0 1 190px' }}>
                  <option value="">Any project category</option>
                  {facets.categories.map(c => <option key={c.category} value={c.category}>{CATEGORY_LABELS[c.category] ?? c.category} ({c.count})</option>)}
                </select>
              )}
              <select className="input-base" aria-label="Sort" value={sort} onChange={e => set({ sort: e.target.value === 'featured' ? null : e.target.value })} style={{ flex: '0 1 170px' }}>
                {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            {!!facets?.skills.length && (
              <div role="group" aria-label="Filter by skill" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
                {facets.skills.slice(0, 20).map(s => {
                  const on = skill === s.skill;
                  return (
                    <button key={s.skill} type="button" aria-pressed={on} onClick={() => set({ skill: on ? null : s.skill })}
                      style={{ display: 'inline-flex', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', flexShrink: 0, fontFamily: 'var(--font-body)', fontSize: 13, whiteSpace: 'nowrap', color: 'var(--color-ink)', background: on ? 'var(--color-surface-2)' : 'transparent', border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-hairline)'}` }}>
                      {s.skill} <span className="type-micro">{s.count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {filtersOn && (
              <p className="type-caption" role="status" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {total} {total === 1 ? 'creator' : 'creators'}
                <button type="button" className="btn-translucent btn-sm" style={{ minHeight: 28 }} onClick={clear}><X size={12} aria-hidden="true" /> Clear filters</button>
              </p>
            )}

            {state === 'loading' && (
              <div role="status" aria-label="Loading creators" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
                {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ height: 190, borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', border: '1px solid var(--color-hairline)', opacity: 0.6 }} />)}
              </div>
            )}
            {state === 'error' && (
              <div role="alert" style={{ padding: '48px 0', textAlign: 'center' }}>
                <p className="type-body" style={{ color: 'var(--color-ink-muted)', margin: '0 0 12px' }}>Couldn’t load creators.</p>
                <button type="button" className="btn-translucent" onClick={() => void load()}>Try again</button>
              </div>
            )}
            {state === 'ready' && creators.length === 0 && (
              <div style={{ padding: '56px 16px', textAlign: 'center', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-xl)' }}>
                <h2 className="type-headline" style={{ margin: '0 0 6px' }}>{filtersOn ? 'No creators match these filters' : 'No public creators yet'}</h2>
                <p className="type-body-sm" style={{ margin: '0 auto 14px', maxWidth: 440, color: 'var(--color-ink-muted)' }}>
                  {filtersOn ? 'Try a different search, discipline or skill.' : 'Creators appear here once they choose to make their profile public.'}
                </p>
                {filtersOn && <button type="button" className="btn-translucent" onClick={clear}>Clear filters</button>}
              </div>
            )}
            {state === 'ready' && creators.length > 0 && (
              <>
                {stripShown && <h2 className="type-headline" style={{ margin: '8px 0 12px' }}>All creators</h2>}
                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
                  {shown.map(c => <CreatorCardView key={c.handle} creator={c} />)}
                </div>
                {hasMore && <div style={{ textAlign: 'center', padding: '24px 0' }}><button type="button" className="btn-translucent" onClick={loadMore} disabled={more}>{more ? 'Loading…' : `Show more (${total - creators.length} left)`}</button></div>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, X, Star } from 'lucide-react';
import { api, type ShowcaseCard, type ShowcaseFacets } from '../lib/api';
import { CATEGORY_OPTIONS, hasFilters } from '../lib/showcase';
import { ShowcaseProjectCard } from '../components/showcase/ShowcaseParts';

// ─────────────────────────────────────────────────────────────────────────
// Public Showcase listing. Everything here is public: only published,
// admin-approved projects ever come back from the API. Filters live in the
// URL so a filtered view can be shared or bookmarked.
// ─────────────────────────────────────────────────────────────────────────

const PAGE = 24;
const SORTS = [{ id: 'featured', label: 'Featured first' }, { id: 'newest', label: 'Newest' }, { id: 'oldest', label: 'Oldest' }, { id: 'title', label: 'Title A–Z' }] as const;
type SortId = typeof SORTS[number]['id'];

export default function ShowcasePage() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const discipline = params.get('discipline') ?? '';
  const tags = useMemo(() => (params.get('tag') ?? '').split(',').filter(Boolean), [params]);
  const featured = params.get('featured') === '1';
  const sort = (params.get('sort') as SortId) || 'featured';
  const urlQ = params.get('q') ?? '';

  const [search, setSearch] = useState(urlQ);
  const [projects, setProjects] = useState<ShowcaseCard[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const [facets, setFacets] = useState<ShowcaseFacets>({ categories: [], disciplines: [], tags: [] });

  const set = useCallback((patch: Record<string, string | null>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => { const t = setTimeout(() => { if (search.trim() !== urlQ) set({ q: search.trim() || null }); }, 300); return () => clearTimeout(t); }, [search, urlQ, set]);
  useEffect(() => { api.showcase.facets().then(setFacets).catch(() => { /* filters just stay empty */ }); }, []);

  const seq = useRef(0);
  const query = useMemo(() => ({ q: urlQ, category, discipline, tags, featured, sort }), [urlQ, category, discipline, tags, featured, sort]);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      const res = await api.showcase.list({ ...query, limit: PAGE });
      if (mine !== seq.current) return;
      setProjects(res.projects); setTotal(res.total); setHasMore(res.hasMore); setState('ready');
    } catch { if (mine === seq.current) setState('error'); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    setMore(true);
    try {
      const res = await api.showcase.list({ ...query, limit: PAGE, offset: projects.length });
      setProjects(prev => [...prev, ...res.projects.filter(p => !prev.some(x => x.slug === p.slug))]);
      setHasMore(res.hasMore); setTotal(res.total);
    } catch { /* keep what we have */ } finally { setMore(false); }
  };

  const filtersOn = hasFilters({ q: urlQ, category, discipline, tags, featured });
  const clear = () => { setSearch(''); setParams({}, { replace: true }); };
  const chip = (on: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', flexShrink: 0,
    fontFamily: 'var(--font-body)', fontSize: 13, whiteSpace: 'nowrap', color: 'var(--color-ink)',
    background: on ? 'var(--color-surface-2)' : 'transparent', border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-hairline)'}`,
  });

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '6rem', paddingBottom: '5rem' }}>
      <div className="page-container">
        <header style={{ marginBottom: 'var(--space-xl)' }}>
          <p className="type-caption" style={{ marginBottom: 8 }}>DnA Club</p>
          <h1 className="type-display-md" style={{ margin: 0 }}>Showcase</h1>
          <p className="type-body" style={{ margin: '10px 0 0', color: 'var(--color-ink-muted)', maxWidth: 640 }}>
            Projects created by DnA Club students — reviewed by the club before they appear here.
          </p>
        </header>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0 }}>
            <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-ink-muted)' }} />
            <input className="input-base" type="search" aria-label="Search projects" placeholder="Search projects, notes and tags" value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 34 }} />
          </div>
          <select className="input-base" aria-label="Category" value={category} onChange={e => set({ category: e.target.value || null })} style={{ flex: '0 1 170px' }}>
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map(c => { const n = facets.categories.find(f => f.category === c.id)?.count; return <option key={c.id} value={c.id}>{c.label}{n ? ` (${n})` : ''}</option>; })}
          </select>
          <select className="input-base" aria-label="Discipline" value={discipline} onChange={e => set({ discipline: e.target.value || null })} style={{ flex: '0 1 180px' }}>
            <option value="">All disciplines</option>
            {facets.disciplines.map(d => <option key={d.id} value={d.id}>{d.title} ({d.count})</option>)}
          </select>
          <select className="input-base" aria-label="Sort" value={sort} onChange={e => set({ sort: e.target.value === 'featured' ? null : e.target.value })} style={{ flex: '0 1 160px' }}>
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <div role="group" aria-label="Quick filters" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
          <button type="button" aria-pressed={featured} style={chip(featured)} onClick={() => set({ featured: featured ? null : '1' })}><Star size={13} aria-hidden="true" /> Featured</button>
          {facets.tags.slice(0, 20).map(t => {
            const on = tags.includes(t.tag);
            return <button key={t.tag} type="button" aria-pressed={on} style={chip(on)} onClick={() => set({ tag: (on ? tags.filter(x => x !== t.tag) : [...tags, t.tag]).join(',') || null })}>#{t.tag} <span className="type-micro">{t.count}</span></button>;
          })}
        </div>

        {filtersOn && (
          <p className="type-caption" role="status" style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {total} {total === 1 ? 'project' : 'projects'}
            <button type="button" className="btn-translucent btn-sm" style={{ minHeight: 28 }} onClick={clear}><X size={12} aria-hidden="true" /> Clear filters</button>
          </p>
        )}

        {state === 'loading' && <div role="status" style={{ padding: '60px 0', textAlign: 'center', color: 'var(--color-ink-muted)' }}>Loading projects…</div>}
        {state === 'error' && (
          <div role="alert" style={{ padding: '48px 0', textAlign: 'center' }}>
            <p className="type-body" style={{ color: 'var(--color-ink-muted)', margin: '0 0 12px' }}>Couldn’t load the Showcase.</p>
            <button type="button" className="btn-translucent" onClick={() => void load()}>Try again</button>
          </div>
        )}
        {state === 'ready' && projects.length === 0 && (
          <div style={{ padding: '56px 16px', textAlign: 'center', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-xl)' }}>
            <h2 className="type-headline" style={{ margin: '0 0 6px' }}>{filtersOn ? 'No projects match these filters' : 'No projects published yet'}</h2>
            <p className="type-body-sm" style={{ margin: '0 auto 14px', maxWidth: 420, color: 'var(--color-ink-muted)' }}>
              {filtersOn ? 'Try a different search, category or tag.' : 'Approved student projects will appear here.'}
            </p>
            {filtersOn && <button type="button" className="btn-translucent" onClick={clear}>Clear filters</button>}
          </div>
        )}
        {state === 'ready' && projects.length > 0 && (
          <>
            <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
              {projects.map(p => <ShowcaseProjectCard key={p.slug} project={p} />)}
            </div>
            {hasMore && <div style={{ textAlign: 'center', padding: '24px 0' }}><button type="button" className="btn-translucent" onClick={loadMore} disabled={more}>{more ? 'Loading…' : `Show more (${total - projects.length} left)`}</button></div>}
          </>
        )}
      </div>
    </div>
  );
}

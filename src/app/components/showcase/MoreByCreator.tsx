import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { api, type CreatorProject } from '../../lib/api';
import { categoryLabel, featuredCreatorOf, moreByCreator } from '../../lib/showcase';
import { profilePath } from '../../lib/creators';
import { CoverImage } from './ShowcaseParts';

// "More by this creator" on a public Showcase project. Everything shown comes
// from GET /api/creators/:handle/projects, which already returns only
// PUBLISHED projects the creator is credited on with an ACCEPTED credit, and
// answers the same 404 for private/hidden/unknown profiles — so a creator who
// is not publicly linkable simply gets no section here.

type Props = { slug: string; credits: Array<{ displayName: string | null; isOwner: boolean; profile?: { handle: string } }> };

export function MoreByCreator({ slug, credits }: Props) {
  const creator = featuredCreatorOf(credits);
  const handle = creator?.handle ?? null;
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'hidden'>('loading');
  const [items, setItems] = useState<CreatorProject[]>([]);

  const load = useCallback(() => {
    if (!handle) { setState('hidden'); return; }
    let live = true;
    setState('loading');
    api.creators.projects(handle)
      .then(r => { if (live) { setItems(moreByCreator(r.projects, slug, 3)); setState('ready'); } })
      .catch(err => { if (live) setState(err instanceof Error && err.message === 'Creator not found' ? 'hidden' : 'error'); });
    return () => { live = false; };
  }, [handle, slug]);
  useEffect(() => load(), [load]);

  if (!creator || state === 'hidden') return null;
  const name = creator.name;

  return (
    <section aria-labelledby="more-by-creator" style={{ marginTop: 'var(--space-xl, 56px)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--color-hairline)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 'var(--space-md, 16px)' }}>
        <h2 id="more-by-creator" className="type-headline" style={{ margin: 0, overflowWrap: 'anywhere' }}>More by {name}</h2>
        <Link to={profilePath(creator.handle)} className="type-body-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-brand)', textDecoration: 'none', fontWeight: 600 }}>
          View {name}’s profile <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      {state === 'loading' && <p role="status" className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>Loading more projects…</p>}

      {state === 'error' && (
        <p role="alert" className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>
          Couldn’t load more projects. <button type="button" className="btn-translucent btn-sm" onClick={() => load()}>Try again</button>
        </p>
      )}

      {state === 'ready' && items.length === 0 && (
        <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)' }}>This is {name}’s only published project so far.</p>
      )}

      {state === 'ready' && items.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gap: 16 }}>
          {items.map(p => (
            <li key={p.slug} style={{ minWidth: 0 }}>
              <Link to={`/showcase/${p.slug}`} aria-label={`${p.title}${categoryLabel(p.category) ? `, ${categoryLabel(p.category)}` : ''}`}
                style={{ display: 'flex', flexDirection: 'column', textDecoration: 'none', color: 'inherit', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', overflow: 'hidden', height: '100%' }}>
                <CoverImage src={p.coverUrl} />
                <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, color: 'var(--color-ink)', overflowWrap: 'anywhere' }}>{p.title}</p>
                  {(categoryLabel(p.category) || p.roleLabel) && <p className="type-micro" style={{ margin: 0 }}>{[categoryLabel(p.category), p.roleLabel].filter(Boolean).join(' · ')}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

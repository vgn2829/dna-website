import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { api, type CreatorCapabilities, type CreatorProject, type DesignerProfile, type DesignerWork } from '../lib/api';
import { categoryLabel, profileTitle, showsProjects } from '../lib/creators';
import { CreatorAvatar, DisciplineChips, VerifiedMark } from '../components/creators/CreatorParts';

// ─────────────────────────────────────────────────────────────────────────
// Public creator profile at /designers/:handle. The identity and artwork come
// from PR #84's public profile contract (which answers 404 for private,
// members-only-to-strangers and hidden profiles — shown here as the same
// "not found"); published projects come from /api/creators/:handle/projects
// (accepted credits, published projects only). Nothing private is requested.
// ─────────────────────────────────────────────────────────────────────────

const LINK_LABEL: Record<string, string> = { website: 'Website', behance: 'Behance', dribbble: 'Dribbble', instagram: 'Instagram', linkedin: 'LinkedIn', github: 'GitHub', youtube: 'YouTube', other: 'Link' };

function Tile({ src, title, meta, to }: { src: string | null; title: string; meta?: string | null; to?: string }) {
  const [failed, setFailed] = useState(false);
  const body = (
    <>
      <div style={{ aspectRatio: '4 / 3', background: 'var(--color-surface-2)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink-muted)' }}>
        {src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <ImageIcon size={24} aria-hidden="true" />}
      </div>
      <div style={{ padding: '10px 12px 12px', minWidth: 0 }}>
        <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, color: 'var(--color-ink)', overflowWrap: 'anywhere' }}>{title}</p>
        {meta && <p className="type-micro" style={{ margin: '2px 0 0' }}>{meta}</p>}
      </div>
    </>
  );
  const style: React.CSSProperties = { display: 'flex', flexDirection: 'column', minWidth: 0, textDecoration: 'none', color: 'inherit', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', overflow: 'hidden' };
  return to ? <Link to={to} style={style}>{body}</Link> : <div style={style}>{body}</div>;
}

export default function CreatorProfilePage() {
  const { handle = '' } = useParams<{ handle: string }>();
  const [profile, setProfile] = useState<DesignerProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [caps, setCaps] = useState<CreatorCapabilities | null>(null);
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [projTotal, setProjTotal] = useState(0);
  const [projMore, setProjMore] = useState(false);
  const [projectsFailed, setProjectsFailed] = useState(false);
  const [works, setWorks] = useState<DesignerWork[]>([]);
  const [worksNext, setWorksNext] = useState<string | null>(null);
  const [worksLoading, setWorksLoading] = useState(false);

  const load = useCallback(() => {
    setState('loading'); setProfile(null); setProjects([]); setWorks([]); setWorksNext(null); setProjectsFailed(false);
    api.designers.get(handle)
      .then(p => { setProfile(p); setState('ready'); })
      .catch(err => setState(err instanceof Error && err.message === 'Designer profile not found' ? 'missing' : 'error'));
  }, [handle]);
  useEffect(load, [load]);

  useEffect(() => {
    if (state !== 'ready') return;
    api.creators.capabilities().then(setCaps).catch(() => setCaps(null));
    api.designers.works(handle).then(r => { setWorks(r.items); setWorksNext(r.next); }).catch(() => {});
  }, [state, handle]);

  useEffect(() => {
    if (state !== 'ready' || !showsProjects(caps)) return;
    api.creators.projects(handle).then(r => { setProjects(r.projects); setProjTotal(r.total); setProjMore(r.hasMore); }).catch(() => setProjectsFailed(true));
  }, [state, caps, handle]);

  useEffect(() => {
    if (profile) document.title = profileTitle(profile);
    return () => { document.title = 'DnA Club'; };
  }, [profile]);

  const moreProjects = async () => {
    try { const r = await api.creators.projects(handle, projects.length); setProjects(p => [...p, ...r.projects.filter(x => !p.some(y => y.slug === x.slug))]); setProjMore(r.hasMore); } catch { /* keep */ }
  };
  const moreWorks = async () => {
    if (!worksNext) return;
    setWorksLoading(true);
    try { const r = await api.designers.works(handle, worksNext); setWorks(w => [...w, ...r.items.filter(x => !w.some(y => y.id === x.id))]); setWorksNext(r.next); } catch { /* keep */ } finally { setWorksLoading(false); }
  };

  const grid: React.CSSProperties = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' };

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '6rem', paddingBottom: '5rem' }}>
      <div className="page-container" style={{ maxWidth: 1080 }}>
        <Link to="/creators" className="btn-translucent btn-sm" style={{ marginBottom: 'var(--space-lg)', display: 'inline-flex' }}><ArrowLeft size={14} aria-hidden="true" /> Creators</Link>

        {state === 'loading' && <div role="status" style={{ padding: '80px 0', textAlign: 'center', color: 'var(--color-ink-muted)' }}>Loading…</div>}
        {state === 'missing' && (
          <div style={{ padding: '80px 0', textAlign: 'center' }}>
            <h1 className="type-headline" style={{ margin: '0 0 8px' }}>Creator not found</h1>
            <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)', margin: '0 0 16px' }}>This profile doesn’t exist or isn’t public.</p>
            <Link to="/creators" className="btn-primary">Browse creators</Link>
          </div>
        )}
        {state === 'error' && (
          <div role="alert" style={{ padding: '80px 0', textAlign: 'center' }}>
            <p className="type-body" style={{ color: 'var(--color-ink-muted)', margin: '0 0 12px' }}>Couldn’t load this profile.</p>
            <button type="button" className="btn-translucent" onClick={load}>Try again</button>
          </div>
        )}

        {state === 'ready' && profile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
            <header style={{ border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-xl)', background: 'var(--color-surface-1)', overflow: 'hidden' }}>
              {profile.coverUrl && <div style={{ height: 160, background: 'var(--color-surface-2)' }}><img src={profile.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} /></div>}
              <div style={{ padding: 24, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
                <CreatorAvatar name={profile.displayName} src={profile.avatarUrl} size={96} />
                <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <h1 className="type-display-md" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, overflowWrap: 'anywhere' }}>{profile.displayName}{profile.verified && <VerifiedMark size={22} />}</h1>
                    <p className="type-caption" style={{ margin: '4px 0 0' }}>@{profile.handle}{[profile.department, profile.batch].filter(Boolean).length > 0 && ` · ${[profile.department, profile.batch].filter(Boolean).join(' · ')}`}</p>
                  </div>
                  {profile.headline && <p className="type-body" style={{ margin: 0 }}>{profile.headline}</p>}
                  {profile.bio && <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink-muted)', whiteSpace: 'pre-wrap', maxWidth: 680, overflowWrap: 'anywhere' }}>{profile.bio}</p>}
                  <DisciplineChips disciplines={profile.disciplines} max={6} linked />
                  {profile.skills.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {profile.skills.map(s => <Link key={s} to={`/creators?skill=${encodeURIComponent(s)}`} className="type-micro" style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)', color: 'var(--color-ink-muted)', textDecoration: 'none' }}>{s}</Link>)}
                    </div>
                  )}
                  {!!profile.tools?.length && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }} aria-label="Tools">
                      <span className="type-micro" style={{ marginRight: 2 }}>Tools</span>
                      {profile.tools.map(t => <Link key={t} to={`/creators?tool=${encodeURIComponent(t)}`} className="type-micro" style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', color: 'var(--color-ink-muted)', textDecoration: 'none' }}>{t}</Link>)}
                    </div>
                  )}
                  {profile.links.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {profile.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="btn-translucent btn-sm"><ExternalLink size={13} aria-hidden="true" /> {LINK_LABEL[l.kind] ?? 'Link'}</a>)}
                    </div>
                  )}
                </div>
              </div>
            </header>

            {showsProjects(caps) && (
              <section aria-label="Published projects">
                <h2 className="type-headline" style={{ margin: '0 0 12px' }}>Projects{projTotal > 0 ? ` (${projTotal})` : ''}</h2>
                {projectsFailed && <p role="alert" className="type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>Couldn’t load projects right now.</p>}
                {!projectsFailed && projects.length === 0 && <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)', margin: 0 }}>No published projects yet.</p>}
                <div style={grid}>
                  {projects.map(p => <Tile key={p.slug} to={`/showcase/${p.slug}`} src={p.coverUrl} title={p.title} meta={[categoryLabel(p.category), p.isOwner ? null : p.roleLabel].filter(Boolean).join(' · ') || null} />)}
                </div>
                {projMore && <div style={{ textAlign: 'center', padding: '16px 0' }}><button type="button" className="btn-translucent" onClick={() => void moreProjects()}>Show more projects</button></div>}
              </section>
            )}

            <section aria-label="Artwork">
              <h2 className="type-headline" style={{ margin: '0 0 12px' }}>Artwork{profile.worksCount > 0 ? ` (${profile.worksCount})` : ''}</h2>
              {works.length === 0 && <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)', margin: 0 }}>No credited artwork yet.</p>}
              <div style={grid}>
                {works.map(w => <Tile key={w.id} src={w.coverUrl} title={w.title} meta={[w.domain, w.roleLabel ?? (w.role === 'creator' ? null : w.role)].filter(Boolean).join(' · ') || null} />)}
              </div>
              {worksNext && <div style={{ textAlign: 'center', padding: '16px 0' }}><button type="button" className="btn-translucent" onClick={() => void moreWorks()} disabled={worksLoading}>{worksLoading ? 'Loading…' : 'Show more artwork'}</button></div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

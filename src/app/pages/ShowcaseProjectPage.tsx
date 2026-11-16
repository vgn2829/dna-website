import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { api, type ShowcaseDetail } from '../lib/api';
import { ShowcaseArticle } from '../components/showcase/ShowcaseParts';
import { MoreByCreator } from '../components/showcase/MoreByCreator';

// Public project detail. Anything that isn't a published project — a draft, a
// project in review, an archived or unknown slug — is the same "not found".
export default function ShowcaseProjectPage() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<ShowcaseDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  const load = () => {
    if (!slug) return;
    setState('loading');
    api.showcase.get(slug)
      .then(p => { setProject(p); setState('ready'); })
      .catch(err => setState(err instanceof Error && err.message === 'Project not found' ? 'missing' : 'error'));
  };
  useEffect(load, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (project) document.title = `${project.title} — DnA Club Showcase`;
    return () => { document.title = 'DnA Club'; };
  }, [project]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '6rem', paddingBottom: '5rem' }}>
      <div className="page-container" style={{ maxWidth: 1080 }}>
        <Link to="/showcase" className="btn-translucent btn-sm" style={{ marginBottom: 'var(--space-lg)', display: 'inline-flex' }}><ArrowLeft size={14} aria-hidden="true" /> Showcase</Link>
        {state === 'loading' && <div role="status" style={{ padding: '80px 0', textAlign: 'center', color: 'var(--color-ink-muted)' }}>Loading…</div>}
        {state === 'missing' && (
          <div style={{ padding: '80px 0', textAlign: 'center' }}>
            <h1 className="type-headline" style={{ margin: '0 0 8px' }}>Project not found</h1>
            <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)', margin: '0 0 16px' }}>It may not be published, or the link is wrong.</p>
            <Link to="/showcase" className="btn-primary">Browse the Showcase</Link>
          </div>
        )}
        {state === 'error' && (
          <div role="alert" style={{ padding: '80px 0', textAlign: 'center' }}>
            <p className="type-body" style={{ color: 'var(--color-ink-muted)', margin: '0 0 12px' }}>Couldn’t load this project.</p>
            <button type="button" className="btn-translucent" onClick={load}>Try again</button>
          </div>
        )}
        {state === 'ready' && project && (
          <>
            <ShowcaseArticle data={project} />
            <MoreByCreator slug={project.slug} credits={project.credits} />
          </>
        )}
      </div>
    </div>
  );
}

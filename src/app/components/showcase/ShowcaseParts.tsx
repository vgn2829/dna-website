import { Link } from 'react-router';
import { ExternalLink, Image as ImageIcon, Star } from 'lucide-react';
import type { ShowcaseCard, ShowcaseDetail, ShowcaseStatus } from '../../lib/api';
import { STATUS_INFO, creditLine, formatDate, topicLine } from '../../lib/showcase';

// ─────────────────────────────────────────────────────────────────────────
// Presentation shared by the public Showcase, the creator's preview and the
// admin review: status badge, project card, and the case-study article.
// The article renders ONLY what it is given — for the public that is the
// server's allowlisted published payload.
// ─────────────────────────────────────────────────────────────────────────

const TONE: Record<string, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--color-surface-2)', fg: 'var(--color-ink-muted)' },
  info: { bg: 'rgba(0,122,255,0.16)', fg: 'var(--color-ink)' },
  warn: { bg: 'rgba(255,170,0,0.2)', fg: 'var(--color-ink)' },
  good: { bg: 'rgba(52,199,89,0.2)', fg: 'var(--color-ink)' },
  bad: { bg: 'rgba(255,69,58,0.2)', fg: 'var(--color-ink)' },
};

export function StatusBadge({ status }: { status: ShowcaseStatus }) {
  const info = STATUS_INFO[status];
  const t = TONE[info.tone];
  return (
    <span className="type-micro" style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: t.bg, color: t.fg, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {info.label}
    </span>
  );
}

export function CoverImage({ src, ratio = '4 / 3', alt = '' }: { src: string | null; ratio?: string; alt?: string }) {
  return (
    <div style={{ width: '100%', aspectRatio: ratio, background: 'var(--color-surface-2)', overflow: 'hidden', position: 'relative' }}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink-muted)' }}><ImageIcon size={28} aria-hidden="true" /></div>
      )}
    </div>
  );
}

export function ShowcaseProjectCard({ project }: { project: ShowcaseCard }) {
  const credits = creditLine(project.credits);
  return (
    <Link
      to={`/showcase/${project.slug}`}
      aria-label={`${project.title}${credits ? `, by ${credits}` : ''}`}
      style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textDecoration: 'none', color: 'inherit', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', overflow: 'hidden', position: 'relative' }}
    >
      <CoverImage src={project.cover?.url ?? null} />
      {project.featured && (
        <span className="type-micro" style={{ position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: 'rgba(17,17,16,0.78)', color: '#fff' }}>
          <Star size={11} aria-hidden="true" /> Featured
        </span>
      )}
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, color: 'var(--color-ink)', overflowWrap: 'anywhere' }}>{project.title}</p>
        {credits && <p className="type-caption" style={{ margin: 0 }}>{credits}</p>}
        <p className="type-micro" style={{ margin: '2px 0 0' }}>
          {topicLine(project.category, project.disciplines)}
        </p>
      </div>
    </Link>
  );
}

type ArticleData = Pick<ShowcaseDetail, 'title' | 'summary' | 'description' | 'category' | 'tags' | 'disciplines' | 'credits' | 'links' | 'works' | 'artworks' | 'publishedAt'> & { cover?: ShowcaseDetail['cover'] };

export function ShowcaseArticle({ data, preview = false }: { data: ArticleData; preview?: boolean }) {
  const hero = data.cover?.url ?? data.works[0]?.url ?? null;
  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="type-caption" style={{ margin: 0 }}>
          {topicLine(data.category, data.disciplines, 4) || (preview ? 'No category yet' : '')}
        </p>
        <h1 className="type-display-md" style={{ margin: 0, overflowWrap: 'anywhere' }}>{data.title}</h1>
        {data.summary && <p className="type-body" style={{ margin: 0, color: 'var(--color-ink-muted)', maxWidth: 720 }}>{data.summary}</p>}
        <p className="type-caption" style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {data.credits.length === 0 && preview && <span>No credits yet</span>}
          {data.credits.map((c, i) => (
            <span key={i}>
              {'profile' in c && c.profile ? <Link to={`/designers/${c.profile.handle}`} style={{ color: 'var(--color-ink)' }}>{c.displayName}</Link> : <span style={{ color: 'var(--color-ink)' }}>{c.displayName}</span>}
              {c.roleLabel ? ` · ${c.roleLabel}` : ''}
            </span>
          ))}
          {data.publishedAt && <span>· {formatDate(data.publishedAt)}</span>}
        </p>
      </header>

      {hero && <CoverImage src={hero} ratio="16 / 9" alt={`${data.title} cover`} />}

      {data.description && <p className="type-body" style={{ margin: 0, maxWidth: 760, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.description}</p>}

      {data.works.length > 0 && (
        <section aria-label="Project images" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {data.works.map((w, i) => (
            <figure key={i} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <a href={w.url} target="_blank" rel="noopener noreferrer" aria-label={`Open image ${i + 1} full size`}>
                <img src={w.url} alt={w.caption ?? `${data.title} — image ${i + 1}`} loading="lazy" decoding="async"
                  style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-hairline)' }} />
              </a>
              {w.caption && <figcaption className="type-caption">{w.caption}</figcaption>}
            </figure>
          ))}
        </section>
      )}

      {data.artworks.length > 0 && (
        <section aria-label="Gallery artwork">
          <h2 className="type-headline" style={{ margin: '0 0 10px' }}>From the Gallery</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {data.artworks.map(a => <Link key={a.id} to="/gallery" className="btn-translucent btn-sm">{a.title}</Link>)}
          </div>
        </section>
      )}

      {(data.links.length > 0 || data.tags.length > 0) && (
        <footer style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.links.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {data.links.map((l, i) => (
                <a key={i} href={l.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="btn-translucent btn-sm">
                  <ExternalLink size={13} aria-hidden="true" /> {l.label}
                </a>
              ))}
            </div>
          )}
          {data.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.tags.map(t => (
                preview
                  ? <span key={t} className="type-micro" style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)' }}>#{t}</span>
                  : <Link key={t} to={`/showcase?tag=${encodeURIComponent(t)}`} className="type-micro" style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', color: 'var(--color-ink-muted)', textDecoration: 'none' }}>#{t}</Link>
              ))}
            </div>
          )}
        </footer>
      )}
    </article>
  );
}

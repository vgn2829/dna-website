import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BadgeCheck, Star } from 'lucide-react';
import type { CreatorCard, CreatorDiscipline } from '../../lib/api';
import type { ArtworkCredit } from '../../context/AppDataContext';
import { bylineParts, initials, profilePath, projectCountLabel } from '../../lib/creators';

// ─────────────────────────────────────────────────────────────────────────
// Presentation for Creator Discovery. Everything rendered comes from the
// server's allowlisted public payloads.
// ─────────────────────────────────────────────────────────────────────────

/** Profile picture with an initials fallback — a missing or deleted image never shows a broken icon. */
export function CreatorAvatar({ name, src, size = 56 }: { name: string; src: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  // A new image (e.g. just uploaded) gets a fresh chance after an earlier one failed.
  useEffect(() => { setFailed(false); }, [src]);
  const show = src && !failed;
  return (
    <div aria-hidden="true" style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', position: 'relative',
      background: 'var(--color-surface-2)', border: '1px solid var(--color-hairline)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: Math.round(size * 0.34),
    }}>
      {show
        ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : initials(name)}
    </div>
  );
}

export function VerifiedMark({ size = 15 }: { size?: number }) {
  return <BadgeCheck size={size} aria-label="Verified by the club" role="img" style={{ color: 'var(--color-brand)', flexShrink: 0 }} />;
}

export function DisciplineChips({ disciplines, max = 3, linked = false }: { disciplines: CreatorDiscipline[]; max?: number; linked?: boolean }) {
  if (disciplines.length === 0) return null;
  const chip: React.CSSProperties = { padding: '2px 9px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--color-hairline)', color: 'var(--color-ink-muted)', textDecoration: 'none', whiteSpace: 'nowrap' };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {disciplines.slice(0, max).map(d => linked
        ? <Link key={d.id} to={`/creators?discipline=${encodeURIComponent(d.id)}`} className="type-micro" style={chip}>{d.title}</Link>
        : <span key={d.id} className="type-micro" style={chip}>{d.title}</span>)}
      {disciplines.length > max && <span className="type-micro" style={{ color: 'var(--color-ink-muted)', alignSelf: 'center' }}>+{disciplines.length - max}</span>}
    </div>
  );
}

export function CreatorCardView({ creator }: { creator: CreatorCard }) {
  const count = projectCountLabel(creator.projectCount);
  return (
    <Link
      to={profilePath(creator.handle)}
      aria-label={`${creator.displayName}, @${creator.handle}${creator.headline ? `, ${creator.headline}` : ''}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, padding: 16, textDecoration: 'none', color: 'inherit', border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface-1)', position: 'relative' }}
    >
      {creator.featured && (
        <span className="type-micro" style={{ position: 'absolute', top: 12, right: 12, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-2)' }}>
          <Star size={11} aria-hidden="true" /> Featured
        </span>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0, paddingRight: creator.featured ? 72 : 0 }}>
        <CreatorAvatar name={creator.displayName} src={creator.avatarUrl} />
        <div style={{ minWidth: 0 }}>
          <p className="type-body-sm" style={{ margin: 0, fontWeight: 600, color: 'var(--color-ink)', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ overflowWrap: 'anywhere' }}>{creator.displayName}</span>{creator.verified && <VerifiedMark />}
          </p>
          <p className="type-caption" style={{ margin: 0, overflowWrap: 'anywhere' }}>@{creator.handle}</p>
        </div>
      </div>
      {creator.headline && <p className="type-body-sm" style={{ margin: 0, color: 'var(--color-ink)' }}>{creator.headline}</p>}
      {creator.bio && <p className="type-caption" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{creator.bio}</p>}
      <DisciplineChips disciplines={creator.disciplines} />
      {creator.projects.length > 0 && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {creator.projects.map(p => (
              <div key={p.slug} title={p.title} style={{ aspectRatio: '4 / 3', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--color-surface-2)' }}>
                {p.coverUrl && <img src={p.coverUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              </div>
            ))}
          </div>
          {count && <p className="type-micro" style={{ margin: '6px 0 0' }}>{count}</p>}
        </div>
      )}
    </Link>
  );
}

/** Gallery byline: accepted credits (linked when the profile is linkable), else the legacy artist text. */
export function ArtworkByline({ artwork, upper, className, style }: { artwork: { artist: string; credits?: ArtworkCredit[] }; upper?: boolean; className?: string; style?: React.CSSProperties }) {
  const parts = bylineParts(artwork);
  if (parts.length === 0) return null;
  return (
    <p className={className} style={{ ...style, textTransform: upper ? 'uppercase' : 'none' }}>
      by{' '}
      {parts.map((p, i) => (
        <span key={`${p.text}-${i}`}>
          {i > 0 && ', '}
          {p.handle
            ? <Link to={profilePath(p.handle)} onClick={e => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}>{p.text}</Link>
            : p.text}
          {p.role ? ` (${p.role})` : ''}
        </span>
      ))}
    </p>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { api, type CreatorCard } from '../lib/api';
import { CreatorCardView } from './creators/CreatorParts';

// Homepage strip of admin-featured creators. It renders NOTHING until the API
// returns at least one — no placeholder people, no empty heading. The server
// only returns public, active, admin-featured profiles, in admin-set order.

const SHOWN = 4;

export function FeaturedCreators() {
  const [creators, setCreators] = useState<CreatorCard[]>([]);
  useEffect(() => {
    let live = true;
    api.creators.featured().then(r => { if (live) setCreators(r.creators.slice(0, SHOWN)); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (creators.length === 0) return null;
  return (
    <section aria-labelledby="home-featured-creators" style={{ background: 'var(--color-canvas)', padding: '96px 0' }}>
      <div className="page-container">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 40 }}>
          <div>
            <h2 id="home-featured-creators" className="type-display-lg" style={{ margin: '0 0 12px' }}>
              Featured <span style={{ color: 'var(--color-ink-muted)' }}>Creators</span>
            </h2>
            <p className="type-body-lg" style={{ margin: 0 }}>Members the club is proud to put in the spotlight</p>
          </div>
          <Link to="/creators" className="btn-translucent touch-target">All creators <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
          {creators.map(c => <CreatorCardView key={c.handle} creator={c} />)}
        </div>
      </div>
    </section>
  );
}

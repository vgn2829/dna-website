import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Calendar, MapPin, Clock, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAppData } from '../context/AppDataContext';
import { getStatus, parseEventDate } from '../pages/EventsPage';

export function EventSpotlight() {
  const navigate = useNavigate();
  const { events } = useAppData();

  const nextEvent = useMemo(() => {
    return events
      .filter(e => getStatus(e.date) !== 'past')
      .sort((a, b) => parseEventDate(a.date) - parseEventDate(b.date))[0] ?? null;
  }, [events]);

  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });

  useEffect(() => {
    if (!nextEvent) return;
    const target = parseEventDate(nextEvent.date);
    const tick = () => {
      const dist = target - Date.now();
      if (dist > 0) setT({
        d: Math.floor(dist / 86400000),
        h: Math.floor((dist % 86400000) / 3600000),
        m: Math.floor((dist % 3600000)  / 60000),
        s: Math.floor((dist % 60000)    / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextEvent]);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <section style={{ background: 'var(--color-canvas)', padding: '96px 0' }}>
      <div className="page-container">

        {/* Canvas-mounted section label */}
        <motion.div
          style={{ marginBottom: 40 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="type-display-lg">
            Upcoming <span style={{ color: 'var(--color-ink-muted)' }}>Events</span>
          </h2>
        </motion.div>

        {/* ── Magenta gradient spotlight card (atmosphere device) ── */}
        <motion.div
          className="spotlight spotlight-magenta"
          style={{ position: 'relative' }}
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Bloom */}
          <div style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', filter: 'blur(40px)', pointerEvents: 'none' }} />

          {nextEvent ? (
            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', gap: 40, alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ flex: '1 1 320px' }}>
                {/* Live badge */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(4px)', padding: '4px 12px', borderRadius: 'var(--radius-pill)', marginBottom: 20 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3ecf5f', boxShadow: '0 0 6px #3ecf5f' }} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500, color: '#fff', letterSpacing: '-0.12px' }}>
                    {getStatus(nextEvent.date) === 'live' ? 'Live Now' : 'Upcoming Event'}
                  </span>
                </div>

                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px, 4vw, 42px)', fontWeight: 500, letterSpacing: '-2px', lineHeight: 1.0, color: '#fff', marginBottom: 24, maxWidth: 380 }}>
                  {nextEvent.title}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
                  {[
                    [Calendar, new Date(parseEventDate(nextEvent.date)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })],
                    [Clock,    nextEvent.time],
                    [MapPin,   nextEvent.location],
                  ].map(([Icon, text], i) => {
                    const I = Icon as React.ElementType;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>
                        <I size={16} /> {text as string}
                      </div>
                    );
                  })}
                </div>

                <button
                  className="btn-primary"
                  onClick={() => navigate('/events')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  Register Now <ArrowRight size={14} />
                </button>
              </div>

              {/* Countdown */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignSelf: 'flex-end' }}>
                {[['d', 'Days'], ['h', 'Hours'], ['m', 'Mins'], ['s', 'Secs']].map(([key, label]) => (
                  <div key={key} style={{ background: 'rgba(255,255,255,0.10)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', textAlign: 'center', minWidth: 72 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-1.4px', color: '#fff', lineHeight: 1 }}>
                      {pad(t[key as keyof typeof t])}
                    </div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ position: 'relative', zIndex: 1, padding: '24px 4px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(22px, 3vw, 32px)', fontWeight: 500, letterSpacing: '-1.5px', lineHeight: 1.1, color: '#fff', marginBottom: 12 }}>
                No upcoming events right now
              </h3>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 28, maxWidth: 420 }}>
                Check back soon, or browse past events and activities.
              </p>
              <button
                className="btn-primary"
                onClick={() => navigate('/events')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                View Events <ArrowRight size={14} />
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}

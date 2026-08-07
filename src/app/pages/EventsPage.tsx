import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Clock, Users, Calendar, List, CheckCircle2, Loader2 } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { useStudent } from '../context/StudentContext';
import { api, LiveSession } from '../lib/api';
import { usePageMeta } from '../components/hooks/use-page-meta';
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS, formatEventDate, getEventStatus, parseEventStart } from '../lib/eventDate';

function useCountdown(dateStr: string, timeStr: string, startsAt?: string | null) {
  const event = { date: dateStr, time: timeStr, startsAt };
  const [diff, setDiff] = useState(() => Math.max(0, parseEventStart(event) - Date.now()));
  useEffect(() => {
    const target = parseEventStart(event);
    const tick = () => setDiff(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dateStr, timeStr, startsAt]);
  const days = Math.floor(diff / DAY_MS);
  const hrs  = Math.floor((diff % DAY_MS) / HOUR_MS);
  const mins = Math.floor((diff % HOUR_MS) / MINUTE_MS);
  const secs = Math.floor((diff % MINUTE_MS) / SECOND_MS);
  return { days, hrs, mins, secs, expired: diff === 0 };
}

function CountUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="type-headline font-mono w-10 tabular-nums">{String(value).padStart(2, '0')}</div>
      <div className="type-micro mt-0.5">{label}</div>
    </div>
  );
}

function EventCard({ event, view, delay, onRSVP, rsvpPending }: {
  event: ReturnType<typeof useAppData>['events'][number];
  view: 'grid' | 'list';
  delay: number;
  onRSVP: () => void;
  rsvpPending: boolean;
}) {
  const status = getEventStatus(event);
  const countdown = useCountdown(event.date, event.time, event.startsAt);
  const fillPct = Math.round((event.registeredCount / event.capacity) * 100);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ delay }}
      className={`card flex gap-5 transition-all ${view === 'list' ? 'flex-col md:flex-row p-5' : 'flex-col p-5'} ${status === 'past' ? 'opacity-50' : ''}`}
    >
      {/* Date badge */}
      <div
        className="shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center"
        style={{ background: status === 'live' ? 'rgba(229,72,77,0.12)' : 'var(--color-surface-2)' }}
      >
        <span
          className="type-headline leading-none"
          style={{ color: status === 'live' ? '#e5484d' : 'var(--color-ink)' }}
        >
          {formatEventDate(event.date).slice(0, 2)}
        </span>
        <span className="type-micro" style={{ color: status === 'live' ? '#e5484d' : 'var(--color-ink-muted)' }}>
          {formatEventDate(event.date).slice(3, 5)}
        </span>
      </div>

      <div className="flex-1 flex flex-col gap-3 min-w-0">
        {/* Status + title */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            {status === 'live' && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            )}
            <span
              className="type-micro"
              style={{ color: status === 'live' ? '#e5484d' : status === 'past' ? 'var(--color-ink-muted)' : 'var(--color-ink-muted)' }}
            >
              {status === 'live' ? 'LIVE' : status === 'past' ? 'Past' : 'Upcoming'}
            </span>
          </div>
          <h3 className="type-body font-semibold leading-snug" style={{ color: 'var(--color-ink)' }}>{event.title}</h3>
        </div>

        <p className="type-body line-clamp-2" style={{ color: 'var(--color-ink-muted)' }}>{event.content}</p>

        {/* Meta */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="type-micro flex items-center gap-1"><Calendar size={11} />{formatEventDate(event.date)}</span>
          <span className="type-micro flex items-center gap-1"><Clock size={11} />{event.time}</span>
          <span className="type-micro flex items-center gap-1"><MapPin size={11} />{event.location}</span>
        </div>

        {/* Capacity bar */}
        <div>
          <div className="flex justify-between type-micro mb-1.5">
            <span className="flex items-center gap-1 tabular-nums"><Users size={10} />{event.registeredCount}/{event.capacity}</span>
            <span className="tabular-nums">{event.registeredCount >= event.capacity ? 'Full' : `${event.capacity - event.registeredCount} seats left`}</span>
          </div>
          <div className="w-full h-0.5 rounded-full" style={{ background: 'var(--color-surface-2)' }}>
            <motion.div
              className="h-full w-full rounded-full"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: fillPct / 100 }}
              transition={{ duration: 1, delay: 0.2 }}
              style={{ background: fillPct > 80 ? '#e5484d' : 'var(--color-ink)', transformOrigin: 'left' }}
            />
          </div>
        </div>

        {/* Countdown */}
        {status === 'upcoming' && !countdown.expired && view === 'grid' && (
          <div className="flex gap-3 pt-1">
            <CountUnit value={countdown.days} label="d" />
            <span className="type-headline self-start mt-0.5" style={{ color: 'var(--color-surface-2)' }}>:</span>
            <CountUnit value={countdown.hrs} label="h" />
            <span className="type-headline self-start mt-0.5" style={{ color: 'var(--color-surface-2)' }}>:</span>
            <CountUnit value={countdown.mins} label="m" />
            <span className="type-headline self-start mt-0.5" style={{ color: 'var(--color-surface-2)' }}>:</span>
            <CountUnit value={countdown.secs} label="s" />
          </div>
        )}

        {/* RSVP */}
        {(status !== 'past' || event.isRegistered) && (
          <button
            onClick={onRSVP}
            disabled={rsvpPending || (event.registeredCount >= event.capacity && !event.isRegistered)}
            aria-busy={rsvpPending}
            aria-label={event.isRegistered ? `Cancel RSVP for ${event.title}` : `RSVP for ${event.title}`}
            className="mt-auto"
          >
            {event.isRegistered ? (
              <span className="btn-secondary w-full flex items-center justify-center gap-2" style={{ color: '#3ecf5f', background: 'rgba(62,207,95,0.10)' }}>
                {rsvpPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {rsvpPending ? 'Updating…' : 'Registered ✓'}
              </span>
            ) : (
              <span className="btn-primary w-full flex items-center justify-center gap-2">
                {rsvpPending && <Loader2 size={14} className="animate-spin" />} {rsvpPending ? 'Registering…' : event.registeredCount >= event.capacity ? 'Event full' : 'Register for this event'}
              </span>
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function EventsPage() {
  usePageMeta({
    title: 'Events & Workshops | DnA Club, IIT Kanpur',
    description: 'RSVP to upcoming design and animation workshops, live sessions, and club activities at IIT Kanpur.',
    path: '/events',
  });

  const { events, rsvpEvent, rsvpPendingId, loading, error } = useAppData();
  const { studentSession, openRollModal } = useStudent();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.liveSessions.getActive(studentSession?.rollNumber)
      .then(setLiveSessions)
      .catch(() => {});
  }, [studentSession?.rollNumber]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" style={{ minHeight: '100vh', background: 'var(--color-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '5rem' }}>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 14 }}>Loading events…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" style={{ minHeight: '100vh', background: 'var(--color-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, paddingTop: '5rem' }}>
        <div style={{ color: 'var(--color-ink)', fontSize: 16, fontWeight: 600 }}>Could not load events</div>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 13 }}>Please check your connection and try again.</div>
      </div>
    );
  }

  const filtered = events.filter(e => {
    if (filter === 'all') return true;
    const s = getEventStatus(e, now);
    return filter === 'upcoming' ? s !== 'past' : s === 'past';
  }).sort((a, b) => {
    const aStatus = getEventStatus(a, now);
    const bStatus = getEventStatus(b, now);
    if (filter === 'all' && aStatus !== bStatus) return aStatus === 'past' ? 1 : -1;
    return parseEventStart(a) - parseEventStart(b);
  });

  const handleRSVP = (id: string) => {
    if (!studentSession) { openRollModal(); return; }
    rsvpEvent(id);
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '5rem', paddingBottom: '5rem' }}>
      {/* Structured data: one Event block per listed event, for rich results */}
      {filtered.map(evt => (
        <script
          key={evt.id}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Event',
              name: evt.title,
              startDate: evt.startsAt ?? evt.date,
              location: {
                '@type': 'Place',
                name: evt.location,
              },
              description: evt.content,
              organizer: {
                '@type': 'Organization',
                name: 'Design and Animation Club, IIT Kanpur',
                url: 'https://www.dnaiitk.site',
              },
              eventStatus: 'https://schema.org/EventScheduled',
            }),
          }}
        />
      ))}

      <div className="page-container">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <p className="type-caption mb-3">Club Activities</p>
          <h1 className="type-display-xl" style={{ fontFamily: 'var(--font-display)' }}>
            Events &amp;<br />
            <span style={{ color: 'var(--color-ink-muted)' }}>Workshops</span>
          </h1>
          <p className="type-body mt-4 max-w-xl" style={{ color: 'var(--color-ink-muted)' }}>
            Design, animation, and creative workshops organized by the Design and Animation Club, IIT Kanpur.
          </p>
        </motion.div>

        {/* Live & Upcoming Sessions */}
        {liveSessions.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <h2 style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--color-brand)',
              fontFamily: 'var(--font-body)', marginBottom: 16,
            }}>
              Live & Upcoming Sessions
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {liveSessions.map(s => (
                <div key={s.id} style={{
                  border: s.status === 'live' ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)', padding: '16px 20px',
                  background: s.status === 'live' ? 'rgba(233,30,140,0.06)' : 'var(--color-surface)',
                  display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap',
                  alignItems: 'center', gap: 16,
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.status === 'live' && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-brand)', fontFamily: 'var(--font-body)' }}>
                          ● LIVE
                        </span>
                      )}
                      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                        {s.title}
                      </span>
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                      {s.host} ·{' '}
                      {new Date(s.scheduled_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short',
                        hour: '2-digit', minute: '2-digit', hour12: true,
                      })}
                    </span>
                    {s.description && (
                      <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                        {s.description}
                      </span>
                    )}
                  </div>

                  {s.canAccess && s.meet_link ? (
                    <a
                      href={s.meet_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        if (studentSession?.rollNumber && s.meet_link) {
                          api.liveSessions.trackJoin(s.id, studentSession.rollNumber).catch(() => {});
                        }
                      }}
                      style={{
                        flexShrink: 0, padding: '8px 18px', borderRadius: 'var(--radius-pill)',
                        background: 'var(--color-brand)', color: '#fff',
                        fontSize: 13, fontWeight: 600,
                        fontFamily: 'var(--font-body)',
                        textDecoration: 'none', whiteSpace: 'nowrap',
                      }}
                    >
                      {s.status === 'live' ? 'Join Meet' : 'View'}
                    </a>
                  ) : s.audience_group_id && s.audience_group_id !== 'all_students' ? (
                    <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
                      Team only
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="flex gap-2">
            {(['all', 'upcoming', 'past'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className="type-body-sm px-4 py-2 rounded-full capitalize transition-all"
                style={filter === f
                  ? { background: 'var(--color-inverse-canvas)', color: 'var(--color-canvas)', borderRadius: 'var(--radius-pill)' }
                  : { background: 'var(--color-surface-1)', color: 'var(--color-ink-muted)', borderRadius: 'var(--radius-pill)' }}>
                {f}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setView('grid')} className="btn-icon" aria-label="Grid view" aria-pressed={view === 'grid'}
              style={{ background: view === 'grid' ? 'var(--color-surface-2)' : 'var(--color-surface-1)' }}>
              <Calendar size={15} />
            </button>
            <button onClick={() => setView('list')} className="btn-icon" aria-label="List view" aria-pressed={view === 'list'}
              style={{ background: view === 'list' ? 'var(--color-surface-2)' : 'var(--color-surface-1)' }}>
              <List size={15} />
            </button>
          </div>
        </div>

        <h2 style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--color-ink-muted)',
          fontFamily: 'var(--font-body)', marginBottom: 16,
        }}>
          {filter === 'upcoming' ? 'Upcoming Events' : filter === 'past' ? 'Past Events' : 'All Events'}
        </h2>

        <AnimatePresence mode="popLayout">
          <motion.div layout className={view === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-4'}>
            {filtered.map((evt, i) => (
              <EventCard key={evt.id} event={evt} view={view} delay={i * 0.06} rsvpPending={rsvpPendingId === evt.id} onRSVP={() => handleRSVP(evt.id)} />
            ))}
          </motion.div>
        </AnimatePresence>

        {filtered.length === 0 && (
          <p className="text-center py-24 type-body" style={{ color: 'var(--color-ink-muted)' }}>
            {filter === 'past' ? 'No past events yet.' : filter === 'upcoming' ? 'No upcoming events right now. Check back soon.' : 'No events are scheduled yet. Check back soon.'}
          </p>
        )}
      </div>
    </div>
  );
}

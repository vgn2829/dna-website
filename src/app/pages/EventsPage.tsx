import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Clock, Users, Calendar, List, CheckCircle2 } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { useStudent } from '../context/StudentContext';

// ISO dates (YYYY-MM-DD) are parsed as UTC midnight by spec; appending T12:00
// forces local-time parsing so .getDate() returns the correct calendar day.
// Human-readable strings from old localStorage data fall through unchanged.
function parseEventDate(dateStr: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? new Date(dateStr + 'T12:00').getTime()
    : new Date(dateStr).getTime();
}

function useCountdown(dateStr: string) {
  const [diff, setDiff] = useState(() => Math.max(0, parseEventDate(dateStr) - Date.now()));
  useEffect(() => {
    const target = parseEventDate(dateStr);
    const tick = () => setDiff(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dateStr]);
  const days = Math.floor(diff / 86_400_000);
  const hrs  = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);
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

function getStatus(dateStr: string): 'upcoming' | 'live' | 'past' {
  const d = parseEventDate(dateStr);
  const now = Date.now();
  if (d < now - 7_200_000) return 'past';
  if (d < now + 3_600_000) return 'live';
  return 'upcoming';
}

function EventCard({ event, view, delay, onRSVP }: {
  event: ReturnType<typeof useAppData>['events'][number];
  view: 'grid' | 'list';
  delay: number;
  onRSVP: () => void;
}) {
  const status = getStatus(event.date);
  const countdown = useCountdown(event.date);
  const fillPct = Math.round((event.registeredCount / event.capacity) * 100);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ delay }}
      className={`card flex gap-5 transition-all ${view === 'list' ? 'flex-row p-5' : 'flex-col p-5'} ${status === 'past' ? 'opacity-50' : ''}`}
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
          {new Date(parseEventDate(event.date)).getDate().toString().padStart(2, '0')}
        </span>
        <span className="type-micro" style={{ color: status === 'live' ? '#e5484d' : 'var(--color-ink-muted)' }}>
          {new Date(parseEventDate(event.date)).toLocaleString('default', { month: 'short' })}
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
          <span className="type-micro flex items-center gap-1"><Clock size={11} />{event.time}</span>
          <span className="type-micro flex items-center gap-1"><MapPin size={11} />{event.location}</span>
        </div>

        {/* Capacity bar */}
        <div>
          <div className="flex justify-between type-micro mb-1.5">
            <span className="flex items-center gap-1 tabular-nums"><Users size={10} />{event.registeredCount}/{event.capacity}</span>
            <span className="tabular-nums">{fillPct}% full</span>
          </div>
          <div className="w-full h-0.5 rounded-full" style={{ background: 'var(--color-surface-2)' }}>
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${fillPct}%` }}
              transition={{ duration: 1, delay: 0.2 }}
              style={{ background: fillPct > 80 ? '#e5484d' : 'var(--color-ink)' }}
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
        {status !== 'past' && (
          <button
            onClick={onRSVP}
            disabled={event.registeredCount >= event.capacity && !event.isRegistered}
            className="mt-auto"
          >
            {event.isRegistered ? (
              <span className="btn-secondary w-full flex items-center justify-center gap-2" style={{ color: '#3ecf5f', background: 'rgba(62,207,95,0.10)' }}>
                <CheckCircle2 size={14} /> Reserved ✓
              </span>
            ) : (
              <span className="btn-primary w-full flex items-center justify-center gap-2">
                RSVP a Spot
              </span>
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function EventsPage() {
  const { events, rsvpEvent, loading, error } = useAppData();
  const { studentSession, openRollModal } = useStudent();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all');

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '5rem' }}>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 14 }}>Loading events…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, paddingTop: '5rem' }}>
        <div style={{ color: 'var(--color-ink)', fontSize: 16, fontWeight: 600 }}>Could not load events</div>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 13 }}>Please check your connection and try again.</div>
      </div>
    );
  }

  const filtered = events.filter(e => {
    if (filter === 'all') return true;
    const s = getStatus(e.date);
    return filter === 'upcoming' ? s !== 'past' : s === 'past';
  });

  const handleRSVP = (id: string) => {
    if (!studentSession) { openRollModal(); return; }
    rsvpEvent(id);
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '5rem', paddingBottom: '5rem' }}>
      <div className="page-container">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <p className="type-caption mb-3">Club Activities</p>
          <h1 className="type-display-xl" style={{ fontFamily: 'var(--font-display)' }}>
            Events &amp;<br />
            <span style={{ color: 'var(--color-ink-muted)' }}>Workshops</span>
          </h1>
        </motion.div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="flex gap-2">
            {(['all', 'upcoming', 'past'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className="type-body-sm px-4 py-2 rounded-full capitalize transition-all"
                style={filter === f
                  ? { background: 'var(--color-inverse-canvas)', color: 'var(--color-canvas)', borderRadius: 'var(--radius-pill)' }
                  : { background: 'var(--color-surface-1)', color: 'var(--color-ink-muted)', borderRadius: 'var(--radius-pill)' }}>
                {f}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setView('grid')} className="btn-icon"
              style={{ background: view === 'grid' ? 'var(--color-surface-2)' : 'var(--color-surface-1)' }}>
              <Calendar size={15} />
            </button>
            <button onClick={() => setView('list')} className="btn-icon"
              style={{ background: view === 'list' ? 'var(--color-surface-2)' : 'var(--color-surface-1)' }}>
              <List size={15} />
            </button>
          </div>
        </div>

        <AnimatePresence mode="popLayout">
          <motion.div layout className={view === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-4'}>
            {filtered.map((evt, i) => (
              <EventCard key={evt.id} event={evt} view={view} delay={i * 0.06} onRSVP={() => handleRSVP(evt.id)} />
            ))}
          </motion.div>
        </AnimatePresence>

        {filtered.length === 0 && (
          <p className="text-center py-24 type-body" style={{ color: 'var(--color-ink-muted)' }}>
            No events in this category.
          </p>
        )}
      </div>
    </div>
  );
}

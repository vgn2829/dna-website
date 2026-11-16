import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Calendar, MapPin, Clock, ArrowRight, CheckCircle2, Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAppData } from '../context/AppDataContext';
import { useStudent } from '../context/StudentContext';
import { formatEventDate, getEventStatus, parseEventStart, SECOND_MS } from '../lib/eventDate';
import { eventCardActions, rsvpButtonState } from '../lib/eventForm';

// Home's "Upcoming Events" spotlight. Its actions follow the Events page
// card exactly — same decisions (eventCardActions / rsvpButtonState), same
// AppDataContext handlers, pending state and toasts — styled for this card:
//   - Register Now (primary): RSVPs through rsvpEvent (sign-in first if
//     needed); a form event opens its form once registered. Registered
//     events show Registered ✓ (the toggle that cancels, as on Events) or,
//     for a form event, the form action plus the compact Cancel
//     registration control (cancelRegistration).
//   - The problem statement, when the event has one: the same link as on
//     Events — the server's URL in a new tab, which the browser shows (PDF,
//     images) or downloads (DOCX/PPTX/ZIP). Viewable before registering.

export function EventSpotlight() {
  const navigate = useNavigate();
  const { events, rsvpEvent, cancelRegistration, rsvpPendingId } = useAppData();
  const { studentSession, openRollModal } = useStudent();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(id);
  }, []);

  const nextEvent = useMemo(() => {
    return events
      .filter(e => getEventStatus(e, now) !== 'past')
      .sort((a, b) => parseEventStart(a) - parseEventStart(b))[0] ?? null;
  }, [events, now]);

  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const nextStatus = nextEvent ? getEventStatus(nextEvent, now) : null;

  useEffect(() => {
    if (!nextEvent) return;
    const target = parseEventStart(nextEvent);
    const tick = () => {
      const dist = target - Date.now();
      if (dist > 0) setT({
        d: Math.floor(dist / 86400000),
        h: Math.floor((dist % 86400000) / 3600000),
        m: Math.floor((dist % 3600000)  / 60000),
        s: Math.floor((dist % 60000)    / 1000),
      });
      else setT({ d: 0, h: 0, m: 0, s: 0 });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextEvent]);

  const pad = (n: number) => String(n).padStart(2, '0');

  const actions = nextEvent ? eventCardActions(nextEvent, nextStatus === 'past') : null;
  const pending = !!nextEvent && rsvpPendingId === nextEvent.id;
  const rsvp = nextEvent ? rsvpButtonState(nextEvent, pending) : null;
  const handleRSVP = (id: string) => {
    if (!studentSession) { openRollModal(); return; }
    rsvpEvent(id);
  };

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
                {/* Live badge (+ Place reserved for a registered form event,
                    as its own pill so the row wraps cleanly on narrow cards) */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(4px)', padding: '4px 12px', borderRadius: 'var(--radius-pill)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3ecf5f', boxShadow: '0 0 6px #3ecf5f' }} />
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500, color: '#fff', letterSpacing: '-0.12px', whiteSpace: 'nowrap' }}>
                      {nextStatus === 'live' ? 'Live Now' : 'Upcoming Event'}
                    </span>
                  </div>
                  {actions?.showCancel && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.12)', padding: '4px 12px', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap' }}>
                      <CheckCircle2 size={12} aria-hidden="true" style={{ color: '#3ecf5f' }} /> Place reserved
                    </span>
                  )}
                </div>

                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(26px, 4vw, 42px)', fontWeight: 500, letterSpacing: '-2px', lineHeight: 1.0, color: '#fff', marginBottom: 24, maxWidth: 380 }}>
                  {nextEvent.title}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
                  {[
                    [Calendar, formatEventDate(nextEvent.date)],
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

                {/* Actions: the primary registration action first, then the
                    problem statement (when there is one), then Cancel
                    registration (registered form events). They wrap onto
                    new lines on narrow screens; nothing renders for an
                    attachment the event doesn't have. */}
                {actions && rsvp && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    {actions.primary === 'form' && actions.formUrl ? (
                      <a
                        href={actions.formUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${actions.formLabel} for ${nextEvent.title} (opens Google Forms)`}
                        className="btn-primary"
                      >
                        {actions.formLabel} <ExternalLink size={14} aria-hidden="true" />
                      </a>
                    ) : actions.primary === 'rsvp' && (
                      <button
                        type="button"
                        onClick={() => handleRSVP(nextEvent.id)}
                        disabled={rsvp.disabled}
                        aria-busy={pending}
                        aria-label={rsvp.registered ? `Cancel RSVP for ${nextEvent.title}` : `RSVP for ${nextEvent.title}`}
                        className={rsvp.registered ? 'btn-secondary' : 'btn-primary'}
                        // The Events page's green registered state, with white
                        // text so it stays readable on the magenta card.
                        style={rsvp.registered ? { color: '#fff', background: 'rgba(62,207,95,0.22)', border: '1px solid rgba(62,207,95,0.55)' } : undefined}
                      >
                        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                          : rsvp.registered ? <CheckCircle2 size={14} aria-hidden="true" style={{ color: '#3ecf5f' }} /> : null}
                        {rsvp.label ?? 'Register Now'}
                        {!rsvp.registered && !rsvp.label && <ArrowRight size={14} aria-hidden="true" />}
                      </button>
                    )}
                    {actions.attachment && (
                      <a
                        href={actions.attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${actions.attachment.name} · ${actions.attachment.meta}`}
                        aria-label={`${actions.attachment.label} for ${nextEvent.title}: ${actions.attachment.name}, ${actions.attachment.meta}${actions.attachment.opensInBrowser ? ' (opens in a new tab)' : ''}`}
                        className="btn-translucent btn-on-spotlight"
                      >
                        {actions.attachment.opensInBrowser ? <FileText size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                        {actions.attachment.label}
                      </a>
                    )}
                    {actions.showCancel && (
                      <button
                        type="button"
                        onClick={() => cancelRegistration(nextEvent.id)}
                        disabled={pending}
                        aria-busy={pending}
                        aria-label={`Cancel registration for ${nextEvent.title}`}
                        className="btn-translucent btn-on-spotlight btn-sm touch-target"
                      >
                        {pending ? 'Updating…' : 'Cancel registration'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Countdown */}
              {nextStatus === 'upcoming' && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignSelf: 'flex-end' }}>
                {[['d', 'Days'], ['h', 'Hours'], ['m', 'Mins'], ['s', 'Secs']].map(([key, label]) => (
                  <div key={key} style={{ background: 'rgba(255,255,255,0.10)', borderRadius: 'var(--radius-lg)', padding: '14px 18px', textAlign: 'center', minWidth: 72 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 500, letterSpacing: '-1.4px', color: '#fff', lineHeight: 1 }}>
                      {pad(t[key as keyof typeof t])}
                    </div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{label}</div>
                  </div>
                ))}
              </div>}
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

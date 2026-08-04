import { useEffect, useRef, useState } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';
import { Users, Award, Palette, Calendar } from 'lucide-react';
import { api } from '../lib/api';

function Counter({ target }: { target: number }) {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const sp = useSpring(0, { duration: 1800 });
  const display = useTransform(sp, v => Math.floor(v));
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVis(true); }, { threshold: 0.5 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (vis) sp.set(target); }, [vis, target, sp]);
  return <span ref={ref}><motion.span>{display}</motion.span></span>;
}

// Active Members rounds down to the nearest round increment so it reads
// consistently with its still-hardcoded "50+"/"500+"/"30+" siblings instead of
// showing an exact, oddly-specific figure (e.g. "247+") next to them.
function roundDownForDisplay(n: number): number {
  if (n >= 500) return Math.floor(n / 100) * 100;
  if (n >= 100) return Math.floor(n / 50) * 50;
  if (n >= 10)  return Math.floor(n / 10) * 10;
  return n;
}

const FALLBACK_MEMBERS = 250;

const STATIC_STATS = [
  { Icon: Award,    label: 'Workshops Conducted', value: 50  },
  { Icon: Palette,  label: 'Artworks Created',    value: 500 },
  { Icon: Calendar, label: 'Events This Year',    value: 30  },
];

export function Stats() {
  const [memberCount, setMemberCount] = useState(FALLBACK_MEMBERS);

  useEffect(() => {
    let cancelled = false;
    api.students.getCount()
      .then(({ total }) => { if (!cancelled && total > 0) setMemberCount(roundDownForDisplay(total)); })
      .catch(err => console.error('Failed to load member count:', err));
    return () => { cancelled = true; };
  }, []);

  const STATS = [
    { Icon: Users, label: 'Active Members', value: memberCount },
    ...STATIC_STATS,
  ];

  return (
    <section style={{ background: 'var(--color-canvas)', padding: '0 0 96px' }}>
      <div className="page-container">
        {/* 4-up card grid — surface-1 lift, no chromatic fill */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {STATS.map(({ Icon, label, value }, i) => (
            <motion.div
              key={label}
              className="card"
              style={{ padding: '28px 24px', textAlign: 'center' }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ delay: i * 0.07, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Icon in surface-2 circle */}
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 'var(--radius-full)', background: 'var(--color-surface-2)', marginBottom: 20 }}>
                <Icon size={18} style={{ color: 'var(--color-ink)' }} />
              </div>

              {/* Animated number — display-lg tracking */}
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 500, letterSpacing: '-2.4px', lineHeight: 1, color: 'var(--color-ink)', marginBottom: 8 }}>
                <Counter target={value} />+
              </div>

              <p className="type-caption">{label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

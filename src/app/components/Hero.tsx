import { useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useStudent } from '../context/StudentContext';
import { PixelTrail } from './ui/pixel-trail';
import { useScreenSize } from './hooks/use-screen-size';

export function Hero() {
  const navigate = useNavigate();
  const { openRollModal, studentSession } = useStudent();
  const screenSize = useScreenSize();

  const pixelSize = screenSize.lessThan('md') ? 48 : 64;

  // Forward mouse coordinates from the section to the PixelTrail layer.
  // The trail container is pointer-events:none so it never blocks clicks;
  // we manually trigger pixel animations by element ID instead.
  const trailContainerRef = useRef<HTMLDivElement>(null);
  const handleSectionMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!trailContainerRef.current) return;
      const rect = trailContainerRef.current.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / pixelSize);
      const y = Math.floor((e.clientY - rect.top)  / pixelSize);
      // PixelTrail IDs are `{trailId}-pixel-{col}-{row}` — we query by
      // the container's first matching child to find the right trail ID prefix.
      const firstPixel = trailContainerRef.current.querySelector('[id*="-pixel-0-0"]');
      if (!firstPixel) return;
      const prefix = firstPixel.id.replace('-pixel-0-0', '');
      const el = document.getElementById(`${prefix}-pixel-${x}-${y}`);
      if (el) {
        const animate = (el as unknown as { __animatePixel?: () => void }).__animatePixel;
        if (animate) animate();
      }
    },
    [pixelSize],
  );

  return (
    <section
      id="home"
      onMouseMove={handleSectionMouseMove}
      style={{
        background: 'var(--color-canvas)',
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '112px 24px 96px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* PixelTrail — pointer-events:none so CTA buttons below it stay clickable.
          The section's onMouseMove forwards coordinates by ID lookup instead. */}
      <div ref={trailContainerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <PixelTrail
          pixelSize={pixelSize}
          fadeDuration={600}
          delay={100}
          pixelClassName="rounded-full bg-white/20"
        />
      </div>

      {/* ── Eyebrow ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ marginBottom: 32, position: 'relative', zIndex: 10 }}
      >
        <span className="eyebrow">
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--color-success)',
            display: 'inline-block', flexShrink: 0,
          }} />
          IIT Kanpur · Design &amp; Animation Club
        </span>
      </motion.div>

      {/* ── Display-xxl headline ── */}
      <motion.h1
        className="type-display-xxl"
        style={{ maxWidth: 900, position: 'relative', zIndex: 10 }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      >
        Design and<br />
        Animation<br />
        <span style={{ color: 'var(--color-ink-muted)' }}>Club.</span>
      </motion.h1>

      {/* ── Body-lg subhead ── */}
      <motion.p
        className="type-body-lg"
        style={{ maxWidth: 520, marginTop: 24, position: 'relative', zIndex: 10 }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        IIT Kanpur's creative community for UI/UX, motion design,
        3D artistry, and visual storytelling.
      </motion.p>

      {/* ── CTAs ── */}
      <motion.div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, marginTop: 40, flexWrap: 'wrap',
          position: 'relative', zIndex: 10,
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.38, ease: [0.16, 1, 0.3, 1] }}
      >
        <button
          className="btn-primary"
          onClick={() => studentSession ? navigate('/events') : openRollModal()}
        >
          {studentSession ? 'Explore Events' : 'Join the Club'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => navigate('/gallery')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          View Gallery <ArrowRight size={14} />
        </button>
      </motion.div>

      {/* ── Violet gradient spotlight card ── */}
      <motion.div
        className="spotlight spotlight-violet"
        style={{
          marginTop: 80,
          width: '100%',
          maxWidth: 960,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 32,
          position: 'relative',
          zIndex: 10,
        }}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Bloom orbs */}
        <div style={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', filter: 'blur(48px)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -40, left: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', filter: 'blur(32px)', pointerEvents: 'none' }} />

        <p style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(22px, 3vw, 36px)',
          fontWeight: 500,
          letterSpacing: '-1.5px',
          lineHeight: 1.05,
          color: '#fff',
          maxWidth: 400,
          textAlign: 'left',
          position: 'relative', zIndex: 1,
        }}>
          Where creativity meets technology at IIT Kanpur
        </p>

        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
          {[
            { value: '250+', label: 'Members' },
            { value: '50+',  label: 'Workshops' },
            { value: '500+', label: 'Artworks' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div className="tabular-nums" style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 500, letterSpacing: '-1.5px', color: '#fff', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

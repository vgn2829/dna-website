import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

export function Mission() {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVis(true); }, { threshold: 0.25 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  const lines = [
    'We are a community of creative minds at IIT Kanpur,',
    'passionate about design, animation, and visual storytelling.',
    'From UI/UX to 3D animation, from Photoshop to Blender,',
    'we empower students to master the art of digital creation.',
    'Join us on a journey where imagination meets innovation.',
  ];

  return (
    <section
      id="mission"
      ref={ref}
      style={{ background: 'var(--color-canvas)', padding: '96px 24px' }}
    >
      <div style={{ maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
        <motion.h2
          className="type-display-xl"
          style={{ marginBottom: 64 }}
          initial={{ opacity: 0, y: 32 }}
          animate={vis ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          Our{' '}
          <span style={{ color: 'var(--color-ink-muted)' }}>Mission</span>
        </motion.h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {lines.map((line, i) => (
            <motion.p
              key={i}
              className="type-subhead"
              initial={{ opacity: 0, y: 24 }}
              animate={vis ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.08 + 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              {line}
            </motion.p>
          ))}
        </div>
      </div>
    </section>
  );
}

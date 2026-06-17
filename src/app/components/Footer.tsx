import { motion } from 'motion/react';
import { Instagram, Linkedin, Mail, Youtube } from 'lucide-react';
import { useNavigate } from 'react-router';

const COLS = [
  {
    heading: 'Explore',
    links: [
      { label: 'Academy', path: '/academy' },
      { label: 'Gallery', path: '/gallery' },
      { label: 'Events', path: '/events' },
      { label: 'Resources', path: '/resources' },
      { label: 'Team', path: '/team' },
    ],
  },
  {
    heading: 'Club',
    links: [
      { label: 'About DnA', path: '/' },
      { label: 'Admin', path: '/admin' },
      { label: 'Join Us', path: '/events' },
    ],
  },
];

const SOCIAL = [
  { icon: Instagram, href: 'https://www.instagram.com/dnaiitk/', label: 'Instagram' },
  { icon: Linkedin,  href: '#', label: 'LinkedIn' },
  { icon: Youtube,   href: '#', label: 'YouTube' },
  { icon: Mail,      href: '#', label: 'Email' },
];

export function Footer() {
  const navigate = useNavigate();

  return (
    <footer
      className="px-6 pt-16 pb-10"
      style={{
        background: 'var(--color-canvas)',
        borderTop: '1px solid var(--color-hairline-soft)',
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-14">

          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <p
              className="text-base font-semibold mb-3"
              style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.5px', color: 'var(--color-ink)' }}
            >
              IITK DnA
            </p>
            <p className="type-caption mb-6" style={{ maxWidth: 200 }}>
              IIT Kanpur's community for digital and animation
            </p>
            <div className="flex gap-2">
              {SOCIAL.map(s => {
                const Icon = s.icon;
                return (
                  <motion.a
                    key={s.label}
                    href={s.href}
                    whileHover={{ y: -2 }}
                    className="btn-icon"
                    aria-label={s.label}
                  >
                    <Icon size={15} />
                  </motion.a>
                );
              })}
            </div>
          </div>

          {/* Link columns */}
          {COLS.map(col => (
            <div key={col.heading}>
              <p
                className="type-caption mb-4"
                style={{ color: 'var(--color-ink)', letterSpacing: '-0.13px' }}
              >
                {col.heading}
              </p>
              <ul className="space-y-2.5">
                {col.links.map(link => (
                  <li key={link.label}>
                    <button
                      onClick={() => navigate(link.path)}
                      className="type-caption hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--color-ink-muted)', opacity: 0.8 }}
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Contact column */}
          <div>
            <p
              className="type-caption mb-4"
              style={{ color: 'var(--color-ink)', letterSpacing: '-0.13px' }}
            >
              Contact
            </p>
            <ul className="space-y-2.5">
              <li>
                <a href="mailto:designandanimationclub.iitk@gmail.com" className="type-caption" style={{ color: 'var(--color-accent-blue)' }}>
                  designandanimationclub.iitk@gmail.com
                </a>
              </li>
              <li>
                <p className="type-caption">Room No. 210, Indian Institute of Technology Kanpur, Kalyanpur, Kanpur, Uttar Pradesh 208016</p>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom row */}
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8"
          style={{ borderTop: '1px solid var(--color-hairline-soft)' }}
        >
          <p className="type-micro">
            © 2026 Design &amp; Animation Club, IIT Kanpur.
          </p>
          <p className="type-micro">All rights reserved.</p>
        </div>

        {/* Designer credit */}
        <div style={{
          borderTop: '1px solid var(--color-hairline)',
          marginTop: 32,
          paddingTop: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', letterSpacing: '0.02em' }}>
            Built with ♥ for DnA Club IITK
          </p>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)', letterSpacing: '-0.1px' }}>
            Designed &amp; Developed by Venugopal
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
            <a
              href="https://www.instagram.com/venugopal29_/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Venugopal on Instagram"
              style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--color-ink-muted)', textDecoration: 'none', fontSize: 12, transition: 'color 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#E1306C')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-ink-muted)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                <circle cx="12" cy="12" r="4"/>
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
              </svg>
              @venugopal29_
            </a>
            <span style={{ color: 'var(--color-hairline)', fontSize: 14 }}>·</span>
            <a
              href="https://www.linkedin.com/in/venugopal29/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Venugopal on LinkedIn"
              style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--color-ink-muted)', textDecoration: 'none', fontSize: 12, transition: 'color 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#0A66C2')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-ink-muted)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
                <rect x="2" y="9" width="4" height="12"/>
                <circle cx="4" cy="4" r="2"/>
              </svg>
              venugopal29
            </a>
            <span style={{ color: 'var(--color-hairline)', fontSize: 14 }}>·</span>
            <a
              href="tel:+917019080178"
              aria-label="Call Venugopal"
              style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--color-ink-muted)', textDecoration: 'none', fontSize: 12, transition: 'color 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ink)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-ink-muted)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.56 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              +91 70190 80178
            </a>
          </div>
          <p style={{ fontSize: 11, color: 'var(--color-ink-muted)', opacity: 0.6, marginTop: 4, fontFamily: 'var(--font-body)' }}>
            © {new Date().getFullYear()} Design &amp; Animation Club, IIT Kanpur
          </p>
        </div>
      </div>
    </footer>
  );
}

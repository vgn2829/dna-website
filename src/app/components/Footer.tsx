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
      <div className="max-w-6xl mx-auto">
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
      </div>
    </footer>
  );
}

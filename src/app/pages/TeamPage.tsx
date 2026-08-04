import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Instagram, Linkedin, Mail, Users, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react';
import { useAppData, type TeamMember } from '../context/AppDataContext';
import { usePageMeta } from '../components/hooks/use-page-meta';

function MemberCard({ member, expanded = false, onToggle, size = 'normal' }: {
  member: TeamMember; large?: boolean; expanded?: boolean; onToggle?: () => void; size?: 'normal' | 'small';
}) {
  const isSmall = size === 'small';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -4 }}
      onClick={onToggle}
      style={{
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-hairline)',
        cursor: 'pointer',
      }}
    >
      {/* Photo area */}
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '3 / 4',
        overflow: 'hidden',
        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
        background: `${member.color}20`,
      }}>
        {member.photoUrl ? (
          <img
            src={member.photoUrl}
            alt={member.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center top',
              display: 'block',
            }}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{
              fontSize: 64,
              fontWeight: 800,
              color: member.color,
              fontFamily: 'var(--font-display)',
              opacity: 0.6,
            }}>
              {member.name[0]}
            </span>
          </div>
        )}
      </div>

      {/* Info area */}
      <div style={{ padding: isSmall ? '12px 14px 14px' : '16px 20px 20px', background: 'var(--color-surface-1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 className={isSmall ? 'type-body-sm' : 'type-headline'} style={{ fontSize: isSmall ? 14 : 18 }}>{member.name}</h3>
          {onToggle && (
            <div style={{ color: 'var(--color-ink-muted)', flexShrink: 0 }}>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          )}
        </div>
        <p className="type-body-sm" style={{ color: member.color, fontWeight: 600, marginBottom: 2 }}>
          {member.designation}
        </p>
        {member.year && (
          <p className="type-caption" style={{ color: 'var(--color-ink-muted)' }}>{member.year}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {member.social.instagram && (
            <motion.a href={member.social.instagram} whileHover={{ scale: 1.15, y: -2 }} onClick={e => e.stopPropagation()} className="btn-icon" style={{ width: 32, height: 32 }} aria-label="Instagram">
              <Instagram size={14} />
            </motion.a>
          )}
          {member.social.linkedin && (
            <motion.a href={member.social.linkedin} whileHover={{ scale: 1.15, y: -2 }} onClick={e => e.stopPropagation()} className="btn-icon" style={{ width: 32, height: 32 }} aria-label="LinkedIn">
              <Linkedin size={14} />
            </motion.a>
          )}
          {member.social.email && (
            <motion.a href={`mailto:${member.social.email}`} whileHover={{ scale: 1.15, y: -2 }} onClick={e => e.stopPropagation()} className="btn-icon" style={{ width: 32, height: 32 }} aria-label="Email">
              <Mail size={14} />
            </motion.a>
          )}
        </div>
      </div>

      {/* Bio — expands below info on toggle */}
      <AnimatePresence>
        {expanded && member.bio && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '12px 20px 20px', borderTop: '1px solid var(--color-hairline)' }}>
              <p className="type-body-sm" style={{ color: 'var(--color-ink-muted)' }}>{member.bio}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function TeamPage() {
  usePageMeta({
    title: 'Meet Our Team | DnA Club, IIT Kanpur',
    description: 'A passionate group of designers, animators, and creative thinkers dedicated to building a vibrant design culture at IIT Kanpur.',
    path: '/team',
  });

  const { team, loading } = useAppData();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id);

  const [cols, setCols] = useState({ coord: 4, secy: 5, excore: 4 });
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 640) setCols({ coord: 1, secy: 2, excore: 1 });
      else if (w < 1024) setCols({ coord: 3, secy: 4, excore: 3 });
      else setCols({ coord: 4, secy: 5, excore: 4 });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const sortByOrder = (members: TeamMember[]) =>
    [...members].sort((a, b) => {
      const ao = a.displayOrder ?? 999, bo = b.displayOrder ?? 999;
      return ao !== bo ? ao - bo : a.name.trim().localeCompare(b.name.trim());
    });

  const d = (m: TeamMember) => m.designation.toLowerCase();
  const isExCore = (m: TeamMember) => d(m).startsWith('ex-');
  const faculty = team.filter(m => d(m).includes('faculty') || d(m).includes('advisor'));
  const exCoreMembers = team.filter(m => isExCore(m));
  const coords  = sortByOrder(team.filter(m => !isExCore(m) && d(m).includes('coordinator')));
  const secs    = sortByOrder(team.filter(m => !isExCore(m) && d(m).includes('secretary')));
  const rest    = sortByOrder(team.filter(m => !isExCore(m) && !d(m).includes('coordinator') && !d(m).includes('secretary') && !d(m).includes('faculty') && !d(m).includes('advisor')));

  const exCoreByYear = Object.entries(
    exCoreMembers.reduce((acc, m) => {
      const yr = m.year || 'Unknown';
      if (!acc[yr]) acc[yr] = [];
      acc[yr].push(m);
      return acc;
    }, {} as Record<string, typeof exCoreMembers>)
  )
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, members]) => ({ year, members }));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-canvas)' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-ink-muted)' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen py-16">
      <div className="page-container">
        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-6">
            <Users size={16} className="text-cyan-400" />
            <span className="text-sm font-medium" style={{ color: 'var(--color-ink-muted)' }}>The People Behind DnA</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-5">Meet Our <span className="gradient-text">Team</span></h1>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--color-ink-muted)' }}>A passionate group of designers, animators, and creative thinkers dedicated to building a vibrant design culture at IIT Kanpur.</p>
        </motion.div>

        {faculty.length > 0 && (
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-8"><Sparkles size={18} className="text-yellow-400" /><h2 className="text-2xl font-bold">Faculty / Advisors</h2></div>
            <div className="max-w-sm"><MemberCard member={faculty[0]} large expanded={expandedId === `m-${faculty[0].id}`} onToggle={() => toggle(`m-${faculty[0].id}`)} /></div>
          </div>
        )}

        {coords.length > 0 && (
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-8"><div className="w-2 h-2 rounded-full bg-blue-400" /><h2 className="text-2xl font-bold">Coordinators</h2></div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.coord}, 1fr)`, gap: 16 }}>
              {coords.map(m => <MemberCard key={m.id} member={m} large expanded={expandedId === `m-${m.id}`} onToggle={() => toggle(`m-${m.id}`)} />)}
            </div>
          </div>
        )}

        {secs.length > 0 && (
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-8"><div className="w-2 h-2 rounded-full bg-purple-400" /><h2 className="text-2xl font-bold">Secretaries</h2></div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.secy}, 1fr)`, gap: 12 }}>
              {secs.map(m => <MemberCard key={m.id} member={m} size="small" expanded={expandedId === `m-${m.id}`} onToggle={() => toggle(`m-${m.id}`)} />)}
            </div>
          </div>
        )}

        {rest.length > 0 && (
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-8"><div className="w-2 h-2 rounded-full bg-pink-400" /><h2 className="text-2xl font-bold">Design Team</h2></div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {rest.map(m => <MemberCard key={m.id} member={m} expanded={expandedId === `m-${m.id}`} onToggle={() => toggle(`m-${m.id}`)} />)}
            </div>
          </div>
        )}

        {exCoreByYear.length > 0 && (
          <section style={{ marginTop: 64 }}>
            <h2 className="type-display-lg" style={{ marginBottom: 8 }}>Ex-Core</h2>
            <p className="type-body" style={{ color: 'var(--color-ink-muted)', marginBottom: 48 }}>
              Alumni who led DnA Club in previous years
            </p>
            {exCoreByYear.map(({ year, members }) => (
              <div key={year} style={{ marginBottom: 48 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
                    textTransform: 'uppercase' as const,
                    color: 'var(--color-ink-muted)', whiteSpace: 'nowrap' as const,
                  }}>
                    {year}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--color-hairline)' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.excore}, 1fr)`, gap: 16 }}>
                  {members.map(m => (
                    <MemberCard
                      key={m.id}
                      member={m}
                      size="normal"
                      expanded={expandedId === `m-${m.id}`}
                      onToggle={() => toggle(`m-${m.id}`)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="glass-strong rounded-3xl p-10 text-center"
          style={{ background: 'linear-gradient(135deg, rgba(0,122,255,0.08), rgba(191,90,242,0.08))' }}>
          <h3 className="text-2xl font-bold mb-3">Want to join the team?</h3>
          <p className="mb-6 max-w-md mx-auto" style={{ color: 'var(--color-ink-muted)' }}>We recruit each semester. If you are passionate about design or animation, we would love to have you.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <button className="px-6 py-3 rounded-2xl glass glass-hover font-semibold transition-colors" style={{ color: 'var(--color-ink)' }}>Learn more</button>
            <a
              href="https://www.instagram.com/dnaiitk/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-2xl font-semibold text-black transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #007AFF, #BF5AF2)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Apply Now
            </a>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Instagram, Linkedin, Mail, Users, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react';
import { useAppData, type TeamMember } from '../context/AppDataContext';

function MemberCard({ member, expanded = false, onToggle }: {
  member: TeamMember; large?: boolean; expanded?: boolean; onToggle?: () => void;
}) {
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
        height: 260,
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
      <div style={{ padding: '16px 20px 20px', background: 'var(--color-surface-1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 className="type-headline" style={{ fontSize: 18 }}>{member.name}</h3>
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
  const { team, loading } = useAppData();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id);

  const d = (m: TeamMember) => m.designation.toLowerCase();
  const faculty = team.filter(m => d(m).includes('faculty') || d(m).includes('advisor'));
  const coords  = team.filter(m => d(m).includes('coordinator'));
  const secs    = team.filter(m => d(m).includes('secretary'));
  const rest    = team.filter(m => !d(m).includes('coordinator') && !d(m).includes('secretary') && !d(m).includes('faculty') && !d(m).includes('advisor'));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-canvas)' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-ink-muted)' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-6">
            <Users size={16} className="text-cyan-400" />
            <span className="text-sm font-medium text-white/80">The People Behind DnA</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-5">Meet Our <span className="gradient-text">Team</span></h1>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">A passionate group of designers, animators, and creative thinkers dedicated to building a vibrant design culture at IIT Kanpur.</p>
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
            <div className="grid md:grid-cols-2 gap-8 max-w-3xl">
              {coords.map(m => <MemberCard key={m.id} member={m} large expanded={expandedId === `m-${m.id}`} onToggle={() => toggle(`m-${m.id}`)} />)}
            </div>
          </div>
        )}

        {secs.length > 0 && (
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-8"><div className="w-2 h-2 rounded-full bg-purple-400" /><h2 className="text-2xl font-bold">Secretaries</h2></div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {secs.map(m => <MemberCard key={m.id} member={m} expanded={expandedId === `m-${m.id}`} onToggle={() => toggle(`m-${m.id}`)} />)}
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

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="glass-strong rounded-3xl p-10 text-center"
          style={{ background: 'linear-gradient(135deg, rgba(0,122,255,0.08), rgba(191,90,242,0.08))' }}>
          <h3 className="text-2xl font-bold mb-3">Want to join the team?</h3>
          <p className="text-white/60 mb-6 max-w-md mx-auto">We recruit each semester. If you are passionate about design or animation, we would love to have you.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <button className="px-6 py-3 rounded-2xl glass text-white font-semibold hover:bg-white/10 transition-colors">Learn more</button>
            <button className="px-6 py-3 rounded-2xl font-semibold text-black transition-all hover:opacity-90" style={{ background: 'linear-gradient(135deg, #007AFF, #BF5AF2)' }}>Apply Now</button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Instagram, Linkedin, Mail, Users, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react';
import { useAppData, type TeamMember } from '../context/AppDataContext';

function MemberCard({ member, large = false, expanded = false, onToggle }: {
  member: TeamMember; large?: boolean; expanded?: boolean; onToggle?: () => void;
}) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      whileHover={{ y: -4 }} className="glass-strong rounded-3xl overflow-hidden group cursor-pointer" onClick={onToggle}>

      <div className={`relative overflow-hidden ${large ? 'h-56' : 'h-44'}`}
        style={{ background: `linear-gradient(135deg, ${member.color}40 0%, ${member.color}10 100%)` }}>
        <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 flex items-center justify-center">
          {member.photoUrl ? (
            <img src={member.photoUrl} alt={member.name}
              className="rounded-full object-cover shadow-xl"
              style={{ width: large ? 100 : 80, height: large ? 100 : 80, boxShadow: `0 0 40px ${member.color}40` }} />
          ) : (
            <div className="rounded-full glass flex items-center justify-center shadow-xl"
              style={{ width: large ? 100 : 80, height: large ? 100 : 80, boxShadow: `0 0 40px ${member.color}40` }}>
              <span className={`font-bold ${large ? 'text-4xl' : 'text-3xl'}`}>{member.name.charAt(0)}</span>
            </div>
          )}
        </motion.div>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: 0.1 }}>
          <div className="rounded-full border-2" style={{ width: large ? 160 : 130, height: large ? 160 : 130, borderColor: member.color }} />
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between mb-1">
          <h3 className={`font-bold group-hover:gradient-text transition-all leading-tight ${large ? 'text-xl' : 'text-lg'}`}>{member.name}</h3>
          {onToggle && <div className="text-white/40 mt-1">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>}
        </div>
        <p style={{ color: member.color }} className="text-sm font-semibold mb-0.5">{member.designation}</p>
        {member.year && <p className="text-white/40 text-xs mb-3">{member.year}</p>}

        <AnimatePresence>
          {expanded && member.bio && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
              <p className="text-white/60 text-sm leading-relaxed mb-4">{member.bio}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2 mt-2">
          {member.social.instagram && (
            <motion.a href={member.social.instagram} whileHover={{ scale: 1.15, y: -2 }} onClick={e => e.stopPropagation()} className="w-9 h-9 glass-hover rounded-full flex items-center justify-center">
              <Instagram size={15} />
            </motion.a>
          )}
          {member.social.linkedin && (
            <motion.a href={member.social.linkedin} whileHover={{ scale: 1.15, y: -2 }} onClick={e => e.stopPropagation()} className="w-9 h-9 glass-hover rounded-full flex items-center justify-center">
              <Linkedin size={15} />
            </motion.a>
          )}
          {member.social.email && (
            <motion.a href={`mailto:${member.social.email}`} whileHover={{ scale: 1.15, y: -2 }} onClick={e => e.stopPropagation()} className="w-9 h-9 glass-hover rounded-full flex items-center justify-center">
              <Mail size={15} />
            </motion.a>
          )}
        </div>
      </div>
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

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-3 gap-4 mb-16">
          {[{ value: String(team.length), label: 'Core Members' }, { value: '6', label: 'Domains Covered' }, { value: '4', label: 'Years Active' }].map(s => (
            <div key={s.label} className="glass-strong rounded-2xl p-5 text-center">
              <div className="text-3xl font-bold gradient-text mb-1">{s.value}</div>
              <div className="text-sm text-white/50">{s.label}</div>
            </div>
          ))}
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

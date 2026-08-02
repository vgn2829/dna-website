import { motion } from 'motion/react';
import { Instagram, Linkedin, Mail, Loader2 } from 'lucide-react';
import { useAppData, type TeamMember } from '../context/AppDataContext';
import { thumbUrl } from '../lib/utils';

const ACCENTS = ['#007AFF', '#BF5AF2', '#FF375F', '#FF9500', '#34C759', '#00D4FF'];

function MemberCard({ member, index, large = false }: { member: TeamMember; index: number; large?: boolean }) {
  const accent = member.color || ACCENTS[index % ACCENTS.length];
  return (
    <motion.div
      style={{
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-hairline)',
        cursor: 'pointer',
      }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -4 }}
    >
      {/* Photo area */}
      <div style={{
        position: 'relative',
        height: large ? 280 : 220,
        overflow: 'hidden',
        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
        background: `${accent}20`,
      }}>
        {member.photoUrl ? (
          <img
            src={thumbUrl(member.photoUrl)}
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
              color: accent,
              fontFamily: 'var(--font-display)',
              opacity: 0.6,
            }}>
              {member.name[0]}
            </span>
          </div>
        )}
      </div>

      {/* Info area */}
      <div style={{ padding: '20px 20px 24px', textAlign: 'center' }}>
        <h3 className="type-display-md" style={{ fontSize: large ? 22 : 18, marginBottom: 4 }}>{member.name}</h3>
        <p className="type-caption" style={{ marginBottom: 16 }}>{member.designation}</p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {member.social.instagram && (
            <a href={member.social.instagram} className="btn-icon" aria-label="Instagram"><Instagram size={15} /></a>
          )}
          {member.social.linkedin && (
            <a href={member.social.linkedin} className="btn-icon" aria-label="LinkedIn"><Linkedin size={15} /></a>
          )}
          {member.social.email && (
            <a href={`mailto:${member.social.email}`} className="btn-icon" aria-label="Email"><Mail size={15} /></a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function Team() {
  const { team, loading } = useAppData();
  const coordinators = team.filter(m => m.designation.toLowerCase().includes('coordinator'));

  if (loading) {
    return (
      <section id="team" style={{ background: 'var(--color-canvas)', padding: '96px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-ink-muted)' }} />
        </div>
      </section>
    );
  }

  return (
    <section id="team" style={{ background: 'var(--color-canvas)', padding: '96px 0' }}>
      <div className="page-container">

        <motion.div
          style={{ marginBottom: 64 }}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="type-display-lg" style={{ marginBottom: 12 }}>
            Meet Our <span style={{ color: 'var(--color-ink-muted)' }}>Team</span>
          </h2>
          <p className="type-body-lg">The creative minds driving innovation and fostering design excellence at IIT Kanpur</p>
        </motion.div>

        <div>
          <p className="type-headline" style={{ marginBottom: 24 }}>Coordinators</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {coordinators.map((m, i) => <MemberCard key={m.id} member={m} index={i} large />)}
          </div>
        </div>

        <motion.div
          style={{ marginTop: 64, textAlign: 'center' }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <a
            href="https://www.instagram.com/dnaiitk/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            Join the Club
          </a>
        </motion.div>
      </div>
    </section>
  );
}

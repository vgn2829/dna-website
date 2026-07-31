import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Video, Trophy, ArrowRight, Search, ExternalLink, Clock, Filter, X } from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { useStudent } from '../context/StudentContext';
import { usePageMeta } from '../components/hooks/use-page-meta';

const typeIcons = {
  video: Video,
  article: BookOpen,
  course: Trophy,
};

const levelColors = {
  Beginner: '#34C759',
  Intermediate: '#FF9500',
  Advanced: '#FF375F',
};

const DOMAIN_COLORS: Record<string, string> = {
  'UI/UX Design': '#007AFF', Photoshop: '#BF5AF2', Illustrator: '#FF9F0A', '3D Animation': '#FF375F',
};

function SubmitResourceModal({ onClose }: { onClose: () => void }) {
  const { domains, submitResource } = useAppData();
  const domainKeys = Object.keys(domains);

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [author, setAuthor] = useState('');
  const [domainId, setDomainId] = useState('');
  const [type, setType] = useState<'video' | 'article' | 'course'>('video');
  const [level, setLevel] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Beginner');
  const [durationLabel, setDurationLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const isValidHttpsUrl = (u: string) => {
    try { return new URL(u).protocol === 'https:'; } catch { return false; }
  };

  const canSubmit = title.trim().length > 0 && isValidHttpsUrl(url) && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await submitResource({
        title: title.trim(),
        url: url.trim(),
        author: author.trim(),
        domainId: domainId || null,
        type,
        level,
        durationLabel: durationLabel.trim(),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error && err.message !== 'SESSION_EXPIRED' ? err.message : 'Could not submit — try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="w-full max-w-md"
        style={{ background: 'var(--color-surface-1)', borderRadius: 'var(--radius-xxl)', boxShadow: 'var(--shadow-level-2)', padding: '2rem', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="type-headline mb-1">Submit a Resource</h2>
            <p className="type-caption">Shared resources are reviewed by an admin before appearing publicly.</p>
          </div>
          <button onClick={onClose} className="btn-icon" style={{ width: 32, height: 32 }}><X size={15} /></button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <p className="type-body" style={{ color: 'var(--color-ink)', marginBottom: 8 }}>Thanks — your submission is pending review.</p>
            <p className="type-caption" style={{ marginBottom: 20 }}>An admin will approve it before it appears on this page.</p>
            <button onClick={onClose} className="btn-primary">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="type-micro block mb-1">Title *</label>
              <input className="input-base" style={{ width: '100%', boxSizing: 'border-box' }} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required />
            </div>
            <div>
              <label className="type-micro block mb-1">Link (https only) *</label>
              <input className="input-base" style={{ width: '100%', boxSizing: 'border-box' }} type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} maxLength={500} required />
              {url && !isValidHttpsUrl(url) && <p style={{ fontSize: 11, color: 'var(--color-error)', margin: '4px 0 0' }}>Must be a valid https:// URL</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="type-micro block mb-1">Author / creator</label>
                <input className="input-base" style={{ width: '100%', boxSizing: 'border-box' }} value={author} onChange={e => setAuthor(e.target.value)} maxLength={100} />
              </div>
              <div>
                <label className="type-micro block mb-1">Domain</label>
                <select className="input-base" style={{ width: '100%' }} value={domainId} onChange={e => setDomainId(e.target.value)}>
                  <option value="">Uncategorized</option>
                  {domainKeys.map(id => <option key={id} value={id}>{domains[id].title}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="type-micro block mb-1">Type</label>
                <select className="input-base" style={{ width: '100%' }} value={type} onChange={e => setType(e.target.value as typeof type)}>
                  <option value="video">Video</option>
                  <option value="article">Article</option>
                  <option value="course">Course</option>
                </select>
              </div>
              <div>
                <label className="type-micro block mb-1">Level</label>
                <select className="input-base" style={{ width: '100%' }} value={level} onChange={e => setLevel(e.target.value as typeof level)}>
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                </select>
              </div>
            </div>
            <div>
              <label className="type-micro block mb-1">Duration (optional)</label>
              <input className="input-base" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="e.g. 1h 10m" value={durationLabel} onChange={e => setDurationLabel(e.target.value)} maxLength={50} />
            </div>

            {error && <p style={{ fontSize: 12, color: 'var(--color-error)', margin: 0 }}>{error}</p>}

            <button type="submit" disabled={!canSubmit} className="btn-primary w-full justify-center" style={{ opacity: canSubmit ? 1 : 0.5 }}>
              {submitting ? 'Submitting…' : 'Submit for review'}
            </button>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
}

export function ResourcesPage() {
  usePageMeta({
    title: 'Learning Resources | DnA Club, IIT Kanpur',
    description: 'Curated tutorials, courses & guides to help you master design and animation — hand-picked by DnA Club members.',
    path: '/resources',
  });

  const { resources, loading, error } = useAppData();
  const { studentSession, openRollModal } = useStudent();
  const [selectedDomain, setSelectedDomain] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const domainTitles = ['All', ...new Set(resources.map(r => r.domainTitle).filter((d): d is string => Boolean(d)))];

  const filtered = resources.filter((r) => {
    const domainMatch = selectedDomain === 'All' || r.domainTitle === selectedDomain;
    const typeMatch = selectedType === 'All' || r.type === selectedType;
    const searchMatch =
      !searchQuery ||
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return domainMatch && typeMatch && searchMatch;
  });

  const handleSubmitClick = () => {
    if (!studentSession) { openRollModal(); return; }
    setShowSubmitModal(true);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '6rem' }}>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 14 }}>Loading resources…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, paddingTop: '6rem' }}>
        <div style={{ color: 'var(--color-ink)', fontSize: 16, fontWeight: 600 }}>Could not load resources</div>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 13 }}>Please check your connection and try again.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="page-container">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-6">
            <BookOpen size={16} className="text-blue-400" />
            <span className="text-sm font-medium text-white/80">Learning Hub</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-5">
            Learning <span className="gradient-text">Resources</span>
          </h1>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">
            Curated tutorials, courses & guides to help you master design and animation — hand-picked by club members.
          </p>
        </motion.div>

        {/* Search & Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-strong rounded-3xl p-6 mb-10"
        >
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                placeholder="Search resources, authors, tags…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-blue-400/50 transition-colors"
              />
            </div>
            <div className="flex gap-2">
              {['All', 'video', 'article', 'course'].map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedType(t)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-all ${
                    selectedType === t
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-400/30'
                      : 'glass text-white/60 hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {domainTitles.map((domain) => (
              <button
                key={domain}
                onClick={() => setSelectedDomain(domain)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                  selectedDomain === domain
                    ? 'bg-white text-black'
                    : 'glass text-white/60 hover:text-white'
                }`}
              >
                {domain}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Results count */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold sr-only">Browse Resources</h2>
          <p className="text-white/50 text-sm">
            <span className="text-white font-semibold">{filtered.length}</span> resources found
          </p>
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <Filter size={14} />
            Filtered results
          </div>
        </div>

        {/* Resource Cards */}
        {filtered.length > 0 && (
          <AnimatePresence mode="popLayout">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((resource, index) => {
                const TypeIcon = typeIcons[resource.type];
                const color = (resource.domainTitle && DOMAIN_COLORS[resource.domainTitle]) || '#007AFF';
                return (
                  <motion.a
                    key={resource.id}
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: index * 0.05 }}
                    whileHover={{ y: -6, scale: 1.01 }}
                    className="glass-strong glass-hover rounded-3xl overflow-hidden group cursor-pointer block no-underline"
                  >
                    {/* Card top bar */}
                    <div className="h-2 w-full" style={{ background: color }} />

                    <div className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center"
                          style={{ background: `${color}22`, border: `1px solid ${color}44` }}
                        >
                          <TypeIcon size={18} style={{ color }} />
                        </div>
                        {resource.domainTitle && (
                          <span className="text-xs font-semibold text-white/60">{resource.domainTitle}</span>
                        )}
                      </div>

                      <h3 className="text-lg font-bold mb-1 group-hover:gradient-text transition-all leading-tight">
                        {resource.title}
                      </h3>
                      {resource.author && <p className="text-white/50 text-sm mb-4">by {resource.author}</p>}

                      {resource.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-5">
                          {resource.tags.map((tag) => (
                            <span key={tag} className="px-2 py-0.5 rounded-full text-xs font-medium glass" style={{ color }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3 text-white/50">
                          {resource.durationLabel && (
                            <div className="flex items-center gap-1">
                              <Clock size={12} />
                              {resource.durationLabel}
                            </div>
                          )}
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{
                              background: `${levelColors[resource.level]}22`,
                              color: levelColors[resource.level],
                              border: `1px solid ${levelColors[resource.level]}44`,
                            }}
                          >
                            {resource.level}
                          </span>
                        </div>
                        <ExternalLink size={14} className="text-white/30 group-hover:text-white/70 transition-colors" />
                      </div>
                    </div>
                  </motion.a>
                );
              })}
            </div>
          </AnimatePresence>
        )}

        {filtered.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-24"
          >
            <p className="text-white/40 text-lg">
              {resources.length === 0 ? 'No resources yet — be the first to submit one.' : 'No resources match your search.'}
            </p>
            {resources.length > 0 && (
              <button
                onClick={() => { setSearchQuery(''); setSelectedDomain('All'); setSelectedType('All'); }}
                className="mt-4 text-blue-400 hover:text-blue-300 text-sm font-semibold"
              >
                Clear filters
              </button>
            )}
          </motion.div>
        )}

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 glass-strong rounded-3xl p-10 text-center"
        >
          <h2 className="text-2xl font-bold mb-3">Have a resource to share?</h2>
          <p className="text-white/60 mb-6 max-w-md mx-auto">
            Found something amazing? Submit it to our curated library and help the community grow.
          </p>
          <button
            onClick={handleSubmitClick}
            className="inline-flex items-center gap-2 group px-6 py-3 rounded-2xl font-semibold text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #007AFF 0%, #BF5AF2 100%)' }}
          >
            Submit a Resource
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </motion.div>
      </div>

      <AnimatePresence>
        {showSubmitModal && <SubmitResourceModal onClose={() => setShowSubmitModal(false)} />}
      </AnimatePresence>
    </div>
  );
}

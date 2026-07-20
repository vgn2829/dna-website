import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Circle, Trophy, Play, ChevronRight, ArrowRight } from 'lucide-react';
import { useStudent } from '../context/StudentContext';
import { useAppData } from '../context/AppDataContext';
import { api } from '../lib/api';
import { usePageMeta } from '../components/hooks/use-page-meta';

const DIFF_COLORS: Record<string, string> = {
  Beginner:     '#3ecf5f',
  Intermediate: '#007AFF',
  Advanced:     '#e5484d',
};

function ProgressRing({ pct, color, size = 64 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  return (
    <svg width={size} height={size} className="-rotate-90" style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={4} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - dash }}
        transition={{ duration: 1.4, ease: 'easeOut' }}
      />
    </svg>
  );
}

function QuizCard({ domainId, questions }: {
  domainId: string;
  questions: { q: string; options: string[] }[];
}) {
  const { studentSession, studentProgress, completeQuiz, openRollModal } = useStudent();
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [done, setDone] = useState(false);
  const alreadyDone = studentProgress.completedQuizzes.includes(domainId);

  const reset = () => { setIdx(0); setAnswers([]); setSelected(null); };

  const handleSubmit = async () => {
    if (selected === null) return;
    const nextAnswers = [...answers];
    nextAnswers[idx] = selected;
    setAnswers(nextAnswers);

    if (idx + 1 < questions.length) {
      setIdx(i => i + 1);
      setSelected(nextAnswers[idx + 1] ?? null);
      return;
    }

    // Last question — grade server-side (answer keys never reach the client).
    if (!studentSession) { openRollModal(); return; }
    setSubmitting(true);
    setResultMsg('');
    try {
      const r = await api.domains.submitQuiz(domainId, studentSession.rollNumber, nextAnswers);
      if (r.passed) {
        completeQuiz(domainId);
        setDone(true);
      } else {
        setResultMsg(`${r.correct}/${r.total} correct — give it another try.`);
        reset();
      }
    } catch {
      setResultMsg('Could not submit — please try again.');
      reset();
    } finally {
      setSubmitting(false);
    }
  };

  if (alreadyDone || done) {
    return (
      <div className="card p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
          style={{ background: 'rgba(62,207,95,0.12)', color: '#3ecf5f' }}>
          <Trophy size={22} />
        </div>
        <p className="type-headline">Domain Badge Unlocked!</p>
        <p className="type-caption">You've mastered this module.</p>
      </div>
    );
  }

  const q = questions[idx];
  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <p className="type-caption">Knowledge Check</p>
        <span className="type-micro">{idx + 1} / {questions.length}</span>
      </div>
      <p className="type-body" style={{ color: 'var(--color-ink)' }}>{q.q}</p>
      <div className="space-y-2">
        {q.options.map((opt, i) => {
          const isSel = selected === i;
          return (
            <button
              key={i}
              onClick={() => setSelected(i)}
              disabled={submitting}
              className="w-full text-left px-4 py-3 rounded-xl type-body-sm transition-all"
              style={{
                background: 'var(--color-surface-2)',
                color: isSel ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                border: isSel ? '1px solid var(--color-hairline)' : '1px solid transparent',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {resultMsg && (
        <p className="type-caption" style={{ color: '#e5484d' }}>{resultMsg}</p>
      )}
      <button
        onClick={handleSubmit}
        disabled={selected === null || submitting}
        className="btn-primary w-full justify-center"
        style={{ opacity: selected !== null && !submitting ? 1 : 0.4 }}
      >
        {submitting ? 'Checking…' : idx + 1 < questions.length ? 'Next' : 'Submit Quiz'}
      </button>
    </div>
  );
}

export function AcademyPage() {
  usePageMeta({
    title: 'Creative Academy | DnA Club, IIT Kanpur',
    description: 'Free video courses and quizzes in UI/UX, Photoshop, Illustrator, and 3D animation — learn design at your own pace.',
    path: '/academy',
  });

  const { studentSession, studentProgress, openRollModal, markVideoWatched, unmarkVideoWatched, totalXP } = useStudent();
  const { domains, loading, error } = useAppData();
  const domainKeys = Object.keys(domains);
  const [activeDomainId, setActiveDomainId] = useState(domainKeys[0] ?? 'uiux');
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '5rem' }}>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 14 }}>Loading academy…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, paddingTop: '5rem' }}>
        <div style={{ color: 'var(--color-ink)', fontSize: 16, fontWeight: 600 }}>Could not load academy</div>
        <div style={{ color: 'var(--color-ink-muted)', fontSize: 13 }}>Please check your connection and try again.</div>
      </div>
    );
  }

  const DOMAIN_COLORS: Record<string, string> = {
    uiux: '#007AFF', photoshop: '#BF5AF2', illustrator: '#FF9F0A', animation: '#e5484d',
  };

  const domain = domains[activeDomainId];
  const activeVideo = domain?.videos.find(v => v.id === activeVideoId) ?? domain?.videos[0] ?? null;
  const watchedInDomain = domain?.videos.filter(v => studentProgress.watchedVideos.includes(v.id)).length ?? 0;
  const domainPct = domain?.videos.length ? Math.round((watchedInDomain / domain.videos.length) * 100) : 0;
  const totalVideos = Object.values(domains).reduce((a, d) => a + d.videos.length, 0);
  const globalPct = totalVideos ? Math.round((studentProgress.watchedVideos.length / totalVideos) * 100) : 0;

  const handleWatchToggle = (videoId: string) => {
    if (!studentSession) { openRollModal(); return; }
    if (studentProgress.watchedVideos.includes(videoId)) unmarkVideoWatched(videoId);
    else markVideoWatched(videoId);
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-canvas)', paddingTop: '5rem', paddingBottom: '5rem' }}>
      <div className="page-container">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <p className="type-caption mb-3">Learning Center</p>
          <h1 className="type-display-xl" style={{ fontFamily: 'var(--font-display)' }}>
            Creative<br />
            <span style={{ color: 'var(--color-ink-muted)' }}>Academy</span>
          </h1>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sidebar */}
          <aside className="lg:col-span-3 space-y-4">
            {/* Domain tabs */}
            <div className="card p-4 space-y-1">
              <p className="type-caption mb-3 px-1">Domains</p>
              {domainKeys.map(key => {
                const d = domains[key];
                const isActive = activeDomainId === key;
                const watched = d.videos.filter(v => studentProgress.watchedVideos.includes(v.id)).length;
                const pct = d.videos.length ? Math.round((watched / d.videos.length) * 100) : 0;
                const c = DOMAIN_COLORS[key] ?? '#fff';
                return (
                  <button
                    key={key}
                    onClick={() => { setActiveDomainId(key); setActiveVideoId(null); }}
                    className="w-full text-left p-3 rounded-xl transition-all"
                    style={{
                      background: isActive ? 'var(--color-surface-2)' : 'transparent',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="type-body-sm" style={{ color: isActive ? 'var(--color-ink)' : 'var(--color-ink-muted)' }}>
                        <i className={`fa-solid ${d.icon} mr-2`} style={{ color: isActive ? c : undefined }} />
                        {d.title}
                      </span>
                      <span className="type-micro">{pct}%</span>
                    </div>
                    <div className="w-full h-0.5 rounded-full" style={{ background: 'var(--color-surface-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Stats */}
            <div className="card p-4 space-y-4">
              <p className="type-caption">Your Stats</p>
              {studentSession ? (
                <>
                  <div className="flex items-center gap-4">
                    <div className="relative flex items-center justify-center">
                      <ProgressRing pct={globalPct} color="var(--color-ink)" />
                      <span className="absolute type-micro font-bold">{globalPct}%</span>
                    </div>
                    <div>
                      <p className="type-body font-semibold">{studentProgress.watchedVideos.length}/{totalVideos}</p>
                      <p className="type-micro">videos watched</p>
                      <p className="type-headline mt-1">{totalXP} <span className="type-caption">XP</span></p>
                    </div>
                  </div>
                  <div>
                    <p className="type-caption mb-2">Badges</p>
                    <div className="flex flex-wrap gap-2">
                      {domainKeys.map(key => {
                        const d = domains[key];
                        const earned = studentProgress.completedQuizzes.includes(key);
                        const c = DOMAIN_COLORS[key] ?? '#fff';
                        return (
                          <div key={key} title={d.title}
                            className="w-8 h-8 rounded-full flex items-center justify-center type-micro"
                            style={{
                              background: earned ? `${c}18` : 'var(--color-surface-2)',
                              color: earned ? c : 'var(--color-ink-muted)',
                            }}>
                            <i className={`fa-solid ${d.icon}`} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <button onClick={openRollModal} className="btn-secondary w-full justify-center">
                  Link Roll No. to Track
                </button>
              )}
            </div>
          </aside>

          {/* Main */}
          <div className="lg:col-span-9 space-y-5">
            {/* Video theater */}
            {activeVideo && (
              <motion.div key={activeVideo.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="card overflow-hidden">
                <div className="aspect-video" style={{ background: 'var(--color-canvas)' }}>
                  <iframe
                    className="w-full h-full"
                    src={`https://www.youtube.com/embed/${activeVideo.ytId}?rel=0`}
                    title={activeVideo.title}
                    allowFullScreen
                  />
                </div>
                <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="type-micro px-2 py-0.5 rounded-full"
                        style={{ background: `${DIFF_COLORS[activeVideo.difficulty]}18`, color: DIFF_COLORS[activeVideo.difficulty] }}>
                        {activeVideo.difficulty}
                      </span>
                      <span className="type-micro">{activeVideo.duration}</span>
                    </div>
                    <h2 className="type-headline">{activeVideo.title}</h2>
                  </div>
                  <button
                    onClick={() => handleWatchToggle(activeVideo.id)}
                    className="shrink-0"
                    style={studentProgress.watchedVideos.includes(activeVideo.id)
                      ? { } : { }}
                  >
                    {studentProgress.watchedVideos.includes(activeVideo.id) ? (
                      <span className="flex items-center gap-2 btn-secondary" style={{ color: '#3ecf5f', background: 'rgba(62,207,95,0.10)' }}>
                        <CheckCircle2 size={14} /> Watched
                      </span>
                    ) : (
                      <span className="btn-secondary flex items-center gap-2">
                        <Circle size={14} /> Mark Watched
                      </span>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Playlist */}
            <div className="card p-5 space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="type-caption">{domain?.title} — Playlist</p>
                <div className="relative flex items-center justify-center">
                  <ProgressRing pct={domainPct} color={DOMAIN_COLORS[activeDomainId] ?? '#fff'} size={36} />
                  <span className="absolute" style={{ fontSize: 8, fontWeight: 700 }}>{domainPct}%</span>
                </div>
              </div>
              {domain?.videos.map(v => {
                const isActive = (activeVideo?.id ?? domain.videos[0]?.id) === v.id;
                const watched = studentProgress.watchedVideos.includes(v.id);
                const c = DOMAIN_COLORS[activeDomainId] ?? '#fff';
                return (
                  <button key={v.id} onClick={() => setActiveVideoId(v.id)}
                    className="w-full flex items-center gap-4 p-3 rounded-xl text-left transition-all"
                    style={{
                      background: isActive ? 'var(--color-surface-2)' : 'transparent',
                      borderRadius: 'var(--radius-md)',
                    }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: isActive ? `${c}20` : 'var(--color-surface-2)' }}>
                      {watched
                        ? <CheckCircle2 size={13} style={{ color: '#3ecf5f' }} />
                        : <Play size={13} style={{ color: isActive ? c : 'var(--color-ink-muted)' }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="type-body-sm truncate" style={{ color: isActive ? 'var(--color-ink)' : 'var(--color-ink-muted)' }}>{v.title}</p>
                      <p className="type-micro mt-0.5">{v.duration}</p>
                    </div>
                    <span className="type-micro px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: `${DIFF_COLORS[v.difficulty]}10`, color: DIFF_COLORS[v.difficulty] }}>
                      {v.difficulty}
                    </span>
                    <ChevronRight size={13} style={{ color: 'var(--color-ink-muted)', flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>

            {/* Quiz */}
            <AnimatePresence mode="wait">
              <motion.div key={activeDomainId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                {domain?.quizzes && domain.quizzes.length > 0 && (
                  <QuizCard
                    domainId={activeDomainId}
                    questions={domain.quizzes}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { api, Board } from '../lib/api';
import { useStudent } from '../context/StudentContext';

export default function MoodboardsPage() {
  const navigate = useNavigate();
  const { studentSession, openRollModal } = useStudent();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' as 'private' | 'shared' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!studentSession?.rollNumber) return;
    setLoading(true);
    api.boards.getMyBoards(studentSession.rollNumber)
      .then(setBoards)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [studentSession?.rollNumber]);

  const handleCreate = async () => {
    if (!studentSession?.rollNumber || !form.name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const board = await api.boards.create(studentSession.rollNumber, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        visibility: form.visibility,
      });
      setBoards(prev => [board, ...prev]);
      setShowCreate(false);
      setForm({ name: '', description: '', visibility: 'private' });
      navigate(`/moodboards/${board.id}`);
    } catch {
      setError('Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page-container" style={{ paddingTop: 80, paddingBottom: 80, minHeight: '100vh' }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink-muted)', letterSpacing: '-0.13px', fontFamily: 'var(--font-body)', marginBottom: 12 }}>
          Creative Workspace
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(40px,6vw,85px)', fontWeight: 500, lineHeight: 0.95, letterSpacing: '-4.25px', color: 'var(--color-ink)' }}>
            Mood<br /><span style={{ color: 'var(--color-ink-muted)' }}>boards</span>
          </h1>
          {studentSession ? (
            <button
              onClick={() => setShowCreate(true)}
              style={{ padding: '10px 20px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              + New Board
            </button>
          ) : (
            <button
              onClick={openRollModal}
              style={{ padding: '10px 20px', background: 'var(--color-surface-1)', color: 'var(--color-ink)', border: 'none', borderRadius: 100, fontSize: 14, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              Sign in to create boards
            </button>
          )}
        </div>
      </motion.div>

      {!studentSession ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 15, marginBottom: 20 }}>
            Create private boards to collect inspiration from the gallery and the web.
          </p>
          <button
            onClick={openRollModal}
            style={{ padding: '12px 24px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
          >
            Enter Roll Number
          </button>
        </motion.div>
      ) : loading ? (
        <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>Loading boards...</p>
      ) : boards.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 15, marginBottom: 20 }}>
            No boards yet. Create one to start collecting inspiration.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            style={{ padding: '12px 24px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
          >
            + New Board
          </button>
        </motion.div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {boards.map((board, i) => (
            <motion.div
              key={board.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => navigate(`/moodboards/${board.id}`)}
              style={{ border: '1px solid var(--color-border)', borderRadius: 16, padding: '20px', background: 'var(--color-surface-1)', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-1)')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>
                  {board.name}
                </h2>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 100, background: board.visibility === 'shared' ? 'rgba(233,30,140,0.1)' : 'rgba(255,255,255,0.06)', color: board.visibility === 'shared' ? '#E91E8C' : 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
                  {board.visibility}
                </span>
              </div>
              {board.description && (
                <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.4 }}>
                  {board.description}
                </p>
              )}
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                {board.item_count} image{board.item_count !== 1 ? 's' : ''}
              </p>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create board modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 440, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                New Moodboard
              </h3>

              {[
                { label: 'Board Name', key: 'name', placeholder: 'e.g. Typography Inspo', type: 'text' },
                { label: 'Description (optional)', key: 'description', placeholder: 'What is this board about?', type: 'text' },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                    {label}
                  </label>
                  <input
                    className="input-base"
                    type={type}
                    placeholder={placeholder}
                    value={(form as Record<string, string>)[key]}
                    onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    autoFocus={key === 'name'}
                  />
                </div>
              ))}

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                  Visibility
                </label>
                <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
                  {(['private', 'shared'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setForm(prev => ({ ...prev, visibility: v }))}
                      style={{ flex: 1, padding: '8px 0', background: form.visibility === v ? 'rgba(233,30,140,0.1)' : 'none', border: 'none', color: form.visibility === v ? '#E91E8C' : 'var(--color-ink-muted)', fontSize: 13, fontWeight: form.visibility === v ? 600 : 400, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                    >
                      {v === 'private' ? 'Private' : 'Shared'}
                    </button>
                  ))}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                  {form.visibility === 'private' ? 'Only you and collaborators can see this board.' : 'Anyone with the link can view this board.'}
                </p>
              </div>

              {error && <p style={{ margin: 0, fontSize: 12, color: '#ef4444', fontFamily: 'var(--font-body)' }}>{error}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleCreate}
                  disabled={creating || !form.name.trim()}
                  style={{ flex: 1, padding: '12px 20px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: creating || !form.name.trim() ? 'not-allowed' : 'pointer', opacity: creating || !form.name.trim() ? 0.6 : 1 }}
                >
                  {creating ? 'Creating...' : 'Create Board'}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  style={{ flex: 1, padding: '12px 20px', background: 'none', color: 'var(--color-ink-muted)', border: '1px solid var(--color-border)', borderRadius: 100, fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

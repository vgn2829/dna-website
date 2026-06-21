import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { api, type Board } from '../lib/api';
import { useStudent } from '../context/StudentContext';

type Tab = 'mine' | 'shared';

function BoardCard({ board, onClick }: { board: Board; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        overflow: 'hidden',
        background: 'var(--color-surface-1)',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-1)')}
    >
      {/* Cover grid placeholder */}
      <div style={{
        width: '100%',
        aspectRatio: '16 / 9',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 1,
        overflow: 'hidden',
        background: 'var(--color-surface-2)',
      }}>
        {[0.04, 0.06, 0.08, 0.10].map((alpha, i) => (
          <div key={i} style={{ background: `rgba(233,30,140,${alpha})` }} />
        ))}
      </div>

      {/* Card body */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <h3 style={{
            margin: 0, fontSize: 15, fontWeight: 600,
            color: 'var(--color-ink)', fontFamily: 'var(--font-body)', lineHeight: 1.3,
          }}>
            {board.name}
          </h3>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 100, flexShrink: 0, fontFamily: 'var(--font-body)',
            background: board.visibility === 'shared' ? 'rgba(233,30,140,0.1)' : 'rgba(128,128,128,0.1)',
            color: board.visibility === 'shared' ? '#E91E8C' : 'var(--color-ink-muted)',
          }}>
            {board.visibility}
          </span>
        </div>
        {board.owner_name && (
          <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            by {board.owner_name}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
          {board.item_count} item{board.item_count !== 1 ? 's' : ''}
          {board.member_count > 0 ? ` · ${board.member_count + 1} members` : ''}
        </p>
      </div>
    </div>
  );
}

export default function MoodboardsPage() {
  const navigate = useNavigate();
  const { studentSession, openRollModal } = useStudent();
  const [tab, setTab] = useState<Tab>('mine');
  const [myBoards, setMyBoards] = useState<Board[]>([]);
  const [sharedBoards, setSharedBoards] = useState<Board[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'private' as 'private' | 'shared' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSharedLoading(true);
    api.boards.getShared()
      .then(setSharedBoards)
      .catch(() => {})
      .finally(() => setSharedLoading(false));
  }, []);

  useEffect(() => {
    if (!studentSession?.rollNumber) return;
    setMyLoading(true);
    api.boards.getMyBoards(studentSession.rollNumber)
      .then(setMyBoards)
      .catch(() => {})
      .finally(() => setMyLoading(false));
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
      setMyBoards(prev => [board, ...prev]);
      if (form.visibility === 'shared') setSharedBoards(prev => [board, ...prev]);
      setShowCreate(false);
      setForm({ name: '', description: '', visibility: 'private' });
      navigate(`/moodboards/${board.id}`);
    } catch {
      setError('Failed to create board');
    } finally {
      setCreating(false);
    }
  };

  const activeBoards = tab === 'mine' ? myBoards : sharedBoards;
  const activeLoading = tab === 'mine' ? myLoading : sharedLoading;

  return (
    <div className="page-container" style={{ paddingTop: 80, paddingBottom: 80, minHeight: '100vh' }}>
      {/* Header */}
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

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 32 }}>
        {([['mine', 'My Boards'], ['shared', 'Shared Boards']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: tab === key ? '2px solid #E91E8C' : '2px solid transparent',
              marginBottom: -1,
              color: tab === key ? '#E91E8C' : 'var(--color-ink-muted)',
              fontSize: 14,
              fontWeight: tab === key ? 600 : 400,
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'mine' && !studentSession ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 15, marginBottom: 20 }}>
            Link your roll number to create and manage your boards.
          </p>
          <button
            onClick={openRollModal}
            style={{ padding: '12px 24px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
          >
            Enter Roll Number
          </button>
        </motion.div>
      ) : activeLoading ? (
        <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>Loading...</p>
      ) : activeBoards.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 15, marginBottom: 20 }}>
            {tab === 'mine' ? 'No boards yet. Create one to start collecting inspiration.' : 'No shared boards yet.'}
          </p>
          {tab === 'mine' && (
            <button
              onClick={() => setShowCreate(true)}
              style={{ padding: '12px 24px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              + New Board
            </button>
          )}
        </motion.div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {activeBoards.map((board, i) => (
            <motion.div key={board.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <BoardCard board={board} onClick={() => navigate(`/moodboards/${board.id}`)} />
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

              {([
                { label: 'Board Name', key: 'name', placeholder: 'e.g. Typography Inspo' },
                { label: 'Description (optional)', key: 'description', placeholder: 'What is this board about?' },
              ] as const).map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                    {label}
                  </label>
                  <input
                    className="input-base"
                    type="text"
                    placeholder={placeholder}
                    value={form[key]}
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
                <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
                  {(['private', 'shared'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setForm(prev => ({ ...prev, visibility: v }))}
                      style={{
                        flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer',
                        background: form.visibility === v ? 'rgba(233,30,140,0.1)' : 'none',
                        color: form.visibility === v ? '#E91E8C' : 'var(--color-ink-muted)',
                        fontSize: 13, fontWeight: form.visibility === v ? 600 : 400, fontFamily: 'var(--font-body)',
                      }}
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

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { api, BoardDetail, BoardItem } from '../lib/api';
import { useStudent } from '../context/StudentContext';

export default function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { studentSession } = useStudent();
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showAddItem, setShowAddItem] = useState(false);
  const [addMode, setAddMode] = useState<'url' | 'upload'>('url');
  const [imageUrl, setImageUrl] = useState('');
  const [note, setNote] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [urlPreview, setUrlPreview] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [showMembers, setShowMembers] = useState(false);
  const [memberRoll, setMemberRoll] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState('');

  const [expanded, setExpanded] = useState<BoardItem | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = board?.owner_roll === studentSession?.rollNumber;
  const isMember = board
    ? (isOwner || board.members.some(m => m.roll_number === studentSession?.rollNumber))
    : false;
  const canEdit = isMember;

  const loadBoard = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.boards.getBoard(id, studentSession?.rollNumber);
      setBoard(data);
    } catch {
      setError('Failed to load board.');
    } finally {
      setLoading(false);
    }
  }, [id, studentSession?.rollNumber]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    if (!id || !board) return;
    const interval = setInterval(async () => {
      try {
        const items = await api.boards.getItems(id, studentSession?.rollNumber);
        setBoard(prev => prev ? { ...prev, items } : prev);
      } catch {
        // Silent fail
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [id, board?.id, studentSession?.rollNumber]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (imageUrl && imageUrl.startsWith('http')) {
        setUrlPreview(imageUrl);
      } else {
        setUrlPreview('');
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [imageUrl]);

  const handleAddUrl = async () => {
    if (!id || !studentSession?.rollNumber || !imageUrl) return;
    setAdding(true);
    try {
      const item = await api.boards.addItem(id, studentSession.rollNumber, {
        image_url: imageUrl,
        note: note || undefined,
        source_url: sourceUrl || undefined,
      });
      setBoard(prev => prev ? { ...prev, items: [item, ...prev.items] } : prev);
      setImageUrl('');
      setNote('');
      setSourceUrl('');
      setUrlPreview('');
      setShowAddItem(false);
    } catch {
      setError('Failed to add item');
    } finally {
      setAdding(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id || !studentSession?.rollNumber) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/upload`,
        { method: 'POST', body: formData }
      );

      if (!uploadRes.ok) throw new Error('Upload failed');
      const { url } = await uploadRes.json();

      const item = await api.boards.addItem(id, studentSession.rollNumber, { image_url: url });
      setBoard(prev => prev ? { ...prev, items: [item, ...prev.items] } : prev);
      setShowAddItem(false);
    } catch {
      const objectUrl = URL.createObjectURL(file);
      try {
        const item = await api.boards.addItem(id, studentSession.rollNumber, { image_url: objectUrl });
        setBoard(prev => prev ? { ...prev, items: [item, ...prev.items] } : prev);
        setShowAddItem(false);
      } catch {
        setError('Failed to upload image');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteItem = async (item: BoardItem) => {
    if (!id || !studentSession?.rollNumber) return;
    try {
      await api.boards.deleteItem(id, item.id, studentSession.rollNumber);
      setBoard(prev => prev ? { ...prev, items: prev.items.filter(i => i.id !== item.id) } : prev);
      if (expanded?.id === item.id) setExpanded(null);
    } catch {
      setError('Failed to delete item');
    }
  };

  const handleAddMember = async () => {
    if (!id || !studentSession?.rollNumber || !memberRoll.trim()) return;
    setAddingMember(true);
    setMemberError('');
    try {
      const res = await api.boards.addMember(id, studentSession.rollNumber, memberRoll.trim());
      setBoard(prev => prev ? {
        ...prev,
        members: [...prev.members, {
          roll_number: memberRoll.trim(),
          name: res.name,
          added_at: new Date().toISOString(),
        }]
      } : prev);
      setMemberRoll('');
    } catch (err) {
      setMemberError((err as Error)?.message ?? 'Student not found — they must register first');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (mRoll: string) => {
    if (!id || !studentSession?.rollNumber) return;
    try {
      await api.boards.removeMember(id, studentSession.rollNumber, mRoll);
      setBoard(prev => prev ? { ...prev, members: prev.members.filter(m => m.roll_number !== mRoll) } : prev);
    } catch {
      setError('Failed to remove member');
    }
  };

  const handleDeleteBoard = async () => {
    if (!id || !studentSession?.rollNumber) return;
    setDeleting(true);
    try {
      await api.boards.delete(id, studentSession.rollNumber);
      navigate('/moodboards');
    } catch {
      setError('Failed to delete board');
      setDeleting(false);
    }
  };

  if (loading) return (
    <div className="page-container" style={{ paddingTop: 120, minHeight: '100vh' }}>
      <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
        Loading board...
      </p>
    </div>
  );

  if (error || !board) return (
    <div className="page-container" style={{ paddingTop: 120, minHeight: '100vh' }}>
      <p style={{ color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
        {error || 'Board not found.'}
      </p>
      <button
        onClick={() => navigate('/moodboards')}
        style={{ marginTop: 16, padding: '10px 20px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
      >
        Back to Moodboards
      </button>
    </div>
  );

  return (
    <div className="page-container" style={{ paddingTop: 80, paddingBottom: 80, minHeight: '100vh' }}>

      {/* Board header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <button
            onClick={() => navigate('/moodboards')}
            style={{ background: 'none', border: 'none', color: 'var(--color-ink-muted)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer', padding: '0 0 12px', display: 'block' }}
          >
            ← Moodboards
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: '-0.8px', color: 'var(--color-ink)', fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>
              {board.name}
            </h1>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 10px', borderRadius: 100, background: board.visibility === 'shared' ? 'rgba(233,30,140,0.1)' : 'rgba(255,255,255,0.06)', color: board.visibility === 'shared' ? '#E91E8C' : 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
              {board.visibility}
            </span>
          </div>
          {board.description && (
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
              {board.description}
            </p>
          )}
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
            by {board.owner_name ?? board.owner_roll}
            {board.members.length > 0 ? ` · ${board.members.length + 1} collaborators` : ''}
            {' · '}{board.items.length} items
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isOwner && (
            <button
              onClick={() => setShowMembers(true)}
              style={{ padding: '8px 16px', background: 'none', border: '1px solid var(--color-border)', borderRadius: 100, color: 'var(--color-ink-muted)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              Collaborators ({board.members.length})
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setShowAddItem(true)}
              style={{ padding: '8px 20px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              + Add Image
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ padding: '8px 16px', background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 100, color: '#ef4444', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              Delete Board
            </button>
          )}
        </div>
      </div>

      {/* Masonry grid */}
      {board.items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
          {canEdit ? 'No images yet. Add your first inspiration.' : 'This board is empty.'}
        </div>
      ) : (
        <div style={{ columns: 'auto 240px', gap: 12 }}>
          {board.items.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.4) }}
              style={{ breakInside: 'avoid', marginBottom: 12, position: 'relative', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--color-border)' }}
              onClick={() => setExpanded(item)}
            >
              <img
                src={item.image_url}
                alt={item.note ?? 'Moodboard image'}
                style={{ width: '100%', display: 'block', borderRadius: 12 }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div
                style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', transition: 'background 0.2s ease', borderRadius: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 10, opacity: 0 }}
                onMouseEnter={e => { const el = e.currentTarget; el.style.opacity = '1'; el.style.background = 'rgba(0,0,0,0.4)'; }}
                onMouseLeave={e => { const el = e.currentTarget; el.style.opacity = '0'; el.style.background = 'rgba(0,0,0,0)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {canEdit && (item.added_by_roll === studentSession?.rollNumber || isOwner) && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteItem(item); }}
                      style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {item.note && (
                  <p style={{ margin: 0, fontSize: 12, color: '#fff', fontFamily: 'var(--font-body)', lineHeight: 1.4, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                    {item.note}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add item modal */}
      <AnimatePresence>
        {showAddItem && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setShowAddItem(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 480, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                  Add Image
                </h3>
                <button
                  onClick={() => setShowAddItem(false)}
                  style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-ink-muted)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  ×
                </button>
              </div>

              {/* Mode toggle */}
              <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
                {(['url', 'upload'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setAddMode(m)}
                    style={{ flex: 1, padding: '8px 0', background: addMode === m ? 'rgba(233,30,140,0.1)' : 'none', border: 'none', color: addMode === m ? '#E91E8C' : 'var(--color-ink-muted)', fontSize: 13, fontWeight: addMode === m ? 600 : 400, fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                  >
                    {m === 'url' ? 'Paste URL' : 'Upload File'}
                  </button>
                ))}
              </div>

              {addMode === 'url' ? (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                      Image URL
                    </label>
                    <input
                      className="input-base"
                      type="url"
                      placeholder="https://..."
                      value={imageUrl}
                      onChange={e => setImageUrl(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      autoFocus
                    />
                  </div>

                  {urlPreview && (
                    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)', maxHeight: 200 }}>
                      <img
                        src={urlPreview}
                        alt="Preview"
                        style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 200 }}
                        onError={() => setUrlPreview('')}
                      />
                    </div>
                  )}

                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                      Note (optional)
                    </label>
                    <input
                      className="input-base"
                      type="text"
                      placeholder="What do you like about this?"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
                      Source URL (optional)
                    </label>
                    <input
                      className="input-base"
                      type="url"
                      placeholder="https://pinterest.com/..."
                      value={sourceUrl}
                      onChange={e => setSourceUrl(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                  </div>

                  <button
                    onClick={handleAddUrl}
                    disabled={adding || !imageUrl}
                    style={{ padding: '12px 20px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 100, fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: adding || !imageUrl ? 'not-allowed' : 'pointer', opacity: adding || !imageUrl ? 0.6 : 1 }}
                  >
                    {adding ? 'Adding...' : 'Add to Board'}
                  </button>
                </>
              ) : (
                <>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{ border: '2px dashed var(--color-border)', borderRadius: 12, padding: '40px 24px', textAlign: 'center', cursor: 'pointer', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14, transition: 'border-color 0.2s ease' }}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#E91E8C'; }}
                    onDragLeave={e => { e.currentTarget.style.borderColor = ''; }}
                    onDrop={e => {
                      e.preventDefault();
                      e.currentTarget.style.borderColor = '';
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const fakeEvent = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
                        handleFileUpload(fakeEvent);
                      }
                    }}
                  >
                    {uploading ? 'Uploading...' : 'Click to upload or drag and drop'}
                    <br />
                    <span style={{ fontSize: 12 }}>PNG, JPG, WEBP</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                  />
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded item view */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setExpanded(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: 700, width: '100%', background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 20, overflow: 'hidden' }}
            >
              <img
                src={expanded.image_url}
                alt={expanded.note ?? ''}
                style={{ width: '100%', display: 'block', maxHeight: 480, objectFit: 'contain', background: 'var(--color-canvas)' }}
              />
              <div style={{ padding: '20px 24px' }}>
                {expanded.note && (
                  <p style={{ margin: '0 0 8px', fontSize: 15, color: 'var(--color-ink)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                    {expanded.note}
                  </p>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                    Added by {expanded.added_by_name ?? expanded.added_by_roll}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {expanded.source_url && (
                      <a
                        href={expanded.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#E91E8C', fontFamily: 'var(--font-body)', textDecoration: 'none' }}
                      >
                        View Source →
                      </a>
                    )}
                    {canEdit && (expanded.added_by_roll === studentSession?.rollNumber || isOwner) && (
                      <button
                        onClick={() => handleDeleteItem(expanded)}
                        style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collaborators panel */}
      <AnimatePresence>
        {showMembers && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => setShowMembers(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16 }}
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 400, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.3px' }}>
                Collaborators
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Owner */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                      {board.owner_name ?? board.owner_roll}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                      {board.owner_roll} · Owner
                    </p>
                  </div>
                </div>

                {board.members.map(m => (
                  <div key={m.roll_number} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                        {m.name ?? m.roll_number}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                        {m.roll_number}
                      </p>
                    </div>
                    {isOwner && (
                      <button
                        onClick={() => handleRemoveMember(m.roll_number)}
                        style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {isOwner && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-ink-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
                    Add by Roll Number
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="input-base"
                      type="text"
                      placeholder="e.g. 250004"
                      value={memberRoll}
                      onChange={e => { setMemberRoll(e.target.value); setMemberError(''); }}
                      style={{ flex: 1 }}
                    />
                    <button
                      onClick={handleAddMember}
                      disabled={addingMember || !memberRoll.trim()}
                      style={{ padding: '0 16px', background: '#E91E8C', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: addingMember ? 'not-allowed' : 'pointer' }}
                    >
                      {addingMember ? '...' : 'Add'}
                    </button>
                  </div>
                  {memberError && (
                    <p style={{ margin: 0, fontSize: 12, color: '#ef4444', fontFamily: 'var(--font-body)' }}>
                      {memberError}
                    </p>
                  )}
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)' }}>
                    Student must have registered on the website first.
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete board confirm */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              style={{ width: '100%', maxWidth: 360, background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-display)' }}>
                Delete "{board.name}"?
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                This will permanently delete the board and all {board.items.length} images in it. This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleDeleteBoard}
                  disabled={deleting}
                  style={{ flex: 1, padding: '12px 20px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 100, fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)', cursor: deleting ? 'not-allowed' : 'pointer' }}
                >
                  {deleting ? 'Deleting...' : 'Delete Board'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
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

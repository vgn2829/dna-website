import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowRight } from 'lucide-react';
import { useStudent, hasSeenWelcome, markWelcomeSeen } from '../context/StudentContext';
import WelcomeOverlay from './WelcomeOverlay';

const IITK_ROLL_REGEX = /^[0-9]{2}[a-zA-Z0-9]{4,6}$/;

export function RollModal({ onSuccess }: { onSuccess?: (uniqueId: string) => void }) {
  const { isRollModalOpen, closeRollModal, login } = useStudent();
  const [rollInput, setRollInput] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRoll, setNewUserRoll] = useState('');

  const isValidName  = (n: string) => n.trim().length >= 2 && n.trim().length <= 100;
  const isValidEmail = (e: string) => e.endsWith('@iitk.ac.in') && e.includes('@');
  const isValidRoll  = IITK_ROLL_REGEX.test(rollInput.trim());

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const trimmed = rollInput.trim();
    if (!isValidRoll || !isValidName(name) || !isValidEmail(email)) {
      setError('Please fill all fields correctly');
      setShake(true);
      setTimeout(() => setShake(false), 450);
      return;
    }
    setSubmitting(true);
    try {
      const session = await login(trimmed, name.trim(), email.trim());
      setNewUserName(name.trim());
      setNewUserRoll(session.rollNumber);
      setSuccess(session.uniqueId);
      onSuccess?.(session.uniqueId);
      if (!hasSeenWelcome(session.rollNumber)) {
        setTimeout(() => { setSuccess(null); setShowWelcome(true); }, 1000);
      } else {
        setTimeout(() => { setSuccess(null); setRollInput(''); setName(''); setEmail(''); setError(''); closeRollModal(); }, 1800);
      }
    } catch {
      setError('Could not connect — please try again');
      setShake(true);
      setTimeout(() => setShake(false), 450);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => { setRollInput(''); setName(''); setEmail(''); setError(''); setSuccess(null); closeRollModal(); };

  const handleWelcomeDone = () => {
    markWelcomeSeen(newUserRoll);
    setShowWelcome(false);
    setRollInput(''); setName(''); setEmail(''); setError('');
    closeRollModal();
  };

  return (
    <>
      <AnimatePresence>
        {isRollModalOpen && !showWelcome && (
          <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            onClick={handleClose}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 340 }}
              className="pointer-events-auto w-full max-w-sm"
              style={{
                background: 'var(--color-surface-1)',
                borderRadius: 'var(--radius-xxl)',
                boxShadow: 'var(--shadow-level-2)',
                padding: '2rem',
              }}
              onClick={e => e.stopPropagation()}
            >
              <motion.div
                animate={shake ? { x: [-10, 10, -8, 8, 0] } : { x: 0 }}
                transition={{ duration: 0.35 }}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="type-headline mb-1">Link Your Profile</h2>
                    <p className="type-caption">Connect your IITK roll number</p>
                  </div>
                  <button onClick={handleClose} className="btn-icon" style={{ width: 32, height: 32 }}>
                    <X size={15} />
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {success ? (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center py-6 space-y-3"
                    >
                      <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
                        style={{ background: 'rgba(62,207,95,0.12)' }}>
                        <span style={{ color: '#3ecf5f', fontSize: 22 }}>✓</span>
                      </div>
                      <p className="type-headline">Profile Linked!</p>
                      <p className="type-micro font-mono break-all" style={{ color: 'var(--color-ink-muted)' }}>{success}</p>
                    </motion.div>
                  ) : (
                    <motion.form
                      key="form"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      onSubmit={handleSubmit}
                      className="space-y-4"
                    >
                      <div>
                        <label className="type-micro block mb-2">Roll Number</label>
                        <input
                          type="text"
                          value={rollInput}
                          onChange={e => { setRollInput(e.target.value); setError(''); }}
                          placeholder="e.g. 230182"
                          maxLength={9}
                          className="input-base font-mono text-xl tracking-widest"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="type-micro block mb-2">Full Name</label>
                        <input
                          type="text"
                          value={name}
                          onChange={e => { setName(e.target.value); setError(''); }}
                          placeholder="e.g. Rahul Kumar"
                          maxLength={100}
                          className="input-base"
                          style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label className="type-micro block mb-2">IITK Email</label>
                        <input
                          type="email"
                          value={email}
                          onChange={e => { setEmail(e.target.value.toLowerCase()); setError(''); }}
                          placeholder="email@iitk.ac.in"
                          className="input-base"
                          style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                        {email && !isValidEmail(email) && (
                          <p className="type-micro mt-1" style={{ color: '#e5484d' }}>
                            Must be an @iitk.ac.in email address
                          </p>
                        )}
                      </div>
                      {error && (
                        <motion.p
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="type-micro"
                          style={{ color: '#e5484d' }}
                        >
                          {error}
                        </motion.p>
                      )}
                      <p className="type-micro" style={{ color: 'var(--color-ink-muted)' }}>
                        Your IITK email is used to identify you. Progress and activity saves to your account — no password needed.
                      </p>
                      <button
                        type="submit"
                        disabled={submitting || !isValidRoll || !isValidName(name) || !isValidEmail(email)}
                        className="btn-primary w-full justify-center gap-2"
                        style={{ opacity: (submitting || !isValidRoll || !isValidName(name) || !isValidEmail(email)) ? 0.6 : 1 }}
                      >
                        {submitting ? 'Linking…' : <><span>Generate My Tracker ID</span><ArrowRight size={13} /></>}
                      </button>
                    </motion.form>
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          </div>
          </>
        )}
      </AnimatePresence>
      {showWelcome && (
        <WelcomeOverlay name={newUserName} onDone={handleWelcomeDone} />
      )}
    </>
  );
}

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import { useStudent, hasSeenWelcome, markWelcomeSeen } from '../context/StudentContext';
import WelcomeOverlay from './WelcomeOverlay';

export function RollModal({ onSuccess }: { onSuccess?: (uniqueId: string) => void }) {
  const { isRollModalOpen, closeRollModal, login } = useStudent();

  type ModalStep = 'roll' | 'profile';
  const [step, setStep] = useState<ModalStep>('roll');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');

  const [roll, setRoll] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRoll, setNewUserRoll] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!isRollModalOpen) {
      setStep('roll');
      setRoll('');
      setName('');
      setEmail('');
      setCheckError('');
      setChecking(false);
    }
  }, [isRollModalOpen]);

  const handleRollContinue = async () => {
    if (!roll.trim()) return;
    setChecking(true);
    setCheckError('');
    try {
      const { exists, hasProfile } = await api.students.checkExists(roll.trim());
      if (exists && hasProfile) {
        await handleSubmitRoll(roll.trim());
      } else {
        setStep('profile');
      }
    } catch {
      setCheckError('Could not verify roll number. Try again.');
    } finally {
      setChecking(false);
    }
  };

  const handleSubmitRoll = async (rollNumber: string) => {
    try {
      const data = await api.students.loginExisting(rollNumber);
      login(data.rollNumber, data.uniqueId, data.registeredAt, data.name, data.email);
      onSuccess?.(data.uniqueId);
      closeRollModal();
    } catch {
      setStep('profile');
    }
  };

  const handleFullSubmit = async () => {
    if (!roll || !name.trim() || !email.endsWith('@iitk.ac.in')) return;
    setSubmitting(true);
    try {
      const data = await api.students.createSession(roll.trim(), name.trim(), email.trim());
      login(
        data.session.rollNumber,
        data.session.uniqueId,
        data.session.registeredAt,
        data.session.name ?? name.trim(),
        data.session.email ?? email.trim(),
      );
      onSuccess?.(data.session.uniqueId);
      setNewUserName(name.trim());
      setNewUserRoll(roll.trim());
      if (!hasSeenWelcome(roll.trim())) {
        setShowWelcome(true);
      } else {
        closeRollModal();
      }
    } catch (err) {
      console.error('Registration error:', err);
      setShake(true);
      setTimeout(() => setShake(false), 450);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setStep('roll');
    setRoll('');
    setName('');
    setEmail('');
    setCheckError('');
    closeRollModal();
  };

  const handleWelcomeDone = () => {
    markWelcomeSeen(newUserRoll);
    setShowWelcome(false);
    setRoll('');
    setName('');
    setEmail('');
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
                    {step === 'roll' && (
                      <motion.div
                        key="roll"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                      >
                        <div>
                          <p style={{
                            margin: '0 0 6px', fontSize: 11, fontWeight: 600,
                            color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                            textTransform: 'uppercase', fontFamily: 'var(--font-body)',
                          }}>
                            Roll Number
                          </p>
                          <input
                            className="input-base"
                            type="text"
                            placeholder="e.g. 230182"
                            value={roll}
                            onChange={e => { setRoll(e.target.value); setCheckError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleRollContinue(); }}
                            maxLength={9}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            autoFocus
                          />
                          {checkError && (
                            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>
                              {checkError}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={handleRollContinue}
                          disabled={checking || !roll.trim()}
                          style={{
                            width: '100%', padding: '13px 20px',
                            background: 'var(--color-brand)', color: '#fff',
                            border: 'none', borderRadius: 'var(--radius-pill)',
                            fontSize: 14, fontWeight: 600,
                            fontFamily: 'var(--font-body)',
                            cursor: checking || !roll.trim() ? 'not-allowed' : 'pointer',
                            opacity: checking || !roll.trim() ? 0.6 : 1,
                          }}
                        >
                          {checking ? 'Checking...' : 'Continue'}
                        </button>
                      </motion.div>
                    )}

                    {step === 'profile' && (
                      <motion.div
                        key="profile"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.2 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                      >
                        {/* Confirmed roll number */}
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '10px 14px',
                          background: 'rgba(34,197,94,0.08)',
                          border: '1px solid rgba(34,197,94,0.2)',
                          borderRadius: 'var(--radius-sm)',
                        }}>
                          <span style={{ fontSize: 13, color: 'var(--color-success)', fontFamily: 'var(--font-body)' }}>✓</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', fontFamily: 'var(--font-body)' }}>
                            {roll}
                          </span>
                          <button
                            onClick={() => { setStep('roll'); setName(''); setEmail(''); }}
                            style={{
                              marginLeft: 'auto', fontSize: 11,
                              color: 'var(--color-ink-muted)',
                              background: 'none', border: 'none',
                              fontFamily: 'var(--font-body)', cursor: 'pointer',
                            }}
                          >
                            Change
                          </button>
                        </div>

                        {/* Full Name */}
                        <div>
                          <label style={{
                            display: 'block', fontSize: 11, fontWeight: 600,
                            color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                            textTransform: 'uppercase', marginBottom: 6,
                            fontFamily: 'var(--font-body)',
                          }}>
                            Full Name
                          </label>
                          <input
                            className="input-base"
                            type="text"
                            placeholder="e.g. Rahul Kumar"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            maxLength={100}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            autoFocus
                          />
                        </div>

                        {/* IITK Email */}
                        <div>
                          <label style={{
                            display: 'block', fontSize: 11, fontWeight: 600,
                            color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
                            textTransform: 'uppercase', marginBottom: 6,
                            fontFamily: 'var(--font-body)',
                          }}>
                            IITK Email
                          </label>
                          <input
                            className="input-base"
                            type="email"
                            placeholder="rollno@iitk.ac.in"
                            value={email}
                            onChange={e => setEmail(e.target.value.toLowerCase())}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                          />
                          {email && !email.endsWith('@iitk.ac.in') && (
                            <p style={{ fontSize: 11, color: 'var(--color-error)', margin: '4px 0 0', fontFamily: 'var(--font-body)' }}>
                              Must be an @iitk.ac.in email address
                            </p>
                          )}
                        </div>

                        <p className="type-micro" style={{ color: 'var(--color-ink-muted)' }}>
                          Your IITK email is used to identify you. Progress and activity saves to your account — no password needed.
                        </p>

                        <button
                          onClick={handleFullSubmit}
                          disabled={submitting || !name.trim() || !email.endsWith('@iitk.ac.in')}
                          style={{
                            width: '100%', padding: '13px 20px',
                            background: 'var(--color-brand)', color: '#fff',
                            border: 'none', borderRadius: 'var(--radius-pill)',
                            fontSize: 14, fontWeight: 600,
                            fontFamily: 'var(--font-body)',
                            cursor: submitting ? 'not-allowed' : 'pointer',
                            opacity: submitting || !name.trim() || !email.endsWith('@iitk.ac.in') ? 0.6 : 1,
                          }}
                        >
                          {submitting ? 'Joining...' : 'Join DnA Club'}
                        </button>
                      </motion.div>
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

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import { useStudent, hasSeenWelcome, markWelcomeSeen } from '../context/StudentContext';
import WelcomeOverlay from './WelcomeOverlay';

export function RollModal({ onSuccess }: { onSuccess?: (uniqueId: string) => void }) {
  const { isRollModalOpen, closeRollModal, login, needsReverify, clearReverifyNotice } = useStudent();

  type ModalStep = 'roll' | 'profile' | 'otp';
  const [step, setStep] = useState<ModalStep>('roll');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');

  const [roll, setRoll] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [showWelcome, setShowWelcome] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRoll, setNewUserRoll] = useState('');
  const [shake, setShake] = useState(false);

  const resetAll = () => {
    setStep('roll');
    setRoll(''); setName(''); setEmail(''); setCode('');
    setMaskedEmail(''); setCheckError(''); setOtpError('');
    setChecking(false);
  };

  useEffect(() => {
    if (!isRollModalOpen) resetAll();
  }, [isRollModalOpen]);

  const errMsg = (err: unknown, fallback: string) =>
    (err instanceof Error && err.message && err.message !== 'SESSION_EXPIRED') ? err.message : fallback;

  // Step 1 → decide new vs existing, and for existing users send the code immediately.
  const handleRollContinue = async () => {
    if (!roll.trim()) return;
    setChecking(true);
    setCheckError('');
    try {
      const { exists, hasProfile } = await api.students.checkExists(roll.trim());
      if (exists && hasProfile) {
        const r = await api.students.requestOtp(roll.trim());
        setMaskedEmail(r.email);
        setCode('');
        setStep('otp');
      } else {
        setStep('profile');
      }
    } catch (err) {
      setCheckError(errMsg(err, 'Could not verify roll number. Try again.'));
    } finally {
      setChecking(false);
    }
  };

  // Step 2 (new users) → send the code to the email they entered.
  const handleSendCode = async () => {
    if (!roll || !name.trim() || !email.endsWith('@iitk.ac.in')) return;
    setSubmitting(true);
    setCheckError('');
    try {
      const r = await api.students.requestOtp(roll.trim(), { name: name.trim(), email: email.trim() });
      setMaskedEmail(r.email);
      setCode('');
      setStep('otp');
    } catch (err) {
      setCheckError(errMsg(err, 'Could not send the code. Try again.'));
      setShake(true);
      setTimeout(() => setShake(false), 450);
    } finally {
      setSubmitting(false);
    }
  };

  // Step 3 → verify the code; on success we receive a signed token.
  const handleVerify = async () => {
    if (!/^[0-9]{6}$/.test(code)) return;
    setVerifying(true);
    setOtpError('');
    try {
      const data = await api.students.verifyOtp(roll.trim(), code);
      login(data.token, data.session, data.progress);
      clearReverifyNotice();
      onSuccess?.(data.session.uniqueId);
      if (data.isNew) {
        setNewUserName(data.session.name);
        setNewUserRoll(roll.trim());
        if (!hasSeenWelcome(roll.trim())) {
          setShowWelcome(true);
          return;
        }
      }
      closeRollModal();
    } catch (err) {
      setOtpError(errMsg(err, 'Incorrect or expired code.'));
      setShake(true);
      setTimeout(() => setShake(false), 450);
    } finally {
      setVerifying(false);
    }
  };

  const handleClose = () => {
    resetAll();
    clearReverifyNotice();
    closeRollModal();
  };

  const handleWelcomeDone = () => {
    markWelcomeSeen(newUserRoll);
    setShowWelcome(false);
    resetAll();
    closeRollModal();
  };

  const label = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
    textTransform: 'uppercase' as const, marginBottom: 6,
    fontFamily: 'var(--font-body)',
  };
  const primaryBtn = (disabled: boolean) => ({
    width: '100%', padding: '13px 20px',
    background: 'var(--color-brand)', color: '#fff',
    border: 'none', borderRadius: 'var(--radius-pill)',
    fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  });

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

                  {needsReverify && (
                    <div style={{
                      marginBottom: 16, padding: '10px 14px',
                      background: 'color-mix(in srgb, var(--color-brand) 8%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--color-brand) 25%, transparent)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12.5, lineHeight: 1.5,
                      color: 'var(--color-ink)', fontFamily: 'var(--font-body)',
                    }}>
                      We've upgraded sign-in security. Please verify your identity again — your
                      profile and progress are safe and will be restored.
                    </div>
                  )}

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
                          <p style={{ ...label }}>Roll Number</p>
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
                          style={primaryBtn(checking || !roll.trim())}
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
                          <label style={label}>Full Name</label>
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
                          <label style={label}>IITK Email</label>
                          <input
                            className="input-base"
                            type="email"
                            placeholder="e.g. yourname23@iitk.ac.in"
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
                          We'll email a 6-digit code to verify it's you. No password needed.
                        </p>

                        {checkError && (
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>
                            {checkError}
                          </p>
                        )}

                        <button
                          onClick={handleSendCode}
                          disabled={submitting || !name.trim() || !email.endsWith('@iitk.ac.in')}
                          style={primaryBtn(submitting || !name.trim() || !email.endsWith('@iitk.ac.in'))}
                        >
                          {submitting ? 'Sending code...' : 'Send verification code'}
                        </button>
                      </motion.div>
                    )}

                    {step === 'otp' && (
                      <motion.div
                        key="otp"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.2 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                      >
                        <p className="type-micro" style={{ color: 'var(--color-ink-muted)', margin: 0 }}>
                          Enter the 6-digit code sent to <strong>{maskedEmail}</strong>.
                        </p>
                        <div>
                          <label style={label}>Verification Code</label>
                          <input
                            className="input-base"
                            type="text"
                            inputMode="numeric"
                            placeholder="000000"
                            value={code}
                            onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setOtpError(''); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleVerify(); }}
                            maxLength={6}
                            style={{ width: '100%', boxSizing: 'border-box', letterSpacing: '0.4em', textAlign: 'center', fontSize: 18 }}
                            autoFocus
                          />
                          {otpError && (
                            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>
                              {otpError}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={handleVerify}
                          disabled={verifying || code.length !== 6}
                          style={primaryBtn(verifying || code.length !== 6)}
                        >
                          {verifying ? 'Verifying...' : 'Verify & Continue'}
                        </button>
                        <button
                          onClick={() => { setStep('roll'); setCode(''); setOtpError(''); }}
                          style={{
                            fontSize: 12, color: 'var(--color-ink-muted)',
                            background: 'none', border: 'none',
                            fontFamily: 'var(--font-body)', cursor: 'pointer',
                          }}
                        >
                          Use a different roll number
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

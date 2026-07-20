import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import { useStudent } from '../context/StudentContext';

// Two-step, OTP-gated email change. The code is sent to the NEW address, and
// student_sessions.email is only updated server-side once the code is verified.
export function ChangeEmailModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { studentSession, updateEmail } = useStudent();
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [masked, setMasked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep('email'); setEmail(''); setCode('');
      setMasked(''); setError(''); setDone(false); setBusy(false);
    }
  }, [open]);

  if (!open || !studentSession) return null;

  const errText = (e: unknown, fallback: string) =>
    (e instanceof Error && e.message && e.message !== 'SESSION_EXPIRED') ? e.message : fallback;

  const sendCode = async () => {
    if (!email.trim().toLowerCase().endsWith('@iitk.ac.in')) return;
    setBusy(true); setError('');
    try {
      const r = await api.students.requestEmailChange(studentSession.rollNumber, email.trim());
      setMasked(r.email); setCode(''); setStep('otp');
    } catch (e) {
      setError(errText(e, 'Could not send the code. Try again.'));
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!/^[0-9]{6}$/.test(code)) return;
    setBusy(true); setError('');
    try {
      const r = await api.students.verifyEmailChange(studentSession.rollNumber, code);
      updateEmail(r.email);
      setDone(true);
      setTimeout(onClose, 1300);
    } catch (e) {
      setError(errText(e, 'Incorrect or expired code.'));
    } finally { setBusy(false); }
  };

  const label = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--color-ink-muted)', letterSpacing: '0.06em',
    textTransform: 'uppercase' as const, marginBottom: 6, fontFamily: 'var(--font-body)',
  };
  const primaryBtn = (disabled: boolean) => ({
    width: '100%', padding: '12px 20px', background: 'var(--color-brand)', color: '#fff',
    border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14, fontWeight: 600,
    fontFamily: 'var(--font-body)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm"
        style={{ background: 'var(--color-surface-1)', borderRadius: 'var(--radius-xxl)', boxShadow: 'var(--shadow-level-2)', padding: '2rem' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="type-headline mb-1">Change Email</h2>
            <p className="type-caption">Current: {studentSession.email}</p>
          </div>
          <button onClick={onClose} className="btn-icon" style={{ width: 32, height: 32 }}>
            <X size={15} />
          </button>
        </div>

        {done ? (
          <p style={{ fontSize: 14, color: 'var(--color-success)', fontFamily: 'var(--font-body)', margin: 0 }}>
            ✓ Email updated.
          </p>
        ) : step === 'email' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={label}>New IITK Email</label>
              <input
                className="input-base"
                type="email"
                placeholder="e.g. yourname23@iitk.ac.in"
                value={email}
                onChange={e => { setEmail(e.target.value.toLowerCase()); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') sendCode(); }}
                style={{ width: '100%', boxSizing: 'border-box' }}
                autoFocus
              />
              {email && !email.endsWith('@iitk.ac.in') && (
                <p style={{ fontSize: 11, color: 'var(--color-error)', margin: '4px 0 0', fontFamily: 'var(--font-body)' }}>
                  Must be an @iitk.ac.in email address
                </p>
              )}
            </div>
            <p className="type-micro" style={{ color: 'var(--color-ink-muted)' }}>
              We'll send a 6-digit code to the new address. Your email changes only after you enter it.
            </p>
            {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{error}</p>}
            <button onClick={sendCode} disabled={busy || !email.endsWith('@iitk.ac.in')} style={primaryBtn(busy || !email.endsWith('@iitk.ac.in'))}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className="type-micro" style={{ color: 'var(--color-ink-muted)', margin: 0 }}>
              Enter the 6-digit code sent to <strong>{masked}</strong>.
            </p>
            <div>
              <label style={label}>Verification Code</label>
              <input
                className="input-base"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={code}
                onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') confirm(); }}
                maxLength={6}
                style={{ width: '100%', boxSizing: 'border-box', letterSpacing: '0.4em', textAlign: 'center', fontSize: 18 }}
                autoFocus
              />
              {error && <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-error)', fontFamily: 'var(--font-body)' }}>{error}</p>}
            </div>
            <button onClick={confirm} disabled={busy || code.length !== 6} style={primaryBtn(busy || code.length !== 6)}>
              {busy ? 'Confirming…' : 'Confirm change'}
            </button>
            <button
              onClick={() => { setStep('email'); setCode(''); setError(''); }}
              style={{ fontSize: 12, color: 'var(--color-ink-muted)', background: 'none', border: 'none', fontFamily: 'var(--font-body)', cursor: 'pointer' }}
            >
              Use a different email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

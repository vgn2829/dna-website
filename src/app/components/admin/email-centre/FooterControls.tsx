import { CREDIT_MAX, SIGNOFF_MAX, footerOf, footerPreview, withFooter, type ComposerState } from '../../../lib/emailCentre';

type SetState = (fn: (s: ComposerState) => ComposerState) => void;

const SIGNOFF_PRESETS = ['All the best!', 'Best regards,', 'Regards,', 'With regards,', 'DNA Coordinators'];

/** Per-email footer controls. Stored in the message's own shellOptions, so they follow the draft and the send. */
export function FooterControls({ state, setState }: { state: ComposerState; setState: SetState }) {
  const f = footerOf(state.shellOptions);
  const prev = footerPreview(state.shellOptions);
  const patch = (p: Partial<typeof f>) => setState(s => ({ ...s, shellOptions: withFooter(s.shellOptions, p) }));
  const row = { display: 'grid', gap: 6, minWidth: 0 } as const;
  const toggle = { display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 500, cursor: 'pointer' } as const;
  return (
    <div data-testid="footer-controls">
      <span className="ec-label">Footer &amp; sign-off</span>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div style={row}>
          <label style={toggle}><input type="checkbox" role="switch" checked={f.showSignoff} onChange={e => patch({ showSignoff: e.target.checked })} /> Show sign-off</label>
          <input className="ec-input" aria-label="Sign-off text" list="ec-signoff-presets" maxLength={SIGNOFF_MAX} value={f.signoff} disabled={!f.showSignoff}
            style={{ opacity: f.showSignoff ? 1 : 0.5 }} onChange={e => patch({ signoff: e.target.value })} />
          <datalist id="ec-signoff-presets">{SIGNOFF_PRESETS.map(p => <option key={p} value={p} />)}</datalist>
        </div>
        <div style={row}>
          <label style={toggle}><input type="checkbox" role="switch" checked={f.showCredit} onChange={e => patch({ showCredit: e.target.checked })} /> Show design credit</label>
          <input className="ec-input" aria-label="Design credit text" maxLength={CREDIT_MAX} value={f.credit} disabled={!f.showCredit}
            style={{ opacity: f.showCredit ? 1 : 0.5 }} onChange={e => patch({ credit: e.target.value })} />
        </div>
      </div>
      <div data-testid="footer-preview" aria-label="Footer preview" style={{ marginTop: 10, background: '#dced3e', color: '#111', borderRadius: 8, padding: '12px 10px', textAlign: 'center', minHeight: 20 }}>
        {prev.signoff && <div data-testid="footer-preview-signoff" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', overflowWrap: 'anywhere' }}>{prev.signoff}</div>}
        {prev.credit && <div data-testid="footer-preview-credit" style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.5px', marginTop: prev.signoff ? 8 : 0, overflowWrap: 'anywhere' }}>{prev.credit}</div>}
        {!prev.signoff && !prev.credit && <div className="ec-hint" style={{ color: '#333' }}>No footer text</div>}
      </div>
      <p className="ec-hint" style={{ marginTop: 6 }}>Applies to this email only. Footer text is shown exactly as typed — it is not personalized.</p>
    </div>
  );
}

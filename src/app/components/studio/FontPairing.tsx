import { useEffect, useState } from 'react';
import catalogue from '../../lib/studio-fonts.json';
import { useStudioDraft, isString } from '../../lib/studio-draft';
import { downloadBlob } from '../background-removal/compositing';
import { StudioRange } from './StudioRange';
type FontId = 'inter' | 'sourceserif4' | 'jetbrainsmono' | 'notosansdevanagari' | 'notoserifdevanagari';
interface Pair { title: string; heading: FontId; body: FontId; headingWeight: number; bodyWeight: number; use: 'Editorial' | 'Product' | 'Technical'; script: 'Latin' | 'Devanagari'; reason: string }
const PAIRS: Pair[] = [
  { title: 'Editorial contrast', heading: 'sourceserif4', body: 'inter', headingWeight: 700, bodyWeight: 400, use: 'Editorial', script: 'Latin', reason: 'A modulated serif headline brings character; a restrained sans body gives captions and navigation a distinct voice.' },
  { title: 'Quiet reading', heading: 'inter', body: 'sourceserif4', headingWeight: 700, bodyWeight: 400, use: 'Editorial', script: 'Latin', reason: 'Compact sans headings establish hierarchy above a serif body suited to longer specimens.' },
  { title: 'Product clarity', heading: 'inter', body: 'inter', headingWeight: 800, bodyWeight: 400, use: 'Product', script: 'Latin', reason: 'One family keeps rhythm consistent. Size and weight supply the hierarchy.' },
  { title: 'Technical notes', heading: 'inter', body: 'jetbrainsmono', headingWeight: 700, bodyWeight: 400, use: 'Technical', script: 'Latin', reason: 'Proportional headings contrast with fixed-width technical detail. Reserve long monospaced passages for appropriate content.' },
  { title: 'Devanagari editorial', heading: 'notoserifdevanagari', body: 'notosansdevanagari', headingWeight: 700, bodyWeight: 400, use: 'Editorial', script: 'Devanagari', reason: 'Both families cover Devanagari and Latin. Serif detail separates headlines from simpler body forms.' },
  { title: 'Devanagari product', heading: 'notosansdevanagari', body: 'notosansdevanagari', headingWeight: 700, bodyWeight: 400, use: 'Product', script: 'Devanagari', reason: 'A shared family maintains script consistency while weight and spacing establish hierarchy.' },
];
const byId = (id: FontId) => catalogue.find(font => font.id === id)!;
export function typographyCss(pair: Pair, size: number) {
  const fonts = [...new Set([pair.heading, pair.body])];
  return `${fonts.map(id => { const font = byId(id); const weights = [pair.heading === id ? pair.headingWeight : 0, pair.body === id ? pair.bodyWeight : 0].filter(Boolean); return `/* ${font.family}: ${font.license}; include ${font.licenseUrl} */\n@font-face { font-family: '${font.family}'; src: url('${font.url}') format('woff2'); font-style: normal; font-weight: ${Math.min(...weights)} ${Math.max(...weights)}; font-display: swap; }`; }).join('\n')}\n\n.studio-heading { font-family: '${byId(pair.heading).family}', serif; font-weight: ${pair.headingWeight}; font-size: ${size}px; line-height: 1.15; }\n.studio-body { font-family: '${byId(pair.body).family}', sans-serif; font-weight: ${pair.bodyWeight}; font-size: 18px; line-height: 1.65; }\n/* Download the font files and licence texts alongside this recipe. Paths above are relative to the DnA site root. */\n`;
}
export function FontPairing() {
  const [use, setUse] = useStudioDraft('font-use', 'All', isString);
  const [script, setScript] = useStudioDraft('font-script', 'Latin', (v): v is string => v === 'Latin' || v === 'Devanagari');
  const [index, setIndex] = useStudioDraft('font-index', 0, (v): v is number => Number.isInteger(v) && Number(v) >= 0);
  const [headline, setHeadline] = useStudioDraft('font-headline', '', isString);
  const [body, setBody] = useStudioDraft('font-body', '', isString);
  const [size, setSize] = useStudioDraft('font-size', 54, (v): v is number => typeof v === 'number' && v >= 24 && v <= 96);
  const [status, setStatus] = useState('Loading fonts…');
  const [retry, setRetry] = useState(0);
  const pool = PAIRS.filter(pair => pair.script === script && (use === 'All' || pair.use === use));
  const pair = pool[index % Math.max(1, pool.length)] || PAIRS.find(p => p.script === script)!;
  useEffect(() => {
    let active = true;
    const faces: FontFace[] = [];
    setStatus('Loading selected families…');
    const timer = setTimeout(() => { if (active) setStatus('Font loading timed out. System fallback is visible; retry when available.'); }, 15000);
    Promise.all([...new Set([pair.heading, pair.body])].map(async id => {
      const font = byId(id);
      const weights = [pair.heading === id ? pair.headingWeight : 0, pair.body === id ? pair.bodyWeight : 0].filter(Boolean);
      const face = new FontFace(font.family, `url("${font.url}")`, { style: 'normal', weight: `${Math.min(...weights)} ${Math.max(...weights)}` });
      faces.push(face); await face.load(); if (active) document.fonts.add(face);
    })).then(() => { if (active) { clearTimeout(timer); setStatus('Selected fonts loaded'); } }).catch(() => { if (active) { clearTimeout(timer); setStatus('Font download failed. System fallback is visible. Retry to load the selected families.'); } });
    return () => { active = false; clearTimeout(timer); faces.forEach(face => document.fonts.delete(face)); };
  }, [pair, retry]);
  const loaded = status === 'Selected fonts loaded';
  const failed = /failed|timed out/i.test(status);
  return <div className="studio-tool">
    <div className="studio-toolbar">
      <label className="studio-field">Use case <select aria-label="Font use case" className="input-base" value={use} onChange={e => { setUse(e.target.value); setIndex(0); }}>{['All', 'Editorial', 'Product', 'Technical'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="studio-field">Script <select aria-label="Font script" className="input-base" value={script} onChange={e => { setScript(e.target.value); setUse('All'); setIndex(0); }}><option>Latin</option><option>Devanagari</option></select></label>
      <button className="btn-secondary" disabled={pool.length < 2} onClick={() => setIndex(value => (value + 1) % pool.length)}>Next pairing</button>
      <span className="studio-help">{pool.length} curated pairings in this selection</span>
    </div>
    {!pool.length && <p role="status" className="studio-notice">No pairing matches this combination. Showing a verified {script} family.</p>}
    <div className="studio-actions studio-status-row">
      <p role="status" className={`studio-status${failed ? ' studio-tone is-warn' : ''}`}>{status}</p>
      {!loaded && <button className="btn-secondary btn-sm" onClick={() => setRetry(v => v + 1)}>Retry fonts</button>}
    </div>
    <article className="studio-card">
      <p className="studio-help">{pair.title} · {pair.use}</p>
      <h2 style={{ fontFamily: `'${byId(pair.heading).family}', serif`, fontWeight: pair.headingWeight, fontSize: size, lineHeight: 1.15, overflowWrap: 'anywhere', fontSynthesis: 'none', margin: '20px 0' }}>{headline || (script === 'Latin' ? 'Design gives ideas a voice.' : 'डिज़ाइन विचारों को आवाज़ देता है।')}</h2>
      <p style={{ fontFamily: `'${byId(pair.body).family}', sans-serif`, fontWeight: pair.bodyWeight, fontSize: 18, lineHeight: 1.65, fontSynthesis: 'none', maxWidth: '65ch' }}>{body || (script === 'Latin' ? 'A useful specimen shows the rhythm of real sentences, punctuation, numerals 0123456789 and the space between ideas. Read it at the size your audience will use.' : 'अच्छा डिज़ाइन स्पष्टता और पढ़ने की सहजता को महत्व देता है। अक्षरों, मात्राओं और शब्दों के बीच का अंतर भी देखें। ०१२३४५६७८९')}</p>
      <p className="studio-help" style={{ marginTop: 16, maxWidth: '75ch' }}>{pair.reason}</p>
    </article>
    <div className="studio-cards">
      {([['Heading', pair.heading, pair.headingWeight], ['Body', pair.body, pair.bodyWeight]] as const).map(([label, id, weight]) => { const font = byId(id); return <div key={label} className="studio-card"><strong>{label}: {font.family}</strong><p>Weight {weight} · {font.scripts.join(', ')}</p><p>x-height {font.xHeightEm ?? 'unavailable'} em · cap-height {font.capHeightEm ?? 'unavailable'} em</p><p className="studio-help">OS/2 metadata, default variable instance. Metrics describe proportions; they do not score visual quality.</p><p><a className="studio-link" href={font.licenseUrl} download>{font.license} licence</a> · <a className="studio-link" href={font.url} download>Font file</a></p></div>; })}
    </div>
    <div className="studio-controls">
      <label className="studio-group"><span className="studio-label">Headline specimen</span><input aria-label="Headline specimen" className="input-base" value={headline} onChange={e => setHeadline(e.target.value)} /></label>
      <label className="studio-group"><span className="studio-label">Body specimen</span><textarea aria-label="Body specimen" className="input-base" style={{ minHeight: 90, resize: 'vertical' }} value={body} onChange={e => setBody(e.target.value)} /></label>
      <StudioRange label="Headline size" ariaLabel="Headline size" min={24} max={96} value={size} suffix="px" onChange={setSize} />
      <div className="studio-actions"><button className="btn-primary" onClick={() => downloadBlob(new Blob([typographyCss(pair, size)], { type: 'text/css' }), 'typography.css')}>Download typography CSS</button></div>
    </div>
    <p className="studio-help">Fonts are self-hosted. This catalogue verifies Latin and Devanagari only; characters outside a selected font’s coverage may use system fallback.</p>
  </div>;
}

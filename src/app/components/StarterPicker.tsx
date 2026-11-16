import { useId } from 'react';
import { STARTER_LAYOUTS, countImageSlots, starterPreview, type StarterColor, type StarterLayout } from '../lib/boardStarters';

// "Start from" picker for the new-board dialog. One selectable card per starter
// layout, each with a small preview drawn from the layout's own data, its use
// case and how many image slots it has. Built on native radio inputs, so it is a
// real radio group: arrow keys move the choice, Tab enters/leaves it, and screen
// readers announce name, description and state. Selecting only records the id;
// the board is created (and the layout applied once, to the empty board) by the
// existing create flow.

const COLORS: Record<StarterColor, string> = {
  black: '#1d1d1d', grey: '#9fa8b2', 'light-violet': '#e085f4', violet: '#ae3ec9', blue: '#4465e9', 'light-blue': '#4ba1f1',
  yellow: '#f1ac4b', orange: '#e16919', green: '#099268', 'light-green': '#4cb05e', 'light-red': '#f87777', red: '#e03131', white: '#ffffff',
};

export function StarterThumbnail({ layout }: { layout: StarterLayout }) {
  const { width, height, items } = starterPreview(layout);
  const stroke = Math.max(width, height) / 220;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${layout.name} layout preview`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      {items.map((it, i) => {
        switch (it.kind) {
          case 'frame': return <rect key={i} x={it.x} y={it.y} width={it.w} height={it.h} rx={stroke * 3} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={stroke} />;
          case 'slot': return <rect key={i} x={it.x} y={it.y} width={it.w} height={it.h} rx={stroke * 2} fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.5} strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />;
          case 'swatch': return <rect key={i} x={it.x} y={it.y} width={it.w} height={it.h} rx={stroke * 2} fill={COLORS[it.color ?? 'grey']} />;
          case 'note': return <rect key={i} x={it.x} y={it.y} width={it.w} height={it.h} rx={stroke * 2} fill={COLORS[it.color ?? 'yellow']} fillOpacity={0.8} />;
          default: return <rect key={i} x={it.x} y={it.y + it.h * 0.3} width={it.w} height={it.h * 0.35} rx={stroke} fill="currentColor" fillOpacity={0.7} />;
        }
      })}
    </svg>
  );
}

const BLANK = { id: '', name: 'Blank board', useCase: 'An empty canvas', description: 'Start with nothing — draw, drop images and arrange freely.' };

export function StarterPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const name = `starter-${useId()}`;
  const selected = STARTER_LAYOUTS.find(l => l.id === value) ?? null;
  const description = selected?.description ?? BLANK.description;
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="type-caption" style={{ marginBottom: 6, padding: 0 }}>Start from</legend>
      <div className="starter-grid">
        {[BLANK, ...STARTER_LAYOUTS].map(layout => {
          const full = 'shapes' in layout ? (layout as StarterLayout) : null;
          const on = value === layout.id;
          const slots = full ? countImageSlots(full.shapes) : 0;
          return (
            <label key={layout.id || 'blank'} className="starter-card" data-selected={on ? 'true' : undefined}>
              <input type="radio" name={name} value={layout.id} checked={on} onChange={() => onChange(layout.id)} className="starter-radio" />
              <span className="starter-thumb" aria-hidden={full ? undefined : true}>
                {full ? <StarterThumbnail layout={full} /> : <span className="type-micro">Empty</span>}
              </span>
              <span className="starter-name">{layout.name}</span>
              <span className="type-micro starter-use">{layout.useCase}{full ? ` · ${slots} image slot${slots === 1 ? '' : 's'}` : ''}</span>
            </label>
          );
        })}
      </div>
      <p className="type-micro" role="status" aria-live="polite" style={{ margin: '8px 0 0' }}>
        <strong>{selected?.name ?? BLANK.name}:</strong> {description}
      </p>
    </fieldset>
  );
}

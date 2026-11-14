import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import {
  OPERATOR_LABELS, needsValue, newRule, operatorsFor,
  type Condition, type FieldType, type Operator, type Rule,
} from '../../../lib/emailCentre';

export interface FieldOption { name: string; label: string }

export interface ConditionContext {
  fields: FieldOption[];
  operators: Operator[];
  typeOf: (field: string) => FieldType;
  /** Distinct values seen for a field in the audience — offered as suggestions, any text is still allowed. */
  valuesOf: (field: string) => string[];
}

/**
 * Visual, code-free condition editor: pick a field, an operator that fits its data type, and a value.
 * Produces plain data ({match, rules}) — the server evaluates it against an allow-list of operators.
 */
export function ConditionBuilder({ value, onChange, ctx, compact }: { value: Condition; onChange: (c: Condition) => void; ctx: ConditionContext; compact?: boolean }) {
  const uid = useId();
  const setRule = (i: number, patch: Partial<Rule>) => onChange({ ...value, rules: value.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      {value.rules.map((r, i) => {
        const type = ctx.typeOf(r.field);
        const ops = operatorsFor(type, ctx.operators);
        const listId = `${uid}-vals-${i}`;
        const suggestions = ctx.valuesOf(r.field);
        const isList = r.op === 'one_of';
        return (
          <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <span className="ec-hint" style={{ width: compact ? 'auto' : 34, textTransform: 'uppercase', fontWeight: 600 }}>
              {i === 0 ? 'If' : (
                <select aria-label="Combine conditions with" className="ec-mini" value={value.match} onChange={e => onChange({ ...value, match: e.target.value as 'all' | 'any' })}>
                  <option value="all">and</option><option value="any">or</option>
                </select>
              )}
            </span>
            <input aria-label="Field" list={`${uid}-fields`} className="ec-mini" style={{ width: 150 }} placeholder="field" value={r.field}
              onChange={e => setRule(i, { field: e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
            <select aria-label="Operator" className="ec-mini" value={ops.includes(r.op) ? r.op : 'equals'} onChange={e => {
              const op = e.target.value as Operator;
              // The server accepts a comma-separated string for "is one of", so the value stays plain text while typing.
              setRule(i, { op, value: needsValue(op) ? (Array.isArray(r.value) ? r.value.join(', ') : r.value ?? '') : undefined });
            }}>
              {ops.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
            </select>
            {needsValue(r.op) && (
              <>
                <input aria-label={isList ? 'Values, comma separated' : 'Value'} list={isList ? undefined : listId} className="ec-mini" style={{ width: 160 }}
                  placeholder={isList ? 'a, b, c' : 'value'} inputMode={type === 'number' && !isList ? 'decimal' : undefined}
                  value={Array.isArray(r.value) ? r.value.join(', ') : r.value ?? ''} onChange={e => setRule(i, { value: e.target.value })} />
                {!isList && <datalist id={listId}>{suggestions.map(s => <option key={s} value={s} />)}</datalist>}
              </>
            )}
            {value.rules.length > 1 && (
              <button type="button" className="ec-tb" aria-label="Remove condition" onClick={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })}><X size={13} /></button>
            )}
          </div>
        );
      })}
      <datalist id={`${uid}-fields`}>{ctx.fields.map(f => <option key={f.name} value={f.name}>{f.label}</option>)}</datalist>
      {value.rules.length < 10 && (
        <button type="button" className="ec-tb" style={{ alignSelf: 'flex-start', color: 'var(--color-accent-blue)' }} onClick={() => onChange({ ...value, rules: [...value.rules, newRule(ctx.fields[0]?.name ?? '')] })}>
          <Plus size={13} /> Add condition
        </button>
      )}
    </div>
  );
}

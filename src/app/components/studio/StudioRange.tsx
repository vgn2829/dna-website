import { useId, type CSSProperties } from "react";
// Shared Design Studio range: a native <input type="range"> with a visible
// label and a fixed-width tabular readout, so dragging never reflows the
// panel. Keyboard, pointer and change semantics are the browser's own.
export function StudioRange({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
  disabled,
  ariaLabel,
  id,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Overrides the accessible name when it must differ from the visible label. */
  ariaLabel?: string;
  id?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const progress =
    max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <div className="studio-range">
      <div className="studio-range-head">
        <label htmlFor={inputId}>{label}</label>
        <output htmlFor={inputId} className="studio-value">
          {value}
          {suffix}
        </output>
      </div>
      <input
        id={inputId}
        className="studio-range-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{ "--studio-range-progress": `${progress}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

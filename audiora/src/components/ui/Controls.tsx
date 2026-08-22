import { useId, type ReactNode } from 'react';
import { Info, Lock } from 'lucide-react';

/* -------------------------------------------------------------- select --- */

export interface Option<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Shown as a title tooltip when the option is disabled. */
  reason?: string;
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
  disabled,
}: {
  label?: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const isNumeric = typeof value === 'number';
  return (
    <div>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <select
        id={id}
        className="field"
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange((isNumeric ? Number(event.target.value) : event.target.value) as T)}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
            {option.label}
            {option.disabled && option.reason ? ' — unavailable' : ''}
          </option>
        ))}
      </select>
      {hint && (
        <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>{hint}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- slider --- */

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  disabled,
  ticks,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
  ticks?: number[];
}) {
  const id = useId();
  return (
    <div>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <label className="field-label" htmlFor={id} style={{ marginBottom: 4 }}>
            {label}
          </label>
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--brand)' }}>
            {format ? format(value) : value}
          </span>
        </div>
      )}
      <input
        id={id}
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        aria-valuetext={format ? format(value) : String(value)}
      />
      {ticks && (
        <div
          className="mono"
          style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-dim)', marginTop: -2 }}
        >
          {ticks.map((tick) => (
            <span key={tick}>{tick > 0 ? `+${tick}` : tick}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- toggle --- */

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-on={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * One row of a settings panel: label (+ optional tooltip) on the left, control
 * on the right. When `lockedReason` is set the row is disabled and states why —
 * this is how the app refuses to pretend a capability exists.
 */
export function SettingRow({
  label,
  hint,
  lockedReason,
  children,
}: {
  label: string;
  hint?: string;
  lockedReason?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '11px 0',
        opacity: lockedReason ? 0.62 : 1,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600 }}>
          {label}
          {lockedReason ? (
            <Lock size={12} style={{ color: 'var(--text-dim)' }} aria-hidden="true" />
          ) : (
            hint && (
              <span title={hint} style={{ display: 'inline-flex', color: 'var(--text-dim)', cursor: 'help' }}>
                <Info size={12.5} aria-hidden="true" />
                <span className="sr-only">{hint}</span>
              </span>
            )
          )}
        </div>
        {lockedReason && (
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.45, maxWidth: 380 }}>
            {lockedReason}
          </div>
        )}
      </div>
      <div style={{ flex: 'none' }}>{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------- segmented --- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{
        display: 'inline-flex',
        padding: 4,
        gap: 3,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-pill)',
        maxWidth: '100%',
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            style={{
              minHeight: size === 'sm' ? 32 : 38,
              padding: size === 'sm' ? '0 12px' : '0 18px',
              borderRadius: 'var(--r-pill)',
              border: 0,
              cursor: 'pointer',
              fontSize: size === 'sm' ? 12.5 : 13.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: active ? 'var(--brand)' : 'transparent',
              color: active ? '#fff' : 'var(--text-muted)',
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
              transition: 'background 0.18s ease, color 0.18s ease',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- choices --- */

/** Radio cards — used for AI model / quality pickers. */
export function ChoiceCards<T extends string>({
  value,
  options,
  onChange,
  label,
  columns = 3,
}: {
  value: T;
  options: { value: T; label: string; hint?: string; badge?: string; disabled?: boolean; reason?: string }[];
  onChange: (value: T) => void;
  label: string;
  columns?: number;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${columns >= 3 ? 150 : 190}px, 1fr))`, gap: 10 }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.disabled ? option.reason : option.hint}
            onClick={() => onChange(option.value)}
            style={{
              textAlign: 'left',
              padding: '13px 14px',
              minHeight: 64,
              borderRadius: 'var(--r)',
              cursor: option.disabled ? 'not-allowed' : 'pointer',
              opacity: option.disabled ? 0.55 : 1,
              background: active ? 'var(--brand-soft)' : 'var(--surface)',
              border: `1.5px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
              transition: 'all 0.18s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: active ? 'var(--brand)' : 'var(--text)' }}>
                {option.label}
              </span>
              {option.badge && <span className="badge badge-pro">{option.badge}</span>}
            </div>
            {(option.hint || option.reason) && (
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.45 }}>
                {option.disabled ? option.reason : option.hint}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- fields --- */

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  autoComplete,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  error?: string | null;
  autoComplete?: string;
  required?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--err)' }}> *</span>}
      </label>
      <input
        id={id}
        className="field"
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(event) => onChange(event.target.value)}
        style={error ? { borderColor: 'var(--err)' } : undefined}
      />
      {error && (
        <p id={`${id}-err`} role="alert" style={{ fontSize: 12, color: 'var(--err)', marginTop: 6 }}>
          {error}
        </p>
      )}
      {!error && hint && <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

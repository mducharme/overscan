import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

/** Small component kit for the studio. Native elements underneath, so keyboard and screen readers work. */

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger'

export function Button({
  variant = 'default',
  icon = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: boolean }) {
  const classes = ['ui-button', variant !== 'default' && `ui-button--${variant}`, icon && 'ui-button--icon', className]
  return <button type="button" className={classes.filter(Boolean).join(' ')} {...rest} />
}

export interface ToggleOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

/** One-of-many buttons (e.g. the renderer switch). */
export function ToggleGroup<T extends string>({ options, value, onChange, label }: {
  options: readonly ToggleOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="ui-toggle-group" role="group" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" title={option.title} aria-pressed={option.value === value} onClick={() => { onChange(option.value) }}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Number input that commits on Enter or blur, so typing "0.5" never sends "0." to the engine.
 * Escape restores the last committed value.
 */
export function NumberField({ value, onCommit, min, max, step, mono = true, ...aria }: {
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
  mono?: boolean
  'aria-label'?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const parsed = Number(draft)
  const valid = draft.trim() !== '' && Number.isFinite(parsed)
  const commit = (): void => {
    if (!valid) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <input
      className={`ui-input${mono ? ' ui-input--mono' : ''}`}
      inputMode="decimal"
      value={draft}
      step={step}
      aria-invalid={!valid}
      aria-label={aria['aria-label']}
      onChange={event => { setDraft(event.target.value) }}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setDraft(String(value))
      }}
    />
  )
}

/** Range slider with an exact number box next to it. */
export function Slider({ value, onChange, min, max, step = 0.01, label }: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  label: string
}) {
  return (
    <div className="ui-slider">
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={event => { onChange(Number(event.target.value)) }} />
      <NumberField aria-label={label} value={value} min={min} max={max} step={step} onCommit={onChange} />
    </div>
  )
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Colour swatch plus hex text. */
export function ColorField({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const swatch = HEX_RE.test(value) ? (value.length === 4 ? `#${Array.from(value.slice(1), c => c + c).join('')}` : value) : '#000000'
  return (
    <div className="ui-color">
      <input type="color" aria-label={label} value={swatch} onChange={event => { onChange(event.target.value) }} />
      <input
        className="ui-input ui-input--mono"
        aria-label={`${label} hex`}
        aria-invalid={!HEX_RE.test(draft)}
        value={draft}
        onChange={event => { setDraft(event.target.value) }}
        onBlur={() => { if (HEX_RE.test(draft)) onChange(draft); else setDraft(value) }}
        onKeyDown={event => { if (event.key === 'Enter' && HEX_RE.test(draft)) onChange(draft) }}
      />
    </div>
  )
}

export function Select<T extends string>({ value, options, onChange, label }: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <select className="ui-select" aria-label={label} value={value} onChange={event => { onChange(event.target.value as T) }}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

/** Label + control + optional help line. */
export function Field({ label, help, children }: { label: string; help?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>{label}</label>
      {children(id)}
      {help && <div className="ui-field__help">{help}</div>}
    </div>
  )
}

export function Panel({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ui-panel${className ? ` ${className}` : ''}`}>
      <header className="ui-panel__header">
        <h2 className="ui-panel__title">{title}</h2>
        {actions && <div className="ui-panel__actions">{actions}</div>}
      </header>
      <div className="ui-panel__body">{children}</div>
    </section>
  )
}

export function Notice({ kind, children }: { kind: 'error' | 'warning'; children: ReactNode }) {
  return <div className={`ui-notice ui-notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>
}

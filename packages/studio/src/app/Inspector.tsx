import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NODE_SCHEMAS, validateNodeConfig, type NumberParam, type ParamSchema } from '@overscan/nodes/browser'
import { bindingOf } from '../engine/graph-model'
import type { PlayerSection } from '../engine/player'
import { rowsPerSecond, TrackSampler } from '../engine/timeline'
import { Button, ColorField, NumberField, Select, Slider } from '../ui/kit'
import { useFocusSection, useStudio, useStudioStore } from './studio-context'

type SetValue = (value: unknown) => void

/** Live context every control may need: the section, its tracks and the current rocket row. */
interface ParamContext {
  section: PlayerSection
  sampler: TrackSampler
  row: number
}

/**
 * Edits the selected node's settings, one control per schema option. Changes go straight into the scene
 * file's text (formatting kept) and the preview; ↺ removes an option so its default applies again.
 */
export function Inspector() {
  const store = useStudioStore()
  const section = useFocusSection()
  const nodeId = useStudio(s => s.selectedNodeId)
  const time = useStudio(s => s.time)
  const node = section?.scene.graph.nodes.find(n => n.id === nodeId)
  const sampler = useMemo(() => (section ? new TrackSampler(section.scene.tracks) : null), [section])
  if (!section || !node || !sampler) return null

  const schema = NODE_SCHEMAS[node.impl]
  const problems = schema ? validateNodeConfig(schema, node.config) : []
  const problemKeys = new Set(problems.map(p => p.key.split(/[.[]/)[0]))
  const ctx: ParamContext = { section, sampler, row: Math.max(0, time - section.start) * rowsPerSecond(section.scene.bpm, section.scene.rowsPerBeat) }
  const known = schema ? Object.keys(schema.params) : []
  const extra = Object.keys(node.config).filter(k => !known.includes(k) && !schema?.deprecated?.includes(k))
  const set = (key: string): SetValue => value => { store.getState().setNodeParam(section.scenePath, node.id, key, value) }

  return (
    <section className="details" aria-label={`Inspector: ${node.id}`}>
      <header className="details__header">
        <div>
          <div className="details__title">{node.id}</div>
          <div className="details__subtitle">{schema?.label ?? node.impl} · {node.type}</div>
        </div>
        <Button variant="ghost" title="Close (Esc)" onClick={() => { store.getState().selectNode(null) }}>✕</Button>
      </header>
      {schema && <p className="details__description">{schema.description}</p>}
      {problems.length > 0 && (
        <ul className="details__problems">
          {problems.map(p => <li key={`${p.key}:${p.message}`}><code>{p.key}</code>: {p.message}</li>)}
        </ul>
      )}
      <div className="details__params">
        {known.map(key => {
          const param = schema!.params[key]!
          const isSet = Object.prototype.hasOwnProperty.call(node.config, key)
          return (
            <ParamRow key={key} name={key} description={param.description} isSet={isSet} problem={problemKeys.has(key)} onReset={() => { set(key)(undefined) }}>
              <ParamControl name={key} schema={param} value={isSet ? node.config[key] : defaultOf(param)} set={set(key)} ctx={ctx} />
            </ParamRow>
          )
        })}
        {extra.map(key => (
          <ParamRow key={key} name={key} description="Not a setting this node knows; it has no effect." isSet problem onReset={() => { set(key)(undefined) }} resetLabel="Remove">
            <JsonInput value={node.config[key]} onCommit={set(key)} label={key} />
          </ParamRow>
        ))}
      </div>
    </section>
  )
}

const defaultOf = (param: ParamSchema): unknown => ('default' in param ? param.default : undefined)

function ParamRow({ name, description, isSet, problem, onReset, resetLabel = 'Reset to default', children }: {
  name: string
  description: string
  isSet: boolean
  problem: boolean
  onReset: () => void
  resetLabel?: string
  children: ReactNode
}) {
  return (
    <div className={`param${isSet ? ' param--set' : ''}${problem ? ' param--problem' : ''}`}>
      <div className="param__label" title={description}>
        <span>{name}</span>
        {isSet && <button type="button" className="param__reset" title={resetLabel} aria-label={`${resetLabel}: ${name}`} onClick={onReset}>↺</button>}
      </div>
      <div className="param__control">{children}</div>
    </div>
  )
}

function ParamControl({ name, schema, value, set, ctx }: { name: string; schema: ParamSchema; value: unknown; set: SetValue; ctx: ParamContext }) {
  switch (schema.type) {
    case 'number':
      return <AnimatableNumber name={name} schema={schema} value={value} set={set} ctx={ctx} />
    case 'integer':
      return <PlainNumber name={name} value={value} min={schema.min} max={schema.max} step={1} set={set} />
    case 'boolean':
      return (
        <label className="param__toggle">
          <input type="checkbox" checked={value === true} onChange={event => { set(event.target.checked) }} />
          <span>{value === true ? 'On' : 'Off'}</span>
        </label>
      )
    case 'enum':
      return <EnumControl name={name} options={schema.options} open={schema.open === true} value={value} set={set} />
    case 'string':
      return <TextInput value={typeof value === 'string' ? value : ''} multiline={schema.multiline === true} onCommit={set} label={name} />
    case 'asset':
      return <TextInput value={typeof value === 'string' ? value : ''} onCommit={v => { set(v === '' ? undefined : v) }} label={name} placeholder={`${schema.kind} path or URL`} />
    case 'color':
      return <ColorControl name={name} value={value} allow={schema.allow ?? []} set={set} />
    case 'palette':
      return <PaletteControl name={name} value={value} set={set} />
    case 'vec2':
    case 'vec3':
      return <VectorControl name={name} size={schema.type === 'vec2' ? 2 : 3} value={value} set={set} ctx={ctx} />
    case 'json':
      return <JsonInput value={value} onCommit={set} label={name} />
  }
}

/** A number that can also follow a rocket track or another node's output. */
function AnimatableNumber({ name, schema, value, set, ctx }: { name: string; schema: NumberParam; value: unknown; set: SetValue; ctx: ParamContext }) {
  const binding = bindingOf(value)
  const tracks = ctx.section.scene.tracks.map(t => t.name)
  const outputs = signalOutputs(ctx.section)
  const current = (): number => (typeof value === 'number' ? value : binding?.kind === 'track' ? ctx.sampler.valueAt(binding.track, ctx.row) : schema.default)
  const mode = binding?.kind ?? 'value'
  const modes = [
    { value: 'value', label: 'Value' },
    ...(schema.animatable && tracks.length ? [{ value: 'track', label: 'Track' }] : []),
    ...(schema.animatable && outputs.length ? [{ value: 'node', label: 'Node' }] : []),
  ]
  return (
    <div className="param__animatable">
      {modes.length > 1 && (
        <Select
          label={`${name} source`}
          value={mode}
          options={modes}
          onChange={next => {
            if (next === 'value') set(Number(current().toFixed(4)))
            else if (next === 'track') set({ track: binding?.kind === 'track' ? binding.track : pickTrack(tracks, name) })
            else set({ node: outputs[0]!.node, output: outputs[0]!.output })
          }}
        />
      )}
      {mode === 'value' && <PlainNumber name={name} value={value} min={schema.min} max={schema.max} step={schema.step} set={set} slider />}
      {binding?.kind === 'track' && (
        <>
          <Select label={`${name} track`} value={binding.track} options={withMissing(tracks, binding.track)} onChange={track => { set({ track }) }} />
          <span className="param__live" title="Current value">{formatNumber(ctx.sampler.valueAt(binding.track, ctx.row))}</span>
        </>
      )}
      {binding?.kind === 'node' && (
        <Select
          label={`${name} node output`}
          value={`${binding.node}.${binding.output}`}
          options={withMissing(outputs.map(o => `${o.node}.${o.output}`), `${binding.node}.${binding.output}`)}
          onChange={ref => {
            const dot = ref.indexOf('.')
            set({ node: ref.slice(0, dot), output: ref.slice(dot + 1) })
          }}
        />
      )}
    </div>
  )
}

/** Track named after the option if there is one (e.g. `zoom` → `lens.zoom`), else the first. */
const pickTrack = (tracks: string[], option: string): string =>
  tracks.find(t => t === option || t.endsWith(`.${option}`)) ?? tracks[0]!

const withMissing = (values: string[], current: string): { value: string; label: string }[] =>
  [...(values.includes(current) ? values : [...values, current])].map(v => ({ value: v, label: values.includes(v) ? v : `${v} (missing)` }))

/** Outputs of the scene's signal nodes, which numbers can follow. */
function signalOutputs(section: PlayerSection): { node: string; output: string }[] {
  return section.scene.graph.nodes
    .filter(n => n.type === 'signal')
    .flatMap(n => (NODE_SCHEMAS[n.impl]?.outputs ?? ['value']).map(output => ({ node: n.id, output })))
}

function PlainNumber({ name, value, min, max, step, set, slider = false }: {
  name: string
  value: unknown
  min?: number
  max?: number
  step?: number
  set: SetValue
  slider?: boolean
}) {
  const v = typeof value === 'number' ? value : 0
  if (slider && min !== undefined && max !== undefined) {
    // Values outside the suggested range stay reachable: the slider widens to include them.
    return <Slider label={name} value={v} min={Math.min(min, v)} max={Math.max(max, v)} step={step ?? niceStep(min, max)} onChange={set} />
  }
  return <NumberField aria-label={name} value={v} min={min} max={max} step={step} onCommit={set} />
}

const niceStep = (min: number, max: number): number => {
  const span = max - min
  return span <= 1 ? 0.001 : span <= 10 ? 0.01 : span <= 100 ? 0.1 : 1
}

function EnumControl({ name, options, open, value, set }: { name: string; options: readonly string[]; open: boolean; value: unknown; set: SetValue }) {
  const current = typeof value === 'string' ? value : ''
  const custom = !options.includes(current)
  return (
    <div className="param__row">
      <Select
        label={name}
        value={custom ? '__custom__' : current}
        options={[...options.map(o => ({ value: o, label: o })), ...(open || custom ? [{ value: '__custom__', label: open ? 'Custom…' : `${current} (unknown)` }] : [])]}
        onChange={next => { if (next !== '__custom__') set(next) }}
      />
      {open && custom && <TextInput value={current} onCommit={set} label={`${name} custom`} />}
    </div>
  )
}

function ColorControl({ name, value, allow, set }: { name: string; value: unknown; allow: readonly string[]; set: SetValue }) {
  const current = typeof value === 'string' ? value : '#000000'
  const keyword = allow.includes(current) ? current : null
  if (allow.length === 0) return <ColorField label={name} value={current} onChange={set} />
  return (
    <div className="param__row">
      <Select
        label={`${name} kind`}
        value={keyword ?? '__hex__'}
        options={[{ value: '__hex__', label: 'Colour' }, ...allow.map(a => ({ value: a, label: a === '' ? '(none)' : a }))]}
        onChange={next => { set(next === '__hex__' ? '#ffffff' : next) }}
      />
      {keyword === null && <ColorField label={name} value={current} onChange={set} />}
    </div>
  )
}

type Rgb = [number, number, number]
const toHex = ([r, g, b]: Rgb): string => `#${[r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`
const fromHex = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb

function PaletteControl({ name, value, set }: { name: string; value: unknown; set: SetValue }) {
  const colors = (Array.isArray(value) ? value : []).filter((c): c is Rgb => Array.isArray(c) && c.length >= 3)
  return (
    <div className="param__palette-edit">
      {colors.map((c, i) => (
        <span key={i} className="param__swatch">
          <input
            type="color"
            aria-label={`${name} colour ${i + 1}`}
            value={toHex(c)}
            onChange={event => { set(colors.map((x, j) => (j === i ? fromHex(event.target.value) : x))) }}
          />
          {colors.length > 2 && (
            <button type="button" title="Remove colour" aria-label={`Remove ${name} colour ${i + 1}`} onClick={() => { set(colors.filter((_, j) => j !== i)) }}>×</button>
          )}
        </span>
      ))}
      <Button variant="ghost" title="Add a colour" onClick={() => { set([...colors, colors.at(-1) ?? [255, 255, 255]]) }}>+</Button>
    </div>
  )
}

function VectorControl({ name, size, value, set, ctx }: { name: string; size: 2 | 3; value: unknown; set: SetValue; ctx: ParamContext }) {
  const items = Array.from({ length: size }, (_, i) => (Array.isArray(value) ? value[i] : 0) as unknown)
  const update = (i: number, v: unknown): void => { set(items.map((x, j) => (j === i ? v : x))) }
  return (
    <div className="param__vector">
      {items.map((item, i) => {
        const binding = bindingOf(item)
        const axis = 'xyz'[i]!
        if (binding) {
          const live = binding.kind === 'track' ? ctx.sampler.valueAt(binding.track, ctx.row) : 0
          return (
            <button
              key={axis}
              type="button"
              className="param__bound"
              title={`${axis} follows ${binding.kind === 'track' ? `track ${binding.track}` : `${binding.node}.${binding.output}`}; click to use a fixed value`}
              onClick={() => { update(i, Number(live.toFixed(4))) }}
            >
              ↻ {binding.kind === 'track' ? binding.track : `${binding.node}.${binding.output}`}
            </button>
          )
        }
        return <NumberField key={axis} aria-label={`${name} ${axis}`} value={typeof item === 'number' ? item : 0} onCommit={v => { update(i, v) }} />
      })}
    </div>
  )
}

/** Text that commits on Enter (single line) or blur. */
function TextInput({ value, onCommit, label, multiline = false, placeholder }: {
  value: string
  onCommit: (value: string) => void
  label: string
  multiline?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = (): void => { if (draft !== value) onCommit(draft) }
  return multiline
    ? <textarea className="ui-input param__textarea" aria-label={label} value={draft} rows={3} onChange={e => { setDraft(e.target.value) }} onBlur={commit} />
    : (
      <input
        className="ui-input"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={e => { setDraft(e.target.value) }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(value)
        }}
      />
    )
}

/** Raw JSON for structured options; invalid JSON is flagged and not applied. */
function JsonInput({ value, onCommit, label }: { value: unknown; onCommit: SetValue; label: string }) {
  const text = value === undefined ? '' : JSON.stringify(value)
  const [draft, setDraft] = useState(text)
  useEffect(() => { setDraft(text) }, [text])
  let parsed: unknown
  let valid = true
  try { parsed = draft.trim() === '' ? undefined : JSON.parse(draft) } catch { valid = false }
  return (
    <textarea
      className="ui-input ui-input--mono param__textarea"
      aria-label={label}
      aria-invalid={!valid}
      rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 40)))}
      value={draft}
      onChange={e => { setDraft(e.target.value) }}
      onBlur={() => { if (valid && draft !== text) onCommit(parsed) }}
    />
  )
}

const formatNumber = (v: number): string => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3))

import { useMemo } from 'react'
import type { SceneNode } from '@overscan/types'
import { NODE_SCHEMAS, validateNodeConfig, type ParamSchema } from '@overscan/nodes/browser'
import { bindingOf } from '../engine/graph-model'
import { rowsPerSecond, TrackSampler } from '../engine/timeline'
import { Button } from '../ui/kit'
import { useFocusSection, useStudio, useStudioStore } from './studio-context'

/**
 * Read-only view of the selected node: what it is, every setting (set, default or bound), and any
 * config problems. Phase 4 turns this into the editable inspector.
 */
export function NodeDetails() {
  const store = useStudioStore()
  const section = useFocusSection()
  const nodeId = useStudio(s => s.selectedNodeId)
  const time = useStudio(s => s.time)
  const node = section?.scene.graph.nodes.find(n => n.id === nodeId)
  const sampler = useMemo(() => (section ? new TrackSampler(section.scene.tracks) : null), [section])
  if (!section || !node) return null

  const schema = NODE_SCHEMAS[node.impl]
  const problems = schema ? validateNodeConfig(schema, node.config) : []
  const problemKeys = new Set(problems.map(p => p.key.split(/[.[]/)[0]))
  const row = (Math.max(0, time - section.start)) * rowsPerSecond(section.scene.bpm, section.scene.rowsPerBeat)
  const known = schema ? Object.keys(schema.params) : []
  const extra = Object.keys(node.config).filter(k => !known.includes(k) && !schema?.deprecated?.includes(k))

  return (
    <section className="details" aria-label={`Node ${node.id}`}>
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
      <dl className="details__params">
        {known.map(key => (
          <Param key={key} name={key} schema={schema!.params[key]} node={node} sampler={sampler} row={row} problem={problemKeys.has(key)} />
        ))}
        {extra.map(key => (
          <Param key={key} name={key} node={node} sampler={sampler} row={row} problem />
        ))}
      </dl>
    </section>
  )
}

function Param({ name, schema, node, sampler, row, problem }: {
  name: string
  schema?: ParamSchema
  node: SceneNode
  sampler: TrackSampler | null
  row: number
  problem: boolean
}) {
  const set = Object.prototype.hasOwnProperty.call(node.config, name)
  const value = set ? node.config[name] : schema && 'default' in schema ? schema.default : undefined
  const binding = bindingOf(value)
  return (
    <div className={`param${set ? '' : ' param--default'}${problem ? ' param--problem' : ''}`} title={schema?.description ?? 'Not a known setting for this node'}>
      <dt>{name}</dt>
      <dd>
        {binding?.kind === 'track' && (
          <span className="param__binding">
            ↻ <code>{binding.track}</code> <span className="param__live">{sampler ? formatNumber(sampler.valueAt(binding.track, row)) : ''}</span>
          </span>
        )}
        {binding?.kind === 'node' && <span className="param__binding">← <code>{binding.node}.{binding.output}</code></span>}
        {!binding && <ParamValue value={value} schema={schema} />}
      </dd>
    </div>
  )
}

function ParamValue({ value, schema }: { value: unknown; schema: ParamSchema | undefined }) {
  if (value === undefined) return <span className="param__none">—</span>
  if (schema?.type === 'color' && typeof value === 'string' && value.startsWith('#')) {
    return <span className="param__color"><i style={{ background: value }} />{value}</span>
  }
  if (schema?.type === 'palette' && Array.isArray(value)) {
    return (
      <span className="param__palette">
        {(value as unknown[]).map((c, i) => (Array.isArray(c) ? <i key={i} style={{ background: `rgb(${c.slice(0, 3).join(',')})` }} /> : null))}
      </span>
    )
  }
  if (typeof value === 'number') return <code>{formatNumber(value)}</code>
  if (typeof value === 'string') return <code className="param__string">{value === '' ? '""' : value}</code>
  if (typeof value === 'boolean') return <code>{value ? 'on' : 'off'}</code>
  if (Array.isArray(value) && value.every(v => typeof v === 'number' || bindingOf(v))) {
    return <code>[{value.map(v => (typeof v === 'number' ? formatNumber(v) : `↻${bindingOf(v)?.kind === 'track' ? (v as { track: string }).track : '…'}`)).join(', ')}]</code>
  }
  const json = JSON.stringify(value)
  return <code className="param__json" title={JSON.stringify(value, null, 2)}>{json.length > 60 ? `${json.slice(0, 57)}…` : json}</code>
}

const formatNumber = (v: number): string => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3).replace(/0+$/, ''))

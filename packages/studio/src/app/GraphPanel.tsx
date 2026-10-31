import { memo, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlowProvider,
  useReactFlow,
  useStore as useFlowStore,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { NODE_SCHEMAS, validateNodeConfig } from '@overscan/nodes/browser'
import { buildGraphModel, handleId, NODE_HEIGHT, NODE_WIDTH, OUTPUT_NODE_ID, type GraphModel, type GraphModelNode } from '../engine/graph-model'
import { useFocusSection, useStudio, useStudioStore } from './studio-context'

interface NodeData {
  model: GraphModelNode
  inactive: boolean
}

const KIND_LABEL: Record<GraphModelNode['kind'], string> = {
  generator: 'Generator',
  modifier: 'Modifier',
  compositor: 'Compositor',
  signal: 'Signal',
  output: 'Output',
}

const StudioNode = memo(function StudioNode({ data }: NodeProps<NodeData>) {
  const { model, inactive } = data
  return (
    <div
      className={`gnode gnode--${model.kind}${inactive ? ' gnode--inactive' : ''}${model.problems.length ? ' gnode--problem' : ''}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      title={model.problems.map(p => `${p.key}: ${p.message}`).join('\n') || undefined}
    >
      <span className="gnode__id">{model.kind === 'output' ? 'Output' : model.id}</span>
      <span className="gnode__kind">{model.kind === 'output' ? model.outputFor.join(' · ') : `${model.label} · ${KIND_LABEL[model.kind]}`}</span>
      <span className="gnode__badges">
        {model.bindingCount > 0 && <span className="gnode__badge" title={`Animated values: ${model.tracks.join(', ') || 'node outputs'}`}>↻{model.bindingCount}</span>}
        {model.problems.length > 0 && <span className="gnode__badge gnode__badge--problem">⚠{model.problems.length}</span>}
        {(model.startTime !== undefined || model.endTime !== undefined) && (
          <span className="gnode__badge" title="Only active during this time window">{model.startTime ?? 0}–{model.endTime ?? '∞'}s</span>
        )}
      </span>
      {/* Config values bound to other nodes' outputs arrive on the left. */}
      {model.kind !== 'output' && (
        <Handle type="target" id={handleId.bindings} position={Position.Left} className="ghandle ghandle--bind" isConnectable={false} />
      )}
      {model.inputs.map((name, i) => (
        <Handle
          key={`in-${name}`}
          type="target"
          id={handleId.input(name)}
          position={Position.Top}
          style={{ left: spread(i, model.inputs.length) }}
          className="ghandle"
          title={name}
        >
          {model.inputs.length > 1 && <span className="ghandle__label">{name}</span>}
        </Handle>
      ))}
      {model.outputs.map((name, i) => (
        <Handle
          key={`out-${name}`}
          type="source"
          id={handleId.output(name)}
          position={Position.Bottom}
          style={{ left: spread(i, model.outputs.length) }}
          className="ghandle"
          // Signal outputs drive settings (bind them in the inspector), not image inputs.
          isConnectable={model.kind !== 'signal'}
          title={name}
        >
          {(model.outputs.length > 1 || model.kind === 'signal') && <span className="ghandle__label ghandle__label--out">{name}</span>}
        </Handle>
      ))}
    </div>
  )
})

/** Evenly spaced positions along an edge for `count` ports. */
const spread = (i: number, count: number): string => `${((i + 1) / (count + 1)) * 100}%`

const NODE_TYPES = { studio: StudioNode }
const FIT = { padding: 0.12, maxZoom: 1 }

/** Keeps the graph fitted when the panel changes size (window resize, timeline drag) or nodes come and go. */
function RefitOnResize({ nodeCount }: { nodeCount: number }) {
  const width = useFlowStore(s => s.width)
  const height = useFlowStore(s => s.height)
  const { fitView } = useReactFlow()
  useEffect(() => { void fitView(FIT) }, [width, height, nodeCount, fitView])
  return null
}

/**
 * Node graph of the section under the playhead. Click a node to inspect it; drag from an output to an
 * input (or to Output) to wire it; select a wire and press Delete to remove it.
 */
export function GraphPanel() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  )
}

function GraphCanvas() {
  const store = useStudioStore()
  const section = useFocusSection()
  const selectedNodeId = useStudio(s => s.selectedNodeId)
  // Only the set of nodes outside their time window matters, so subscribe to that as a string.
  const inactiveKey = useStudio(s => {
    if (!section) return ''
    const local = s.time - section.start
    return section.scene.graph.nodes
      .filter(n => (n.startTime !== undefined && local < n.startTime) || (n.endTime !== undefined && local >= n.endTime))
      .map(n => n.id)
      .join('|')
  })
  const model = useMemo(() => (section ? buildGraphModel(section.scene, NODE_SCHEMAS, validateNodeConfig) : null), [section])
  // Drop a selection that is not in the new section.
  useEffect(() => {
    if (!model) return
    const { selectedNodeId: selected } = store.getState()
    if (selected && !model.nodes.some(n => n.id === selected)) store.getState().selectNode(null)
  }, [model, store])

  const nodes = useMemo<Node<NodeData>[]>(() => {
    if (!model) return []
    const inactive = new Set(inactiveKey.split('|'))
    return model.nodes.map(n => ({
      id: n.id,
      type: 'studio',
      position: { x: n.x, y: n.y },
      data: { model: n, inactive: inactive.has(n.id) },
      selected: n.id === selectedNodeId,
      selectable: n.id !== OUTPUT_NODE_ID,
      draggable: false,
      deletable: false,
    }))
  }, [model, selectedNodeId, inactiveKey])

  const edges = useMemo<Edge[]>(() => (model?.edges ?? []).map(e => {
    const touchesSelection = selectedNodeId !== null && (e.source === selectedNodeId || e.target === selectedNodeId)
    return {
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      className: `gedge gedge--${e.kind}${touchesSelection ? ' gedge--selected' : ''}`,
      animated: e.kind === 'binding',
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      // Only pixel wires are edited here; bindings belong to the inspector, the output to its own action.
      focusable: e.kind === 'image',
      selectable: e.kind === 'image',
      deletable: e.kind === 'image',
    }
  }), [model, selectedNodeId])

  if (!section || !model) return null
  const scenePath = section.scenePath
  const onConnect = (c: Connection): void => {
    if (!c.source || !c.target || !c.sourceHandle) return
    const output = c.sourceHandle.replace(/^out:/, '')
    if (c.target === OUTPUT_NODE_ID) store.getState().setOutput(scenePath, c.source)
    else if (c.targetHandle) store.getState().connect(scenePath, { node: c.source, output }, { node: c.target, input: c.targetHandle.replace(/^in:/, '') })
  }
  return (
    <div className="graph" aria-label={`Node graph of ${section.id}`}>
      <AddNode
        anchor={selectedNodeId ?? section.scene.graph.outputs.browser ?? null}
        onAdd={(impl, after) => { store.getState().addNode(scenePath, impl, after ?? undefined) }}
      />
      <ReactFlow
        // Remount per section: React Flow fits the view only once nodes are measured, on init.
        key={`${section.id}@${section.start}`}
        fitView
        fitViewOptions={FIT}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesConnectable
        nodesDraggable={false}
        edgesUpdatable={false}
        elementsSelectable
        isValidConnection={c => validConnection(model, c)}
        onConnect={onConnect}
        deleteKeyCode={['Delete', 'Backspace']}
        onEdgesDelete={deleted => {
          // Highest index first, so earlier removals do not shift the later ones.
          const indices = deleted.flatMap(e => (e.id.startsWith('image:') ? [Number(e.id.slice(6))] : [])).sort((a, b) => b - a)
          for (const i of indices) store.getState().disconnect(scenePath, i)
        }}
        onEdgeClick={() => { store.getState().selectNode(null) }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => { if (node.id !== OUTPUT_NODE_ID) store.getState().selectNode(node.id) }}
        onPaneClick={() => { store.getState().selectNode(null) }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-right" fitViewOptions={FIT} />
        <RefitOnResize nodeCount={nodes.length} />
      </ReactFlow>
    </div>
  )
}

/** Image wires only: into a modifier or compositor input, or into Output; never from a signal. */
function validConnection(model: GraphModel, c: Connection): boolean {
  const source = model.nodes.find(n => n.id === c.source)
  const target = model.nodes.find(n => n.id === c.target)
  if (!source || !target || source.id === target.id || source.kind === 'signal') return false
  return target.kind === 'modifier' || target.kind === 'compositor' || target.kind === 'output'
}

const KIND_ORDER = ['generator', 'modifier', 'compositor', 'signal'] as const
const GROUP_LABEL: Record<(typeof KIND_ORDER)[number], string> = {
  generator: 'Generators',
  modifier: 'Modifiers (after the selected node)',
  compositor: 'Compositors (after the selected node)',
  signal: 'Signals',
}

/** "Add node" picker: modifiers and compositors go after the selected node (or the output). */
function AddNode({ anchor, onAdd }: { anchor: string | null; onAdd: (impl: string, after: string | null) => void }) {
  const [value, setValue] = useState('')
  const groups = useMemo(() => KIND_ORDER.map(kind => ({
    kind,
    schemas: Object.values(NODE_SCHEMAS).filter(s => s.kind === kind).sort((a, b) => a.label.localeCompare(b.label)),
  })), [])
  return (
    <div className="graph__toolbar">
      <select
        className="ui-select graph__add"
        aria-label="Add a node"
        title={anchor ? `Modifiers and compositors go after ${anchor}` : 'Add a node'}
        value={value}
        onChange={event => {
          const impl = event.target.value
          setValue('')
          if (impl) onAdd(impl, anchor)
        }}
      >
        <option value="">+ Add node…</option>
        {groups.map(g => (
          <optgroup key={g.kind} label={GROUP_LABEL[g.kind]}>
            {g.schemas.map(schema => (
              <option key={schema.impl} value={schema.impl} disabled={!anchor && (g.kind === 'modifier' || g.kind === 'compositor')}>{schema.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

import type { Scene, SceneNode } from '@overscan/types'
import type { ConfigProblem, NodeSchema } from '@overscan/nodes/browser'

/** A config value driven by something else: a rocket track or another node's output. */
export type Binding = { kind: 'track'; track: string } | { kind: 'node'; node: string; output: string }

export function bindingOf(value: unknown): Binding | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.track === 'string') return { kind: 'track', track: v.track }
  if (typeof v.node === 'string' && typeof v.output === 'string') return { kind: 'node', node: v.node, output: v.output }
  return null
}

/** Every binding in a config, including inside vectors and nested objects (paths like `cameraPos[1]`). */
export function configBindings(config: Record<string, unknown>): { path: string; binding: Binding }[] {
  const found: { path: string; binding: Binding }[] = []
  const walk = (value: unknown, path: string): void => {
    const binding = bindingOf(value)
    if (binding) {
      found.push({ path, binding })
      return
    }
    if (Array.isArray(value)) value.forEach((item, i) => { walk(item, `${path}[${i}]`) })
    else if (typeof value === 'object' && value !== null) {
      for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key)
    }
  }
  walk(config, '')
  return found
}

export const OUTPUT_NODE_ID = '__output__'

export interface GraphModelNode {
  id: string
  kind: SceneNode['type'] | 'output'
  impl: string
  label: string
  x: number
  y: number
  /** Image inputs, in compositing order. */
  inputs: string[]
  outputs: string[]
  /** Tracks this node's config reads. */
  tracks: string[]
  /** Number of config values bound to tracks or node outputs. */
  bindingCount: number
  problems: ConfigProblem[]
  /** Sinks that show this node (terminal, browser, export). */
  outputFor: string[]
  startTime?: number
  endTime?: number
}

export interface GraphModelEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
  /** `image`: pixels flow along it. `binding`: a config value reads a node output. `output`: shown by a sink. */
  kind: 'image' | 'binding' | 'output'
  label?: string
}

export interface GraphModel {
  nodes: GraphModelNode[]
  edges: GraphModelEdge[]
}

// Top-to-bottom layout: it suits a tall, narrow side panel. Layers stack down, siblings sit side by side.
export const NODE_WIDTH = 168
export const NODE_HEIGHT = 46
const LAYER_GAP = 54
const SIBLING_GAP = 18

export const handleId = {
  input: (name: string): string => `in:${name}`,
  output: (name: string): string => `out:${name}`,
  bindings: 'bind',
}

type Validate = (schema: NodeSchema, config: Record<string, unknown>) => ConfigProblem[]

/**
 * Turns a scene graph into positioned nodes and edges: layers by longest path from the sources (image
 * edges and node-output bindings both count), each layer ordered by the average position of its inputs.
 */
export function buildGraphModel(scene: Scene, schemas: Readonly<Record<string, NodeSchema>>, validate: Validate): GraphModel {
  const { graph } = scene
  const ids = new Set(graph.nodes.map(n => n.id))
  const edges: GraphModelEdge[] = []
  const inputs = new Map<string, string[]>()
  const outputs = new Map<string, string[]>()
  const addPort = (map: Map<string, string[]>, node: string, port: string): void => {
    const list = map.get(node) ?? []
    if (!list.includes(port)) list.push(port)
    map.set(node, list)
  }

  const imageEdges = [...graph.edges].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  for (const [i, edge] of imageEdges.entries()) {
    if (!ids.has(edge.from.node) || !ids.has(edge.to.node)) continue
    addPort(outputs, edge.from.node, edge.from.output)
    addPort(inputs, edge.to.node, edge.to.input)
    edges.push({
      id: `image:${i}`,
      source: edge.from.node,
      sourceHandle: handleId.output(edge.from.output),
      target: edge.to.node,
      targetHandle: handleId.input(edge.to.input),
      kind: 'image',
    })
  }

  const bindingsByNode = new Map(graph.nodes.map(node => [node.id, configBindings(node.config)]))
  for (const node of graph.nodes) {
    for (const { path, binding } of bindingsByNode.get(node.id) ?? []) {
      if (binding.kind !== 'node' || !ids.has(binding.node)) continue
      addPort(outputs, binding.node, binding.output)
      edges.push({
        id: `bind:${node.id}:${path}`,
        source: binding.node,
        sourceHandle: handleId.output(binding.output),
        target: node.id,
        targetHandle: handleId.bindings,
        kind: 'binding',
        label: path,
      })
    }
  }

  const sinksByNode = new Map<string, string[]>()
  for (const [sink, nodeId] of Object.entries(graph.outputs)) {
    if (ids.has(nodeId)) sinksByNode.set(nodeId, [...(sinksByNode.get(nodeId) ?? []), sink])
  }
  for (const nodeId of sinksByNode.keys()) {
    if (!outputs.get(nodeId)?.length) addPort(outputs, nodeId, 'color')
    edges.push({
      id: `output:${nodeId}`,
      source: nodeId,
      sourceHandle: handleId.output(outputs.get(nodeId)![0]!),
      target: OUTPUT_NODE_ID,
      targetHandle: handleId.input('in'),
      kind: 'output',
    })
  }

  // Columns: longest path from a source. Guards against cycles (the executor rejects them anyway).
  const preds = new Map<string, string[]>()
  for (const edge of edges) preds.set(edge.target, [...(preds.get(edge.target) ?? []), edge.source])
  const depth = new Map<string, number>()
  const depthOf = (id: string, visiting = new Set<string>()): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const d = Math.max(-1, ...(preds.get(id) ?? []).map(p => depthOf(p, visiting))) + 1
    visiting.delete(id)
    depth.set(id, d)
    return d
  }

  const nodes: GraphModelNode[] = graph.nodes.map(node => {
    const schema = schemas[node.impl]
    const bindings = bindingsByNode.get(node.id) ?? []
    const nodeInputs = inputs.get(node.id) ?? [...(schema?.inputs ?? (node.type === 'modifier' ? ['in'] : []))]
    const nodeOutputs = outputs.get(node.id) ?? []
    return {
      id: node.id,
      kind: node.type,
      impl: node.impl,
      label: schema?.label ?? node.impl,
      x: 0,
      y: 0,
      inputs: nodeInputs,
      outputs: nodeOutputs,
      tracks: [...new Set(bindings.flatMap(b => (b.binding.kind === 'track' ? [b.binding.track] : [])))],
      bindingCount: bindings.length,
      problems: schema ? validate(schema, node.config) : [{ key: node.impl, message: 'no settings schema for this node type' }],
      outputFor: sinksByNode.get(node.id) ?? [],
      ...(node.startTime !== undefined ? { startTime: node.startTime } : {}),
      ...(node.endTime !== undefined ? { endTime: node.endTime } : {}),
    }
  })
  if (sinksByNode.size > 0) {
    nodes.push({
      id: OUTPUT_NODE_ID, kind: 'output', impl: 'output', label: 'Output', x: 0, y: 0,
      inputs: ['in'], outputs: [], tracks: [], bindingCount: 0, problems: [], outputFor: [...new Set(Object.keys(graph.outputs))],
    })
  }

  const layers = new Map<number, GraphModelNode[]>()
  for (const node of nodes) {
    const d = depthOf(node.id)
    layers.set(d, [...(layers.get(d) ?? []), node])
  }
  // Keep the output node alone in the last layer.
  const output = nodes.find(n => n.kind === 'output')
  if (output) {
    const d = depthOf(output.id)
    const rest = (layers.get(d) ?? []).filter(n => n !== output)
    if (rest.length) layers.set(d, rest)
    else layers.delete(d)
    layers.set(Math.max(-1, ...layers.keys()) + 1, [output])
  }

  const centerX = new Map<string, number>()
  for (const [index, layer] of [...layers.keys()].sort((a, b) => a - b).entries()) {
    const list = layers.get(layer) ?? []
    const score = (n: GraphModelNode): number => {
      const xs = (preds.get(n.id) ?? []).map(p => centerX.get(p)).filter((x): x is number => x !== undefined)
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY
    }
    const order = list.map((n, i) => ({ n, i, s: score(n) })).sort((a, b) => a.s - b.s || a.i - b.i).map(e => e.n)
    const total = order.length * NODE_WIDTH + SIBLING_GAP * Math.max(0, order.length - 1)
    let x = -total / 2
    for (const node of order) {
      node.x = x
      node.y = index * (NODE_HEIGHT + LAYER_GAP)
      centerX.set(node.id, x + NODE_WIDTH / 2)
      x += NODE_WIDTH + SIBLING_GAP
    }
  }
  return { nodes, edges }
}

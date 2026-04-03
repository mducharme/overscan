import { Position, type Edge, type Node } from 'reactflow'
import type { Scene, SceneNode } from '@overscan/types'
import type { StoredNodePosition } from '../store/studio'
import { getNodeCatalogItem } from './node-catalog'

const TYPE_COLORS: Record<SceneNode['type'], string> = {
  generator: '#E8570A',
  modifier: '#1D9E75',
  compositor: '#7F77DD',
  signal: '#BA7517',
}

function nodeDepth(scene: Scene, nodeId: string, cache = new Map<string, number>()): number {
  const cached = cache.get(nodeId)
  if (cached !== undefined) return cached
  const incoming = scene.graph.edges.filter(edge => edge.to.node === nodeId)
  if (incoming.length === 0) {
    cache.set(nodeId, 0)
    return 0
  }
  const depth = 1 + Math.max(...incoming.map(edge => nodeDepth(scene, edge.from.node, cache)))
  cache.set(nodeId, depth)
  return depth
}

export function computeAutoLayoutPositions(scene: Scene): Record<string, StoredNodePosition> {
  const depthCache = new Map<string, number>()
  const lanes = new Map<number, number>()
  const positions: Record<string, StoredNodePosition> = {}

  for (const node of scene.graph.nodes) {
    const depth = nodeDepth(scene, node.id, depthCache)
    const lane = lanes.get(depth) ?? 0
    lanes.set(depth, lane + 1)
    positions[node.id] = {
      x: depth * 260,
      y: lane * 150,
    }
  }

  return positions
}

export interface StudioFlowNodeData {
  label: string
  impl: string
  type: SceneNode['type']
  color: string
  tagColor: string
  rendererBadge?: string
  thumbnailSrc?: string
  inputs: StudioPort[]
  outputs: StudioPort[]
}

export interface StudioPort {
  id: string
  label: string
  kind: 'buffer' | 'signal' | 'mask'
  offset: number
}

export function createFlowEdgeId(sourceNode: string, sourcePort: string, targetNode: string, targetPort: string, index = 0): string {
  return `${sourceNode}:${sourcePort}->${targetNode}:${targetPort}:${index}`
}

export function edgeKind(edge: { from: { node: string; output: string }; to: { node: string; input: string } }, scene?: Scene): StudioPort['kind'] {
  if (scene) {
    const sourceNode = scene.graph.nodes.find(node => node.id === edge.from.node)
    const targetNode = scene.graph.nodes.find(node => node.id === edge.to.node)
    const sourceKind = sourceNode ? getNodeCatalogItem(sourceNode.impl)?.outputs.find(port => port.id === edge.from.output)?.kind : null
    const targetKind = targetNode ? getNodeCatalogItem(targetNode.impl)?.inputs.find(port => port.id === edge.to.input)?.kind : null
    if (targetKind === 'mask') return 'mask'
    if (sourceKind === 'signal' || targetKind === 'signal') return 'signal'
  }
  if (edge.to.input === 'mask') return 'mask'
  if (edge.from.output === 'value' || edge.from.output === 'phase') return 'signal'
  return 'buffer'
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function portKind(name: string, nodeType: SceneNode['type'], side: 'input' | 'output'): StudioPort['kind'] {
  if (name === 'mask') return 'mask'
  if (nodeType === 'signal') return 'signal'
  if (side === 'output' && (name === 'value' || name === 'phase')) return 'signal'
  return 'buffer'
}

function buildPorts(labels: string[], nodeType: SceneNode['type'], side: 'input' | 'output'): StudioPort[] {
  const source = labels.length > 0 ? labels : side === 'output' ? ['out'] : []
  return source.map((label, index) => ({
    id: label,
    label,
    kind: portKind(label, nodeType, side),
    offset: 48 + index * 22,
  }))
}

function mergePortLabels(schemaPorts: string[], connectedPorts: string[], fallback: string[] = []): string[] {
  const merged = [...schemaPorts, ...connectedPorts]
  return uniqueSorted(merged.length > 0 ? merged : fallback)
}

export function sceneToFlow(
  scene: Scene,
  storedPositions: Record<string, StoredNodePosition> = {},
  nodeThumbnails: Record<string, { src: string }> = {},
  rendererBadges: Record<string, string> = {},
): {
  nodes: Array<Node<StudioFlowNodeData>>
  edges: Edge[]
} {
  const depthCache = new Map<string, number>()
  const lanes = new Map<number, number>()
  const nodes = scene.graph.nodes.map(node => {
    const depth = nodeDepth(scene, node.id, depthCache)
    const lane = lanes.get(depth) ?? 0
    lanes.set(depth, lane + 1)

    const position = storedPositions[node.id] ?? {
      x: depth * 260,
      y: lane * 150,
    }

    const schema = getNodeCatalogItem(node.impl)
    const schemaInputs = schema?.inputs.map(port => port.id) ?? []
    const schemaOutputs = schema?.outputs.map(port => port.id) ?? ['color']
    const incomingInputs = uniqueSorted(scene.graph.edges.filter(edge => edge.to.node === node.id).map(edge => edge.to.input))
    const outgoingOutputs = uniqueSorted(scene.graph.edges.filter(edge => edge.from.node === node.id).map(edge => edge.from.output))
    const inputs = mergePortLabels(schemaInputs, incomingInputs)
    const outputs = mergePortLabels(schemaOutputs, outgoingOutputs, ['color'])

    return {
      id: node.id,
      type: 'studioNode',
      position,
      data: {
        label: node.id,
        impl: node.impl,
        type: node.type,
        color: TYPE_COLORS[node.type],
        tagColor:
          node.type === 'generator' ? 'orange' :
            node.type === 'modifier' ? 'cyan' :
              node.type === 'compositor' ? 'purple' : 'gold',
        rendererBadge: rendererBadges[node.id],
        thumbnailSrc: nodeThumbnails[node.id]?.src,
        inputs: buildPorts(inputs, node.type, 'input'),
        outputs: buildPorts(outputs, node.type, 'output'),
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        width: 240,
        background: 'transparent',
        border: 'none',
        padding: 0,
      },
    } satisfies Node<StudioFlowNodeData>
  })

  const edges = scene.graph.edges.map((edge, index) => ({
    id: createFlowEdgeId(edge.from.node, edge.from.output, edge.to.node, edge.to.input, index),
    source: edge.from.node,
    target: edge.to.node,
    sourceHandle: edge.from.output,
    targetHandle: edge.to.input,
    label: `${edge.from.output} -> ${edge.to.input}`,
    type: edgeKind(edge, scene) === 'mask' ? 'maskEdge' : edgeKind(edge, scene) === 'signal' ? 'signalEdge' : 'bufferEdge',
    animated: false,
    style: {
      stroke: edgeKind(edge, scene) === 'mask' ? '#7F77DD' : edgeKind(edge, scene) === 'signal' ? '#1D9E75' : '#E8570A',
      strokeWidth: 1.5,
    },
    labelStyle: {
      fill: '#888',
      fontSize: 10,
    },
  })) satisfies Edge[]

  return { nodes, edges }
}

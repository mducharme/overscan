import { buildBuiltinRegistry } from '@overscan/nodes/browser'
import type { SceneNode } from '@overscan/types'

export interface NodeCatalogItem {
  impl: string
  type: SceneNode['type']
  label: string
  inputs: StudioPortSchema[]
  outputs: StudioPortSchema[]
  fieldHints?: Record<string, ConfigFieldHint>
}

export interface StudioPortSchema {
  id: string
  label: string
  kind: 'buffer' | 'signal' | 'mask'
}

export type ConfigFieldHint =
  | 'animatable'
  | 'boolean'
  | 'enum'
  | 'palette'
  | 'color'
  | 'file'
  | 'glsl'
  | 'json'
  | 'text'
  | 'number'

const bufferOut: StudioPortSchema[] = [{ id: 'color', label: 'color', kind: 'buffer' }]
const bufferInOut: { inputs: StudioPortSchema[]; outputs: StudioPortSchema[] } = {
  inputs: [{ id: 'color', label: 'color', kind: 'buffer' }],
  outputs: bufferOut,
}
const compositorPorts: { inputs: StudioPortSchema[]; outputs: StudioPortSchema[] } = {
  inputs: [
    { id: 'base', label: 'base', kind: 'buffer' },
    { id: 'overlay', label: 'overlay', kind: 'buffer' },
    { id: 'mask', label: 'mask', kind: 'mask' },
  ],
  outputs: bufferOut,
}

function generator(impl: string, label: string): NodeCatalogItem {
  return { impl, type: 'generator', label, inputs: [], outputs: bufferOut }
}

function modifier(impl: string, label: string): NodeCatalogItem {
  return { impl, type: 'modifier', label, ...bufferInOut }
}

function compositor(impl: string, label: string): NodeCatalogItem {
  return { impl, type: 'compositor', label, ...compositorPorts }
}

function signalNode(impl: string, label: string, outputs: StudioPortSchema[]): NodeCatalogItem {
  return { impl, type: 'signal', label, inputs: [], outputs }
}

export const NODE_CATALOG: NodeCatalogItem[] = [
  generator('plasma', 'Plasma'),
  generator('fire', 'Fire'),
  generator('starfield', 'Starfield'),
  generator('scroller', 'Scroller'),
  generator('text', 'Text'),
  generator('lissajous', 'Lissajous'),
  generator('moire', 'Moire'),
  generator('tunnel', 'Tunnel'),
  generator('rotozoom', 'Rotozoom'),
  generator('raymarcher', 'Raymarcher'),
  generator('metaballs', 'Metaballs'),
  generator('voxel-landscape', 'Voxel Landscape'),
  generator('copperbars', 'Copperbars'),
  generator('sinebobs', 'Sinebobs'),
  generator('water-ripple', 'Water Ripple'),
  generator('dot-matrix', 'Dot Matrix'),
  generator('vector-balls', 'Vector Balls'),
  generator('fractal-zoom', 'Fractal Zoom'),
  generator('game-of-life', 'Game Of Life'),
  generator('matrix-rain', 'Matrix Rain'),
  generator('checkerboard-floor', 'Checkerboard Floor'),
  generator('oscilloscope', 'Oscilloscope'),
  compositor('alpha-blend', 'Alpha Blend'),
  compositor('additive-blend', 'Additive Blend'),
  compositor('multiply-blend', 'Multiply Blend'),
  compositor('screen-blend', 'Screen Blend'),
  compositor('overlay-blend', 'Overlay Blend'),
  compositor('difference-blend', 'Difference Blend'),
  compositor('transition', 'Transition'),
  modifier('crt', 'CRT'),
  modifier('blur', 'Blur'),
  modifier('glow', 'Glow'),
  modifier('blur-glow', 'Blur Glow'),
  modifier('feedback', 'Feedback'),
  modifier('palette-flash', 'Palette Flash'),
  modifier('palette-cycle', 'Palette Cycle'),
  modifier('pixelate', 'Pixelate'),
  modifier('mirror', 'Mirror'),
  modifier('chromatic-aberration', 'Chromatic Aberration'),
  modifier('color-grade', 'Color Grade'),
  signalNode('lfo', 'LFO', [
    { id: 'value', label: 'value', kind: 'signal' },
    { id: 'phase', label: 'phase', kind: 'signal' },
  ]),
  signalNode('noise', 'Noise', [
    { id: 'value', label: 'value', kind: 'signal' },
  ]),
]

const COMMON_FIELD_HINTS: Record<string, ConfigFieldHint> = {
  speed: 'animatable',
  scale: 'animatable',
  zoom: 'animatable',
  size: 'animatable',
  radius: 'animatable',
  amount: 'animatable',
  intensity: 'animatable',
  opacity: 'animatable',
  density: 'animatable',
  thickness: 'animatable',
  frequency: 'animatable',
  amplitude: 'animatable',
  phase: 'animatable',
  glow: 'animatable',
  threshold: 'animatable',
  softness: 'animatable',
  rows: 'number',
  cols: 'number',
  seed: 'number',
  enabled: 'boolean',
  invert: 'boolean',
  wrap: 'boolean',
  loop: 'boolean',
  palette: 'palette',
  color: 'color',
  tint: 'color',
  background: 'color',
  foreground: 'color',
  text: 'text',
  content: 'text',
  image: 'file',
  audio: 'file',
  path: 'file',
  src: 'file',
  glsl: 'glsl',
}

function slugToId(slug: string): string {
  return slug.replace(/[^a-z0-9]+/gi, '')
}

export function nextNodeId(existingIds: string[], impl: string): string {
  const base = slugToId(impl)
  let index = 1
  let candidate = `${base}${index}`
  while (existingIds.includes(candidate)) {
    index += 1
    candidate = `${base}${index}`
  }
  return candidate
}

export function createDefaultNode(item: NodeCatalogItem, existingIds: string[]): SceneNode {
  const id = nextNodeId(existingIds, item.impl)
  const tempNode: SceneNode = {
    id,
    type: item.type,
    impl: item.impl,
    config: {},
  }
  const runtime = buildBuiltinRegistry([tempNode]).get(id)
  return {
    ...tempNode,
    config: { ...(runtime?.config ?? {}) },
  }
}

export function getNodeCatalogItem(impl: string): NodeCatalogItem | undefined {
  return NODE_CATALOG.find(item => item.impl === impl)
}

export function getPortKindForNode(impl: string, side: 'input' | 'output', portId: string): StudioPortSchema['kind'] | null {
  const item = getNodeCatalogItem(impl)
  const ports = side === 'input' ? item?.inputs : item?.outputs
  const port = ports?.find(entry => entry.id === portId)
  return port?.kind ?? null
}

export function getConfigFieldHint(impl: string, key: string, value: unknown): ConfigFieldHint {
  const item = getNodeCatalogItem(impl)
  const hinted = item?.fieldHints?.[key] ?? COMMON_FIELD_HINTS[key]
  if (hinted) return hinted
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') {
    if (value.includes('\n')) return 'glsl'
    if (/\.(png|jpg|jpeg|gif|webp|mp3|wav|ogg|frag|glsl|txt)$/i.test(value)) return 'file'
    return 'text'
  }
  if (Array.isArray(value) && value.every(item => Array.isArray(item))) return 'palette'
  if (Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number')) return 'color'
  return 'json'
}

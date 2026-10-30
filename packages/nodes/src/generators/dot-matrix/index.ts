import { drawBitmapTextBlock, measureBitmapText } from '@overscan/text'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleFovMultiplier, scaleThickness } from '../../viewport-scale.js'

export interface DotMatrixConfig {
  shape?: 'sphere' | 'torus' | 'helix' | 'cube' | 'text' | string
  text?: string
  font?: string
  count?: number
  rotationX?: AnimatableFloat
  rotationY?: AnimatableFloat
  rotationZ?: AnimatableFloat
  fov?: AnimatableFloat
  pointSize?: AnimatableFloat
  color?: string | 'depth'
  palette?: number[][]
  morphTarget?: string
  morphProgress?: AnimatableFloat
}

type Point3 = [number, number, number]

const DEFAULT_PALETTE = [
  [32, 96, 255],
  [96, 220, 255],
  [255, 255, 255],
]

export function DotMatrixGenerator(config: Partial<DotMatrixConfig> = {}): Generator {
  const shape = config.shape ?? 'sphere'
  const text = config.text ?? 'OVERSCAN'
  const count = Math.max(32, Math.min(4000, Math.round(config.count ?? 2000)))
  const rotationXRef = config.rotationX ?? 0.3
  const rotationYRef = config.rotationY ?? 0.7
  const rotationZRef = config.rotationZ ?? 0
  const fovRef = config.fov ?? 300
  const pointSizeRef = config.pointSize ?? 2
  const colorMode = config.color ?? 'depth'
  const palette = config.palette ?? DEFAULT_PALETTE
  const morphTarget = config.morphTarget
  const morphProgressRef = config.morphProgress ?? 0
  const basePoints = makeShape(shape, count, text)
  const morphPoints = morphTarget ? makeShape(morphTarget, count, text) : null

  return {
    type: 'generator',
    id: 'dot-matrix',
    renderers: ['cpu'],
    config: config,
    init() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      data.fill(0)
      const rx = resolveAnimatableFloat(rotationXRef, signal) * signal.t
      const ry = resolveAnimatableFloat(rotationYRef, signal) * signal.t
      const rz = resolveAnimatableFloat(rotationZRef, signal) * signal.t
      const fov = scaleFovMultiplier(Math.max(40, resolveAnimatableFloat(fovRef, signal)), w, h)
      const pointSize = scaleThickness(
        Math.max(1, resolveAnimatableFloat(pointSizeRef, signal)),
        w,
        h,
      )
      const morph = morphPoints ? Math.max(0, Math.min(1, resolveAnimatableFloat(morphProgressRef, signal))) : 0

      for (let i = 0; i < basePoints.length; i++) {
        const p0 = basePoints[i]!
        const p1 = morphPoints?.[i] ?? p0
        const p = rotate3(mix3(p0, p1, morph), rx, ry, rz)
        const z = p[2] + 3.5
        if (z <= 0.2) continue
        const sx = w * 0.5 + (p[0] / z) * fov
        const sy = h * 0.5 + (p[1] / z) * fov
        const depth = Math.max(0, Math.min(1, 1 - z / 5.5))
        const c = colorMode === 'depth' ? samplePalette(palette, depth) : hexToRgb(colorMode)
        stamp(data, w, h, sx, sy, pointSize * (0.65 + depth), c)
      }
    },
    destroy() {},
  }
}

function makeShape(shape: string, count: number, text: string): Point3[] {
  switch (shape) {
    case 'torus':
      return Array.from({ length: count }, (_, i) => {
        const u = (i / count) * Math.PI * 2
        const v = ((i * 17) % count) / count * Math.PI * 2
        const r = 1.0
        const t = 0.35
        return [(r + Math.cos(v) * t) * Math.cos(u), Math.sin(v) * t, (r + Math.cos(v) * t) * Math.sin(u)]
      })
    case 'helix':
      return Array.from({ length: count }, (_, i) => {
        const t = (i / Math.max(1, count - 1)) * Math.PI * 8
        return [Math.cos(t) * 0.9, (i / Math.max(1, count - 1) - 0.5) * 2, Math.sin(t) * 0.9]
      })
    case 'cube':
      return Array.from({ length: count }, (_, i) => {
        const f = (i % 6) / 6
        const u = ((i * 13) % 101) / 50 - 1
        const v = ((i * 29) % 101) / 50 - 1
        if (f < 1 / 3) return [u, v, f < 1 / 6 ? -1 : 1]
        if (f < 2 / 3) return [u, f < 0.5 ? -1 : 1, v]
        return [f < 5 / 6 ? -1 : 1, u, v]
      })
    case 'text':
      return makeTextShape(text, count)
    case 'sphere':
    default:
      return Array.from({ length: count }, (_, i) => {
        const u = ((i * 13) % count) / count
        const v = ((i * 37) % count) / count
        const theta = u * Math.PI * 2
        const phi = Math.acos(2 * v - 1)
        return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]
      })
  }
}

/**
 * One dot per lit pixel of the text in the shared bitmap font, centered and kept at the font's aspect.
 * When `count` exceeds the lit pixels the text is extruded into extra z layers; every slot is filled
 * so morph targets stay index-aligned.
 */
function makeTextShape(text: string, count: number): Point3[] {
  const metrics = measureBitmapText(text)
  const w = Math.max(1, metrics.width)
  const h = Math.max(1, metrics.height)
  const pixels = new Uint8ClampedArray(w * h * 4)
  drawBitmapTextBlock(pixels, w, h, text, 0, 0)
  const lit: [number, number][] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3]! > 0) lit.push([x, y])
    }
  }
  if (lit.length === 0) return Array.from({ length: count }, () => [0, 0, 0])
  const unit = 2.2 / Math.max(1, w - 1)
  const layers = Math.ceil(count / lit.length)
  return Array.from({ length: count }, (_, i) => {
    const [x, y] = lit[i % lit.length]!
    const layer = Math.floor(i / lit.length)
    const z = layers === 1 ? 0 : (layer / (layers - 1) - 0.5) * 0.3
    // Screen y grows downward in the projection, so glyph rows map to +y going down.
    return [(x - (w - 1) / 2) * unit, (y - (h - 1) / 2) * unit, z]
  })
}

function rotate3(p: Point3, ax: number, ay: number, az: number): Point3 {
  let [x, y, z] = p
  let c = Math.cos(ax), s = Math.sin(ax)
  ;[y, z] = [y * c - z * s, y * s + z * c]
  c = Math.cos(ay); s = Math.sin(ay)
  ;[x, z] = [x * c + z * s, -x * s + z * c]
  c = Math.cos(az); s = Math.sin(az)
  ;[x, y] = [x * c - y * s, x * s + y * c]
  return [x, y, z]
}

function stamp(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, radius: number, color: [number, number, number]): void {
  const r = Math.max(1, Math.round(radius))
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      const x = Math.round(cx + xx)
      const y = Math.round(cy + yy)
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const d = Math.sqrt(xx * xx + yy * yy)
      if (d > r) continue
      const intensity = 1 - d / r
      const o = (y * w + x) * 4
      data[o] = Math.min(255, Math.round((data[o] ?? 0) + color[0] * intensity))
      data[o + 1] = Math.min(255, Math.round((data[o + 1] ?? 0) + color[1] * intensity))
      data[o + 2] = Math.min(255, Math.round((data[o + 2] ?? 0) + color[2] * intensity))
      data[o + 3] = 255
    }
  }
}

function samplePalette(palette: number[][], t: number): [number, number, number] {
  const colors = palette.length > 1 ? palette : DEFAULT_PALETTE
  const scaled = Math.max(0, Math.min(1, t)) * (colors.length - 1)
  const idx = Math.min(colors.length - 2, Math.floor(scaled))
  const frac = scaled - idx
  const a = colors[idx] ?? colors[0] ?? DEFAULT_PALETTE[0]!
  const b = colors[idx + 1] ?? a
  return [
    Math.round((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * frac),
    Math.round((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * frac),
    Math.round((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * frac),
  ]
}

function mix3(a: Point3, b: Point3, t: number): Point3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return [
    Number.isFinite(n) ? (n >> 16) & 0xff : 255,
    Number.isFinite(n) ? (n >> 8) & 0xff : 255,
    Number.isFinite(n) ? n & 0xff : 255,
  ]
}

import { frameSteps } from '../../frame-time.js'
import {
  type LooseString,
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleThickness } from '../../viewport-scale.js'

export interface SinebobsConfig {
  count?: number
  radius?: AnimatableFloat
  freqX?: AnimatableFloat
  freqY?: AnimatableFloat
  amplitude?: AnimatableFloat
  palette?: number[][]
  sprite?: LooseString<'circle' | 'star' | 'diamond'>
  trail?: AnimatableFloat
  phaseSpread?: number
}

const DEFAULT_PALETTE = [
  [255, 96, 64],
  [255, 220, 96],
  [96, 255, 160],
  [96, 180, 255],
  [214, 120, 255],
]

export function SinebobsGenerator(config: Partial<SinebobsConfig> = {}): Generator {
  const count = Math.max(1, Math.min(64, Math.round(config.count ?? 16)))
  const radiusRef = config.radius ?? 20
  const freqXRef = config.freqX ?? 1
  const freqYRef = config.freqY ?? 1.3
  const amplitudeRef = config.amplitude ?? 0.4
  const trailRef = config.trail ?? 0
  const phaseSpread = config.phaseSpread ?? 1
  const sprite = config.sprite ?? 'circle'
  const palette = config.palette ?? DEFAULT_PALETTE
  /** Previous frame for `trail`; the pool hands out cleared buffers, so we keep our own copy. */
  let prev: Uint8ClampedArray | null = null

  return {
    type: 'generator',
    id: 'sinebobs',
    renderers: ['cpu'],
    config: config,
    init() { prev = null },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const radius = scaleThickness(
        Math.max(2, resolveAnimatableFloat(radiusRef, signal)),
        out.width,
        out.height,
      )
      const rDraw = Math.max(1, radius)
      const freqX = resolveAnimatableFloat(freqXRef, signal)
      const freqY = resolveAnimatableFloat(freqYRef, signal)
      const amplitude = Math.max(0, Math.min(0.48, resolveAnimatableFloat(amplitudeRef, signal)))
      const trail = Math.max(0, Math.min(1, resolveAnimatableFloat(trailRef, signal)))
      const { width: w, height: h, data } = out
      if (prev?.length !== data.length) prev = new Uint8ClampedArray(data.length)
      data.set(prev)
      const keep = trail ** frameSteps(signal)
      const fade = 1 - keep * 0.92
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.round((data[i] ?? 0) * keep)
        data[i + 1] = Math.round((data[i + 1] ?? 0) * keep)
        data[i + 2] = Math.round((data[i + 2] ?? 0) * keep)
        data[i + 3] = Math.round(Math.max((data[i + 3] ?? 0) * keep, 255 * fade))
      }
      const rx = w * amplitude
      const ry = h * amplitude * 0.72
      for (let i = 0; i < count; i++) {
        const phase = i * phaseSpread
        const x = w * 0.5 + Math.sin(signal.t * freqX + phase) * rx
        const y = h * 0.5 + Math.sin(signal.t * freqY + phase * 1.37) * ry
        drawBob(data, w, h, x, y, rDraw, samplePalette(palette, i / Math.max(1, count - 1)), sprite)
      }
      prev.set(data)
    },
    destroy() {
      prev = null
    },
  }
}

function drawBob(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number],
  sprite: NonNullable<SinebobsConfig['sprite']>,
): void {
  const r = Math.max(1, Math.round(radius))
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      const x = Math.round(cx + xx)
      const y = Math.round(cy + yy)
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const nx = xx / Math.max(1, r)
      const ny = yy / Math.max(1, r)
      const intensity = shapeValue(nx, ny, sprite)
      if (intensity <= 0) continue
      const o = (y * w + x) * 4
      data[o] = Math.min(255, Math.round((data[o] ?? 0) + color[0] * intensity))
      data[o + 1] = Math.min(255, Math.round((data[o + 1] ?? 0) + color[1] * intensity))
      data[o + 2] = Math.min(255, Math.round((data[o + 2] ?? 0) + color[2] * intensity))
      data[o + 3] = 255
    }
  }
}

function shapeValue(x: number, y: number, sprite: NonNullable<SinebobsConfig['sprite']>): number {
  if (sprite === 'diamond') return Math.max(0, 1 - (Math.abs(x) + Math.abs(y)))
  if (sprite === 'star') {
    const a = Math.atan2(y, x)
    const rr = Math.sqrt(x * x + y * y)
    return Math.max(0, 0.78 + 0.22 * Math.cos(a * 5) - rr)
  }
  return Math.max(0, 1 - Math.sqrt(x * x + y * y))
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

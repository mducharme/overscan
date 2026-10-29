import { FixedStepClock } from '../../frame-time.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleThickness } from '../../viewport-scale.js'

export interface ShadebobsConfig {
  count?: number
  /** Bob radius in pixels at the 640×360 reference. */
  radius?: AnimatableFloat
  freqX?: AnimatableFloat
  freqY?: AnimatableFloat
  /** Path extent as a fraction of the frame. */
  amplitude?: AnimatableFloat
  /** Multiplier on how fast the bobs travel. */
  speed?: AnimatableFloat
  /** Per-tick retention of the accumulated field; 1 (default) = classic, no fade. */
  decay?: AnimatableFloat
  /** Colour-index step added per stamp, as a fraction of the palette (0.22 ≈ 4 of 256 levels). */
  intensity?: AnimatableFloat
  phaseSpread?: number
  /** Colour at index 0, where no bob has passed yet. */
  backgroundColor?: string
  palette?: number[][]
}

const DEFAULT_PALETTE = [
  [22, 10, 36],
  [90, 28, 128],
  [255, 76, 168],
  [255, 220, 116],
  [255, 255, 255],
]

const LEVELS = 256

/**
 * Classic shadebobs: flat circles stamped every 30 Hz tick, each adding a step to a per-pixel
 * colour index. Nothing fades, and the index wraps around a looping palette, so overlapping paths
 * build up into contour bands. The stamping runs on the fixed-step clock, so seeking replays it.
 */
export function ShadebobsGenerator(config: Partial<ShadebobsConfig> = {}): Generator {
  const count = Math.max(1, Math.min(48, Math.round(config.count ?? 10)))
  const radiusRef = config.radius ?? 22
  const freqXRef = config.freqX ?? 1.2
  const freqYRef = config.freqY ?? 1.8
  const amplitudeRef = config.amplitude ?? 0.34
  const speedRef = config.speed ?? 1
  const decayRef = config.decay ?? 1
  const intensityRef = config.intensity ?? 0.22
  const phaseSpread = config.phaseSpread ?? 0.8
  const background = hexToRgb(config.backgroundColor ?? '#05060d')
  const lut = buildLoopingLut([background, ...(config.palette?.length ? config.palette : DEFAULT_PALETTE)])
  const clock = new FixedStepClock()
  let field: Uint8Array | null = null

  return {
    type: 'generator',
    id: 'shadebobs',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {
      field = null
      clock.reset()
    },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      if (field?.length !== w * h) {
        field = new Uint8Array(w * h)
        clock.reset()
      }
      const acc = field
      const radius = Math.max(1, scaleThickness(Math.max(2, resolveAnimatableFloat(radiusRef, signal)), w, h))
      const freqX = resolveAnimatableFloat(freqXRef, signal)
      const freqY = resolveAnimatableFloat(freqYRef, signal)
      const speed = resolveAnimatableFloat(speedRef, signal)
      const amplitude = Math.max(0, Math.min(0.48, resolveAnimatableFloat(amplitudeRef, signal)))
      const decay = Math.max(0, Math.min(1, resolveAnimatableFloat(decayRef, signal)))
      const step = Math.max(1, Math.round(resolveAnimatableFloat(intensityRef, signal) * 16))
      const rx = w * amplitude
      const ry = h * amplitude * 0.72

      clock.advance(signal.t, () => acc.fill(0), tickTime => {
        if (decay < 1) for (let i = 0; i < acc.length; i++) acc[i] = Math.floor(acc[i]! * decay)
        const t = tickTime * speed
        for (let i = 0; i < count; i++) {
          const phase = i * phaseSpread
          const x = w * 0.5 + Math.sin(t * freqX + phase) * rx
          const y = h * 0.5 + Math.sin(t * freqY + phase * 1.31) * ry
          stampBob(acc, w, h, x, y, radius, step)
        }
      })

      for (let i = 0; i < acc.length; i++) {
        const c = acc[i]! * 3
        const o = i * 4
        data[o] = lut[c]!
        data[o + 1] = lut[c + 1]!
        data[o + 2] = lut[c + 2]!
        data[o + 3] = 255
      }
    },
    destroy() {
      field = null
    },
  }
}

/** Adds `step` (wrapping at 256) to every pixel inside the circle: a flat classic bob. */
function stampBob(acc: Uint8Array, w: number, h: number, cx: number, cy: number, radius: number, step: number): void {
  const r2 = radius * radius
  const minX = Math.max(0, Math.floor(cx - radius))
  const maxX = Math.min(w - 1, Math.ceil(cx + radius))
  const minY = Math.max(0, Math.floor(cy - radius))
  const maxY = Math.min(h - 1, Math.ceil(cy + radius))
  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - cy
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx
      if (dx * dx + dy * dy > r2) continue
      const i = y * w + x
      acc[i] = (acc[i]! + step) & (LEVELS - 1)
    }
  }
}

/** 256-entry RGB table running through the colours and back, so index wrap-around has no seam. */
function buildLoopingLut(colors: number[][]): Uint8Array {
  const loop = [...colors, ...colors.slice(1, -1).reverse()]
  const lut = new Uint8Array(LEVELS * 3)
  for (let i = 0; i < LEVELS; i++) {
    const pos = (i / LEVELS) * loop.length
    const a = loop[Math.floor(pos) % loop.length]!
    const b = loop[(Math.floor(pos) + 1) % loop.length]!
    const f = pos - Math.floor(pos)
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round((a[c] ?? 0) + ((b[c] ?? 0) - (a[c] ?? 0)) * f)
  }
  return lut
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return Number.isFinite(n) ? [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] : [0, 0, 0]
}

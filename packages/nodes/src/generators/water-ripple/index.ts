import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface WaterRippleConfig {
  damping?: AnimatableFloat
  tapMode?: 'random' | 'beat' | 'cursor' | 'none'
  tapRate?: AnimatableFloat
  tapStrength?: AnimatableFloat
  palette?: number[][]
  refraction?: AnimatableFloat
  backgroundUrl?: string
}

const DEFAULT_PALETTE = [
  [6, 18, 40],
  [24, 88, 160],
  [96, 196, 255],
  [220, 245, 255],
]

export function WaterRippleGenerator(config: Partial<WaterRippleConfig> = {}): Generator {
  const dampingRef = config.damping ?? 0.99
  const tapMode = config.tapMode ?? 'random'
  const tapRateRef = config.tapRate ?? 2
  const tapStrengthRef = config.tapStrength ?? 1
  const palette = config.palette ?? DEFAULT_PALETTE
  const refractionRef = config.refraction ?? 0.3
  let front: Float32Array | null = null
  let back: Float32Array | null = null
  let rw = 0
  let rh = 0
  let lastTapT = -999

  return {
    type: 'generator',
    id: 'water-ripple',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {
      front = null
      back = null
      rw = 0
      rh = 0
      lastTapT = -999
    },
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      if (!front || !back || rw !== w || rh !== h) {
        front = new Float32Array(w * h)
        back = new Float32Array(w * h)
        rw = w
        rh = h
        lastTapT = -999
      }
      const damping = Math.max(0.85, Math.min(0.999, resolveAnimatableFloat(dampingRef, signal)))
      const tapRate = Math.max(0, resolveAnimatableFloat(tapRateRef, signal))
      const tapStrength = Math.max(0, resolveAnimatableFloat(tapStrengthRef, signal))
      const refraction = Math.max(0, Math.min(1, resolveAnimatableFloat(refractionRef, signal)))

      if (shouldTap(signal, tapMode, tapRate, lastTapT)) {
        const px = tapMode === 'beat' ? ((Math.sin(signal.beat * Math.PI * 0.5) * 0.35 + 0.5) * (w - 1)) : Math.random() * (w - 1)
        const py = tapMode === 'beat' ? h * 0.55 : Math.random() * (h - 1)
        addImpulse(front, w, h, px, py, Math.max(2, Math.round(Math.min(w, h) * 0.035)), tapStrength)
        lastTapT = signal.t
      }

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          const next =
            (((front[i - 1] ?? 0) + (front[i + 1] ?? 0) + (front[i - w] ?? 0) + (front[i + w] ?? 0)) * 0.5 - (back[i] ?? 0)) *
            damping
          back[i] = next
        }
      }
      const tmp = front
      front = back
      back = tmp

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const h0 = front[i] ?? 0
          const hx = (front[Math.min(w * h - 1, i + 1)] ?? h0) - (front[Math.max(0, i - 1)] ?? h0)
          const hy = (front[Math.min(w * h - 1, i + w)] ?? h0) - (front[Math.max(0, i - w)] ?? h0)
          const displaced = h0 * 0.5 + (hx + hy) * refraction
          const c = samplePalette(palette, displaced * 0.5 + 0.5)
          const o = i * 4
          data[o] = c[0]
          data[o + 1] = c[1]
          data[o + 2] = c[2]
          data[o + 3] = 255
        }
      }
    },
    destroy() {
      front = null
      back = null
      rw = 0
      rh = 0
      lastTapT = -999
    },
  }
}

function shouldTap(signal: Signal, mode: NonNullable<WaterRippleConfig['tapMode']>, tapRate: number, lastTapT: number): boolean {
  if (mode === 'none' || tapRate <= 0) return false
  if (mode === 'beat') return signal.beat > 0 && Math.floor(signal.beat) !== Math.floor(Math.max(0, signal.beat - signal.dt * signal.bpm / 60))
  if (mode === 'random') return signal.t - lastTapT >= 1 / Math.max(0.001, tapRate)
  return false
}

function addImpulse(buf: Float32Array, w: number, h: number, cx: number, cy: number, radius: number, strength: number): void {
  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      const x = Math.round(cx + xx)
      const y = Math.round(cy + yy)
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue
      const d = Math.sqrt(xx * xx + yy * yy)
      if (d > radius) continue
      const i = y * w + x
      buf[i] = (buf[i] ?? 0) + (1 - d / radius) * strength
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

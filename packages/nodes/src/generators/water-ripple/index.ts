import { FixedStepClock, REFERENCE_FPS } from '../../frame-time.js'
import { createRng, DEFAULT_RANDOM_SEED } from '../../random.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface WaterRippleConfig {
  /** Image refracted by the waves. Without one, a pool-tile pattern built from `palette` is used. */
  textureUrl?: string
  /** Seed for this node's randomness (default 1); vary it to decorrelate identical nodes. */
  randomSeed?: number
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
  const textureUrl = config.textureUrl
  let tiles: { w: number; h: number; data: Uint8ClampedArray } | null = null
  let front: Float32Array | null = null
  let back: Float32Array | null = null
  const randomSeed = config.randomSeed ?? DEFAULT_RANDOM_SEED
  let rng = createRng(randomSeed)
  const clock = new FixedStepClock()
  let rw = 0
  let rh = 0
  let lastTapT = -999

  return {
    type: 'generator',
    id: 'water-ripple',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {
      rng = createRng(randomSeed)
      clock.reset()
      front = null
      back = null
      rw = 0
      rh = 0
      lastTapT = -999
    },
    render(ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      if (!front || !back || rw !== w || rh !== h) {
        front = new Float32Array(w * h)
        back = new Float32Array(w * h)
        rw = w
        rh = h
        lastTapT = -999
        clock.reset()
      }
      const damping = Math.max(0.85, Math.min(0.999, resolveAnimatableFloat(dampingRef, signal)))
      const tapRate = Math.max(0, resolveAnimatableFloat(tapRateRef, signal))
      const tapStrength = Math.max(0, resolveAnimatableFloat(tapStrengthRef, signal))
      const refraction = Math.max(0, Math.min(1, resolveAnimatableFloat(refractionRef, signal)))

      clock.advance(signal.t, () => {
        front?.fill(0)
        back?.fill(0)
        lastTapT = -999
        rng = createRng(randomSeed)
      }, tickTime => {
        if (!front || !back) return
        const tickSignal = { ...signal, t: tickTime, beat: tickTime * signal.bpm / 60, dt: 1 / REFERENCE_FPS }
        if (shouldTap(tickSignal, tapMode, tapRate, lastTapT)) {
          const px = tapMode === 'beat' ? ((Math.sin(tickSignal.beat * Math.PI * 0.5) * 0.35 + 0.5) * (w - 1)) : rng() * (w - 1)
          const py = tapMode === 'beat' ? h * 0.55 : rng() * (h - 1)
          addImpulse(front, w, h, px, py, Math.max(2, Math.round(Math.min(w, h) * 0.035)), tapStrength)
          lastTapT = tickTime
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
      })

      // Classic water: the surface slope bends the view of what lies beneath, so each pixel samples
      // the background offset by the height gradient, lightened slightly on slopes facing the light.
      const image = textureUrl ? ctx.assets?.getImage(textureUrl) : undefined
      if (!image && (tiles?.w !== w || tiles.h !== h)) tiles = { w, h, data: poolTiles(w, h, palette) }
      const bg = image ?? tiles!
      const bw = image ? image.width : w
      const bh = image ? image.height : h
      const shift = refraction * 40 * (Math.min(w, h) / 360)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const hx = (x + 1 < w ? front[i + 1]! : 0) - (x > 0 ? front[i - 1]! : 0)
          const hy = (y + 1 < h ? front[i + w]! : 0) - (y > 0 ? front[i - w]! : 0)
          const sx = Math.min(bw - 1, Math.max(0, Math.round(((x + hx * shift) * bw) / w)))
          const sy = Math.min(bh - 1, Math.max(0, Math.round(((y + hy * shift) * bh) / h)))
          const si = (sy * bw + sx) * 4
          const light = 1 + Math.max(-0.4, Math.min(0.6, -(hx + hy) * refraction * 1.5))
          const o = i * 4
          data[o] = Math.min(255, (bg.data[si] ?? 0) * light)
          data[o + 1] = Math.min(255, (bg.data[si + 1] ?? 0) * light)
          data[o + 2] = Math.min(255, (bg.data[si + 2] ?? 0) * light)
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

/** Default background: a pool floor of square tiles, shaded down through the palette's first colours. */
function poolTiles(w: number, h: number, palette: number[][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  const tile = Math.max(6, Math.round(Math.min(w, h) / 12))
  const grout = Math.max(1, Math.round(tile / 10))
  for (let y = 0; y < h; y++) {
    const base = samplePalette(palette, 0.25 + (y / Math.max(1, h - 1)) * 0.45)
    const line = samplePalette(palette, 0.9)
    for (let x = 0; x < w; x++) {
      const onGrout = x % tile < grout || y % tile < grout
      const c = onGrout ? line : base
      const o = (y * w + x) * 4
      data[o] = c[0]
      data[o + 1] = c[1]
      data[o + 2] = c[2]
      data[o + 3] = 255
    }
  }
  return data
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

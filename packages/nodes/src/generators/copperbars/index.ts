import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { scaleVerticalPeriod } from '../../viewport-scale.js'

export interface CopperbarsConfig {
  palette?: number[][]
  /** Swing speed of the bars. */
  speed?: AnimatableFloat
  /** Half-height of one bar, in pixels at the 640×360 reference. */
  barHeight?: AnimatableFloat
  /** false = quantized copper-style shading (8 steps) instead of a smooth gradient. */
  smooth?: boolean
  /** Number of bars. */
  count?: number
  alpha?: AnimatableFloat
  /** Vertical swing as a fraction of the frame height. */
  amplitude?: AnimatableFloat
  /** Phase step between consecutive bars, in radians. */
  spacing?: AnimatableFloat
  /** Hex colour behind the bars, or 'transparent'. Default black. */
  backgroundColor?: string
}

const DEFAULT_PALETTE = [
  [255, 64, 64],
  [255, 170, 48],
  [255, 240, 96],
  [72, 225, 120],
  [72, 180, 255],
  [160, 96, 255],
]

const SHADE_STEPS = 8

/**
 * Amiga-style copper bars: separate horizontal bars, each shaded dark → bright → dark,
 * swinging on sine paths. Bars on the far side of their orbit are drawn first, so near
 * bars overwrite them as they pass in front.
 */
export function CopperbarsGenerator(config: Partial<CopperbarsConfig> = {}): Generator {
  const palette = config.palette && config.palette.length > 0 ? config.palette : DEFAULT_PALETTE
  const speedRef = config.speed ?? 1
  const barHeightRef = config.barHeight ?? 8
  const smooth = config.smooth ?? true
  const count = Math.max(1, Math.min(64, Math.round(config.count ?? 8)))
  const alphaRef = config.alpha ?? 1
  const amplitudeRef = config.amplitude ?? 0.38
  const spacingRef = config.spacing ?? 0.42
  const background = config.backgroundColor === 'transparent' ? null : hexToRgb(config.backgroundColor ?? '#000000')

  return {
    type: 'generator',
    id: 'copperbars',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      const speed = resolveAnimatableFloat(speedRef, signal)
      const half = scaleVerticalPeriod(Math.max(1, resolveAnimatableFloat(barHeightRef, signal)), h)
      const alpha = Math.max(0, Math.min(1, resolveAnimatableFloat(alphaRef, signal)))
      const amplitude = Math.max(0, Math.min(0.5, resolveAnimatableFloat(amplitudeRef, signal)))
      const spacing = resolveAnimatableFloat(spacingRef, signal)
      const phase0 = signal.t * speed * 1.7

      const bars = Array.from({ length: count }, (_, i) => {
        const a = phase0 + i * spacing
        return {
          y: h * 0.5 + Math.sin(a) * h * amplitude,
          depth: Math.cos(a),
          color: palette[i % palette.length]!,
        }
      }).sort((a, b) => a.depth - b.depth)

      if (background) {
        for (let i = 0; i < data.length; i += 4) {
          data[i] = background[0]
          data[i + 1] = background[1]
          data[i + 2] = background[2]
          data[i + 3] = 255
        }
      } else {
        data.fill(0)
      }
      // Over an opaque background the colour already fades with alpha; only a transparent one needs alpha.
      const a8 = background ? 255 : Math.round(255 * alpha)
      for (const bar of bars) {
        const y0 = Math.max(0, Math.floor(bar.y - half))
        const y1 = Math.min(h - 1, Math.ceil(bar.y + half))
        for (let y = y0; y <= y1; y++) {
          const d = Math.abs(y + 0.5 - bar.y) / half
          if (d > 1) continue
          let shade = Math.cos(d * Math.PI * 0.5)
          if (!smooth) shade = Math.round(shade * SHADE_STEPS) / SHADE_STEPS
          // Highlight toward white at the bar's center, like copper palettes that end in a light line.
          const hi = Math.max(0, shade - 0.8) * 2.5
          const r = Math.round(((bar.color[0] ?? 0) * shade + 255 * hi * 0.6) * alpha)
          const g = Math.round(((bar.color[1] ?? 0) * shade + 255 * hi * 0.6) * alpha)
          const b = Math.round(((bar.color[2] ?? 0) * shade + 255 * hi * 0.6) * alpha)
          const row = y * w * 4
          for (let x = 0; x < w; x++) {
            const o = row + x * 4
            data[o] = r
            data[o + 1] = g
            data[o + 2] = b
            data[o + 3] = a8
          }
        }
      }
    },
    destroy() {},
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16)
  return Number.isFinite(n) ? [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] : [0, 0, 0]
}

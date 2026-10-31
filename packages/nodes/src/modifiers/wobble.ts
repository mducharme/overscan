import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { wrap } from '../color.js'
import { scaleThickness } from '../viewport-scale.js'

export interface WobbleConfig {
  /** Largest shift in pixels (at 640×360). */
  amplitude?: AnimatableFloat
  /** Sine waves per frame height (or width, for vertical wobble). */
  waves?: AnimatableFloat
  /** Wave phase speed in radians per second. */
  speed?: AnimatableFloat
  /** Horizontal shifts each scanline; vertical shifts each column; both does both. */
  direction?: 'horizontal' | 'vertical' | 'both'
  /** What shows where the picture moved away: its other side (wrap), the edge pixel (clamp), or nothing. */
  edges?: 'wrap' | 'clamp' | 'transparent'
  /** Second, faster sine mixed in (0–1) for a less regular, more liquid wobble. */
  turbulence?: AnimatableFloat
}

/**
 * Raster wobble: every scanline (or column) of the input is shifted by a sine of its position and
 * time, the classic wobbling logo.
 */
export function WobbleModifier(config: Partial<WobbleConfig> = {}): Modifier {
  const amplitudeRef = config.amplitude ?? 16
  const wavesRef = config.waves ?? 2
  const speedRef = config.speed ?? 3
  const turbulenceRef = config.turbulence ?? 0
  const direction = config.direction ?? 'horizontal'
  const edges = config.edges ?? 'transparent'

  return {
    type: 'modifier',
    id: 'wobble',
    persistent: false,
    config: config,
    init() {},
    destroy() {},
    apply(_ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      const amp = scaleThickness(resolveAnimatableFloat(amplitudeRef, signal), w, h)
      const waves = resolveAnimatableFloat(wavesRef, signal)
      const phase = resolveAnimatableFloat(speedRef, signal) * signal.t
      const turbulence = Math.max(0, Math.min(1, resolveAnimatableFloat(turbulenceRef, signal)))
      const shiftAt = (pos: number, span: number): number => {
        const a = (pos / span) * waves * Math.PI * 2 + phase
        return amp * ((1 - turbulence) * Math.sin(a) + turbulence * Math.sin(a * 2.7 - phase * 1.9))
      }
      const rowShift = new Float32Array(h)
      const colShift = new Float32Array(w)
      if (direction !== 'vertical') for (let y = 0; y < h; y++) rowShift[y] = shiftAt(y, h)
      if (direction !== 'horizontal') for (let x = 0; x < w; x++) colShift[x] = shiftAt(x, w)
      for (let y = 0; y < h; y++) {
        const dx = rowShift[y]!
        for (let x = 0; x < w; x++) {
          let sx = Math.round(x - dx)
          let sy = Math.round(y - colShift[x]!)
          const o = (y * w + x) * 4
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) {
            if (edges === 'transparent') {
              dst[o] = 0; dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = 0
              continue
            }
            sx = edges === 'wrap' ? wrap(sx, w) : Math.max(0, Math.min(w - 1, sx))
            sy = edges === 'wrap' ? wrap(sy, h) : Math.max(0, Math.min(h - 1, sy))
          }
          const s = (sy * w + sx) * 4
          dst[o] = src[s]!; dst[o + 1] = src[s + 1]!; dst[o + 2] = src[s + 2]!; dst[o + 3] = src[s + 3]!
        }
      }
    },
  }
}

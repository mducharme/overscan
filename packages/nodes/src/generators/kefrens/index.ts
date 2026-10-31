import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { fillRgb, hexToRgb, readPalette, samplePalette, type Rgb } from '../../color.js'
import { scaleThickness } from '../../viewport-scale.js'

export interface KefrensConfig {
  /** Colours across one bar, edge to centre to edge (the centre is the brightest entry). */
  palette?: number[][]
  backgroundColor?: string
  /** Bar width in pixels (at 640×360). */
  barWidth?: AnimatableFloat
  /** Horizontal swing as a fraction of the frame width. */
  amplitude?: AnimatableFloat
  /** Sine periods down the screen. */
  waves?: AnimatableFloat
  /** Phase speed in radians per second. */
  speed?: AnimatableFloat
  /** A second sine on top, for the twisting, looping walls (0 for a plain snake). */
  twist?: AnimatableFloat
  /** First row the bars start at, 0–1 of the height (the space above stays background). */
  top?: number
}

const PALETTE: Rgb[] = [[30, 6, 60], [120, 30, 160], [255, 90, 200], [255, 230, 255]]

/**
 * Kefrens bars: one shaded bar drawn on every scanline into a line buffer that is never cleared,
 * so as its position swings from line to line the bars pile up into twisting walls.
 */
export function KefrensGenerator(config: Partial<KefrensConfig> = {}): Generator {
  const palette = readPalette(config.palette, PALETTE)
  const background = hexToRgb(config.backgroundColor ?? '#05030c', [5, 3, 12])
  const barWidthRef = config.barWidth ?? 22
  const amplitudeRef = config.amplitude ?? 0.36
  const wavesRef = config.waves ?? 1.3
  const speedRef = config.speed ?? 2.2
  const twistRef = config.twist ?? 0.45
  const top = Math.max(0, Math.min(0.95, config.top ?? 0.12))

  return {
    type: 'generator',
    id: 'kefrens',
    renderers: ['cpu'],
    config: config,
    init() {},
    destroy() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      fillRgb(data, background)
      const barW = Math.max(3, Math.round(scaleThickness(resolveAnimatableFloat(barWidthRef, signal), w, h)))
      const amp = resolveAnimatableFloat(amplitudeRef, signal) * w
      const waves = resolveAnimatableFloat(wavesRef, signal)
      const phase = resolveAnimatableFloat(speedRef, signal) * signal.t
      const twist = resolveAnimatableFloat(twistRef, signal)
      // One bar, shaded across its width.
      const bar = new Uint8ClampedArray(barW * 3)
      const c: Rgb = [0, 0, 0]
      for (let i = 0; i < barW; i++) {
        const across = 1 - Math.abs((i + 0.5) / barW * 2 - 1)
        samplePalette(palette, across, c)
        bar[i * 3] = c[0]; bar[i * 3 + 1] = c[1]; bar[i * 3 + 2] = c[2]
      }
      const line = new Uint8ClampedArray(w * 3)
      for (let x = 0; x < w; x++) { line[x * 3] = background[0]; line[x * 3 + 1] = background[1]; line[x * 3 + 2] = background[2] }
      const start = Math.floor(top * h)
      for (let y = start; y < h; y++) {
        const k = (y - start) / Math.max(1, h - start)
        const a = k * waves * Math.PI * 2 + phase
        const pos = w / 2 + amp * ((1 - twist) * Math.sin(a) + twist * Math.sin(a * 2.3 + phase * 0.7)) - barW / 2
        const x0 = Math.round(pos)
        for (let i = 0; i < barW; i++) {
          const x = x0 + i
          if (x < 0 || x >= w) continue
          line[x * 3] = bar[i * 3]!; line[x * 3 + 1] = bar[i * 3 + 1]!; line[x * 3 + 2] = bar[i * 3 + 2]!
        }
        const row = y * w * 4
        for (let x = 0; x < w; x++) {
          const o = row + x * 4
          data[o] = line[x * 3]!; data[o + 1] = line[x * 3 + 1]!; data[o + 2] = line[x * 3 + 2]!
        }
      }
    },
  }
}

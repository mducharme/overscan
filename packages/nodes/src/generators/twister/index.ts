import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'

export interface TwisterConfig {
  palette?: number[][]
  backgroundColor?: string
  twistSpeed?: AnimatableFloat
  verticalFrequency?: AnimatableFloat
  width?: AnimatableFloat
  sway?: AnimatableFloat
  centerX?: AnimatableFloat
  shading?: AnimatableFloat
}

const DEFAULT_PALETTE = [
  [255, 72, 154],
  [255, 203, 76],
  [92, 246, 164],
  [86, 168, 255],
]

/**
 * Classic twister: every scanline is a square cross-section rotated by an angle that varies down
 * the screen. Its four corners sit at `cx + sin(a + k·π/2)·R`; a face is visible when its right
 * corner lies right of its left one, and it is shaded by its projected width (a face pointing at
 * the viewer is widest and brightest).
 */
export function TwisterGenerator(config: Partial<TwisterConfig> = {}): Generator {
  const palette = (config.palette?.length ? config.palette : DEFAULT_PALETTE).slice(0, 4)
  const background = hexToRgb(config.backgroundColor ?? '#050812')
  const twistSpeedRef = config.twistSpeed ?? 1.6
  const verticalFrequencyRef = config.verticalFrequency ?? 1.35
  const widthRef = config.width ?? 0.24
  const swayRef = config.sway ?? 0.16
  const centerXRef = config.centerX ?? 0.5
  const shadingRef = config.shading ?? 0.7

  return {
    type: 'generator',
    id: 'twister',
    renderers: ['cpu'],
    config: config as Generator['config'],
    init() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const twistSpeed = resolveAnimatableFloat(twistSpeedRef, signal)
      const verticalFrequency = Math.max(0.05, resolveAnimatableFloat(verticalFrequencyRef, signal))
      const width = Math.max(0.04, Math.min(0.45, resolveAnimatableFloat(widthRef, signal)))
      const sway = Math.max(0, Math.min(0.35, resolveAnimatableFloat(swayRef, signal)))
      const centerX = Math.max(0.1, Math.min(0.9, resolveAnimatableFloat(centerXRef, signal)))
      const shading = Math.max(0, Math.min(1, resolveAnimatableFloat(shadingRef, signal)))
      renderCpu(out, signal.t, palette, background, twistSpeed, verticalFrequency, width, sway, centerX, shading)
    },
    destroy() {},
  }
}

const QUARTER = Math.PI * 0.5

function renderCpu(
  out: FrameBuffer,
  time: number,
  palette: number[][],
  background: [number, number, number],
  twistSpeed: number,
  verticalFrequency: number,
  width: number,
  sway: number,
  centerX: number,
  shading: number,
): void {
  const { width: w, height: h, data } = out
  // Corner radius: the widest a face can appear is R·√2, so the column spans at most 0.7 × `width` of the frame.
  const radius = (width * w * 0.7) / Math.SQRT2
  const corners = [0, 0, 0, 0, 0]
  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1)
    // Linear twist down the column whose amount swings over time, so it winds one way and then the other.
    const angle = time * twistSpeed + (v - 0.5) * Math.PI * verticalFrequency * Math.sin(time * 0.6)
    const cx = (centerX + Math.sin(v * 5.2 + time * 0.85) * sway) * w
    for (let k = 0; k < 4; k++) corners[k] = cx + Math.sin(angle + k * QUARTER) * radius
    corners[4] = corners[0]!
    fillRow(data, w, y, background)
    for (let k = 0; k < 4; k++) {
      const left = corners[k]!
      const right = corners[k + 1]!
      if (right <= left) continue
      const face = (right - left) / (radius * Math.SQRT2)
      const shade = mix(1, 0.25 + 0.75 * face, shading)
      const base = palette[k % palette.length] ?? DEFAULT_PALETTE[k]!
      const x0 = Math.max(0, Math.ceil(left))
      const x1 = Math.min(w - 1, Math.floor(right))
      for (let x = x0; x <= x1; x++) {
        // Darken one pixel at each face edge so neighbouring faces stay distinct.
        const edge = x === x0 || x === x1 ? 0.55 : 1
        const o = (y * w + x) * 4
        data[o] = clamp255((base[0] ?? 0) * shade * edge)
        data[o + 1] = clamp255((base[1] ?? 0) * shade * edge)
        data[o + 2] = clamp255((base[2] ?? 0) * shade * edge)
        data[o + 3] = 255
      }
    }
  }
}

function fillRow(data: Uint8ClampedArray, w: number, y: number, color: [number, number, number]): void {
  const row = y * w * 4
  for (let x = 0; x < w; x++) {
    const o = row + x * 4
    data[o] = color[0]
    data[o + 1] = color[1]
    data[o + 2] = color[2]
    data[o + 3] = 255
  }
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const expanded = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized
  const value = parseInt(expanded, 16)
  if (!Number.isFinite(value)) return [255, 255, 255]
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

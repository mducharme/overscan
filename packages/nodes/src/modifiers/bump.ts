import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { hexToRgb } from '../color.js'
import { scaleThickness, viewportMinDim } from '../viewport-scale.js'

export interface BumpConfig {
  /** Light position, 0–1 of the frame. Unset: the light circles the centre. */
  lightX?: AnimatableFloat
  lightY?: AnimatableFloat
  /** Size of the light's pool, as a fraction of the frame's short side. */
  radius?: AnimatableFloat
  /** How strongly the input's brightness tilts the surface. */
  depth?: AnimatableFloat
  /** light: the light's colour on a grey surface. surface: the input's own colours, lit. */
  color?: 'light' | 'surface'
  lightColor?: string
  /** Light that reaches the whole surface, 0–1. */
  ambient?: AnimatableFloat
  /** Blur of the height map in pixels (at 640×360): rounder, smoother relief. */
  soften?: number
}

/**
 * 2D bump mapping: the input's brightness is a height map (a logo works well), lit by a moving point
 * light. Slopes facing the light catch it, the rest falls into shadow.
 */
export function BumpModifier(config: Partial<BumpConfig> = {}): Modifier {
  const lightXRef = config.lightX
  const lightYRef = config.lightY
  const radiusRef = config.radius ?? 0.8
  const depthRef = config.depth ?? 4
  const colorMode = config.color ?? 'light'
  const lightColor = hexToRgb(config.lightColor ?? '#ffe6b0', [255, 230, 176])
  const ambientRef = config.ambient ?? 0.12
  const soften = Math.max(0, config.soften ?? 3)
  let height = new Float32Array(0)
  let scratch = new Float32Array(0)

  return {
    type: 'modifier',
    id: 'bump',
    persistent: false,
    config: config,
    init() {},
    destroy() {},
    apply(_ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      if (height.length !== w * h) height = new Float32Array(w * h)
      for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        height[i] = ((src[p]! * 0.299 + src[p + 1]! * 0.587 + src[p + 2]! * 0.114) / 255) * (src[p + 3]! / 255)
      }
      const blur = Math.round(scaleThickness(soften, w, h))
      if (blur > 0) {
        if (scratch.length !== w * h) scratch = new Float32Array(w * h)
        boxBlur(height, scratch, w, h, blur)
        boxBlur(height, scratch, w, h, blur)
      }
      const t = signal.t
      const lx = (lightXRef !== undefined ? resolveAnimatableFloat(lightXRef, signal) : 0.5 + 0.32 * Math.cos(t * 1.1)) * w
      const ly = (lightYRef !== undefined ? resolveAnimatableFloat(lightYRef, signal) : 0.5 + 0.3 * Math.sin(t * 1.7)) * h
      const unit = viewportMinDim(w, h)
      const radius = Math.max(1, resolveAnimatableFloat(radiusRef, signal) * unit)
      // Slope gain: a blurred edge (a height change spread over a few pixels) tilts the surface steeply.
      const depth = resolveAnimatableFloat(depthRef, signal) * 6 * (unit / 360)
      const ambient = Math.max(0, Math.min(1, resolveAnimatableFloat(ambientRef, signal)))
      // The light hovers above the surface.
      const lz = unit * 0.22
      for (let y = 0; y < h; y++) {
        const up = (y > 0 ? y - 1 : y) * w
        const down = (y < h - 1 ? y + 1 : y) * w
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          const sx = (height[i + (x < w - 1 ? 1 : 0)]! - height[i - (x > 0 ? 1 : 0)]!) * depth
          const sy = (height[down + x]! - height[up + x]!) * depth
          // Surface normal from the slopes, light direction from this point to the light.
          const nl = 1 / Math.sqrt(sx * sx + sy * sy + 1)
          const dx = lx - x, dy = ly - y
          const dist = Math.sqrt(dx * dx + dy * dy + lz * lz)
          const diffuse = Math.max(0, (-sx * dx - sy * dy + lz) * nl / dist)
          const fall = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / radius)
          const lit = ambient + (1 - ambient) * diffuse * fall
          const glint = Math.pow(diffuse, 24) * fall * 200
          const o = i * 4
          if (colorMode === 'surface') {
            dst[o] = src[o]! * lit * 1.5 + glint
            dst[o + 1] = src[o + 1]! * lit * 1.5 + glint
            dst[o + 2] = src[o + 2]! * lit * 1.5 + glint
          } else {
            const shade = lit * (0.55 + 0.45 * height[i]!)
            dst[o] = lightColor[0] * shade + glint
            dst[o + 1] = lightColor[1] * shade + glint
            dst[o + 2] = lightColor[2] * shade + glint
          }
          dst[o + 3] = 255
        }
      }
    },
  }
}

/** Separable box blur of a single-channel map, in place (`tmp` is scratch space of the same size). */
function boxBlur(map: Float32Array, tmp: Float32Array, w: number, h: number, r: number): void {
  const span = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let sum = 0
    const row = y * w
    for (let x = -r; x <= r; x++) sum += map[row + Math.min(w - 1, Math.max(0, x))]!
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span
      sum += map[row + Math.min(w - 1, x + r + 1)]! - map[row + Math.max(0, x - r)]!
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!
    for (let y = 0; y < h; y++) {
      map[y * w + x] = sum / span
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!
    }
  }
}

import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { fillRgb, hexToRgb, readPalette, samplePalette, type Rgb } from '../../color.js'
import { scaleFovMultiplier, scaleThickness } from '../../viewport-scale.js'

export interface DotTunnelConfig {
  palette?: number[][]
  backgroundColor?: string
  /** Rings in view and dots per ring. */
  rings?: number
  dotsPerRing?: number
  /** Forward speed in rings per second. */
  speed?: AnimatableFloat
  /** How far the tunnel's path curves (0 is straight). */
  bend?: AnimatableFloat
  /** Ring spin in radians per second; with `twist` each ring is turned a little more than the last. */
  spin?: AnimatableFloat
  twist?: AnimatableFloat
  /** Ring radius: constant for a tunnel; with `flower`, rings bulge into petals (dot flower). */
  flower?: AnimatableFloat
  petals?: number
  /** Dot radius in pixels for the nearest ring (at 640×360). */
  dotSize?: AnimatableFloat
}

const PALETTE: Rgb[] = [[40, 20, 90], [80, 140, 255], [140, 255, 230], [255, 255, 255]]

/** Dot tunnel: rings of dots rushing towards the viewer along a curving path; with petals, a dot flower. */
export function DotTunnelGenerator(config: Partial<DotTunnelConfig> = {}): Generator {
  const palette = readPalette(config.palette, PALETTE)
  const background = hexToRgb(config.backgroundColor ?? '#020208', [2, 2, 8])
  const rings = Math.max(4, Math.round(config.rings ?? 40))
  const dots = Math.max(3, Math.round(config.dotsPerRing ?? 24))
  const speedRef = config.speed ?? 6
  const bendRef = config.bend ?? 0.6
  const spinRef = config.spin ?? 0.6
  const twistRef = config.twist ?? 0.08
  const flowerRef = config.flower ?? 0
  const petals = Math.max(1, Math.round(config.petals ?? 6))
  const dotSizeRef = config.dotSize ?? 4
  // World units: ring radius 1, rings SPACING apart, the nearest drawn ring NEAR in front of the camera.
  const SPACING = 0.9
  const NEAR = 0.9

  return {
    type: 'generator',
    id: 'dot-tunnel',
    renderers: ['cpu'],
    config: config,
    init() {},
    destroy() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      fillRgb(data, background)
      const t = signal.t
      const travel = resolveAnimatableFloat(speedRef, signal) * t
      const bend = resolveAnimatableFloat(bendRef, signal)
      const spin = resolveAnimatableFloat(spinRef, signal) * t
      const twist = resolveAnimatableFloat(twistRef, signal)
      const flower = resolveAnimatableFloat(flowerRef, signal)
      const dotSize = scaleThickness(resolveAnimatableFloat(dotSizeRef, signal), w, h)
      const fov = scaleFovMultiplier(170, w, h)
      // The path's centre at a distance along the tunnel; the camera sits on it at `travel`.
      const pathX = (d: number): number => bend * (Math.sin(d * 0.21) + 0.5 * Math.sin(d * 0.53))
      const pathY = (d: number): number => bend * 0.7 * Math.cos(d * 0.17)
      const camRing = travel
      const c: Rgb = [0, 0, 0]
      // Far rings first, so near dots draw over far ones.
      const firstRing = Math.floor(camRing)
      for (let k = rings; k >= 0; k--) {
        const ring = firstRing + k
        const z = (ring - camRing) * SPACING + NEAR
        if (z <= NEAR * 0.5) continue
        const offX = pathX(ring) - pathX(camRing)
        const offY = pathY(ring) - pathY(camRing)
        const fade = (1 - Math.min(1, (z - NEAR) / (rings * SPACING))) ** 1.6
        samplePalette(palette, fade, c)
        const size = Math.max(0.7, (dotSize * NEAR * 1.6) / z)
        for (let d = 0; d < dots; d++) {
          const a = (d / dots) * Math.PI * 2 + spin + ring * twist
          const r = 1 + flower * 0.45 * Math.sin(petals * a)
          const px = w / 2 + ((offX + Math.cos(a) * r) * fov) / z
          const py = h / 2 + ((offY + Math.sin(a) * r) * fov) / z
          drawDot(data, w, h, px, py, size, c, Math.min(1, 0.25 + fade))
        }
      }
    },
  }
}

/** A soft round dot, added over what is there. */
function drawDot(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number, c: Rgb, alpha: number): void {
  const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(w - 1, Math.ceil(cx + r + 1))
  const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(h - 1, Math.ceil(cy + r + 1))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const k = Math.max(0, Math.min(1, r + 0.5 - d)) * alpha
      if (k <= 0) continue
      const o = (y * w + x) * 4
      data[o] = data[o]! + (c[0] - data[o]!) * k
      data[o + 1] = data[o + 1]! + (c[1] - data[o + 1]!) * k
      data[o + 2] = data[o + 2]! + (c[2] - data[o + 2]!) * k
    }
  }
}

import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Modifier,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { wrap } from '../color.js'

/** Mirrored repeat: 0→1 then back 1→0, so inputs that do not tile show no seam. */
const mirror = (v: number, n: number): number => {
  const m = wrap(v, 2 * n)
  return m < n ? m : 2 * n - 1 - m
}
import { viewportMinDim } from '../viewport-scale.js'

export type UvPreset = 'tunnel' | 'flower' | 'sphere' | 'twirl'

export interface UvMapConfig {
  /**
   * tunnel: the input wraps the inside of an endless tube. flower: a tunnel whose walls bulge into
   * petals. sphere: the input wraps a ball. twirl: the input itself, twisted around the centre.
   */
  preset?: UvPreset
  /** Centre, 0–1 of the frame. */
  centerX?: AnimatableFloat
  centerY?: AnimatableFloat
  zoom?: AnimatableFloat
  /** Texture scroll in repeats per second: around (u) and along/up (v). */
  speedU?: AnimatableFloat
  speedV?: AnimatableFloat
  /** Extra rotation in radians. */
  rotation?: AnimatableFloat
  /** Twirl angle at the centre (radians), or petal depth for flower (0–1). */
  amount?: AnimatableFloat
  /** Petals around a flower tunnel. */
  petals?: number
  /** Sphere and twirl radius, as a fraction of the frame's short side. */
  radius?: AnimatableFloat
  /** Darkening with depth (tunnel, flower) or lighting (sphere), 0–1. */
  shade?: AnimatableFloat
  /** How many times the input repeats around the tunnel or ball. */
  repeat?: number
}

/**
 * Texture mapping by coordinate tables: each output pixel reads the input at a computed (u, v). One
 * node covers the classic tunnel, flower tunnel, sphere mapping and twirl, applied to any input.
 */
export function UvMapModifier(config: Partial<UvMapConfig> = {}): Modifier {
  const preset = config.preset ?? 'tunnel'
  const centerXRef = config.centerX ?? 0.5
  const centerYRef = config.centerY ?? 0.5
  const zoomRef = config.zoom ?? 1
  const speedURef = config.speedU ?? (preset === 'sphere' ? 0.08 : 0)
  const speedVRef = config.speedV ?? (preset === 'tunnel' || preset === 'flower' ? 0.6 : 0)
  const rotationRef = config.rotation ?? 0
  const amountRef = config.amount ?? (preset === 'twirl' ? 3 : 0.5)
  const petals = Math.max(1, Math.round(config.petals ?? 5))
  const radiusRef = config.radius ?? (preset === 'sphere' ? 0.42 : 0.6)
  const shadeRef = config.shade ?? 0.8
  const repeat = Math.max(1, Math.round(config.repeat ?? (preset === 'sphere' ? 2 : 1)))
  // Fixed light for the sphere: up-left and towards the viewer.
  const light = normalize(-0.45, -0.55, 0.7)

  return {
    type: 'modifier',
    id: 'uv-map',
    persistent: false,
    config: config,
    init() {},
    destroy() {},
    apply(_ctx: NodeContext, input: FrameBuffer, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h } = input
      const src = input.data
      const dst = out.data
      const unit = viewportMinDim(w, h)
      const cx = resolveAnimatableFloat(centerXRef, signal) * w
      const cy = resolveAnimatableFloat(centerYRef, signal) * h
      const zoom = Math.max(1e-3, resolveAnimatableFloat(zoomRef, signal))
      const scrollU = resolveAnimatableFloat(speedURef, signal) * signal.t
      const scrollV = resolveAnimatableFloat(speedVRef, signal) * signal.t
      const rotation = resolveAnimatableFloat(rotationRef, signal)
      const amount = resolveAnimatableFloat(amountRef, signal)
      const radius = Math.max(1e-3, resolveAnimatableFloat(radiusRef, signal))
      const shade = Math.max(0, Math.min(1, resolveAnimatableFloat(shadeRef, signal)))
      const phase = signal.t * 1.3

      for (let y = 0; y < h; y++) {
        const py = (y + 0.5 - cy) / unit
        for (let x = 0; x < w; x++) {
          const px = (x + 0.5 - cx) / unit
          const o = (y * w + x) * 4
          const r = Math.sqrt(px * px + py * py)
          let sx: number
          let sy: number
          let light01 = 1
          if (preset === 'twirl') {
            // Screen-space twist: rotation grows towards the centre and fades out at the radius.
            const a = Math.atan2(py, px) + rotation + (r < radius ? amount * (1 - r / radius) ** 2 : 0)
            const rr = r / zoom
            sx = cx + Math.cos(a) * rr * unit
            sy = cy + Math.sin(a) * rr * unit
            sx = mirror(Math.floor(sx), w)
            sy = mirror(Math.floor(sy), h)
          } else if (preset === 'sphere') {
            if (r >= radius) {
              dst[o] = 0; dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = 0
              continue
            }
            const nx = px / radius
            const ny = py / radius
            const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
            const lon = Math.atan2(nx, nz) + rotation
            const lat = Math.asin(Math.max(-1, Math.min(1, ny)))
            const u = (lon / (Math.PI * 2)) * repeat / zoom + scrollU
            const v = (lat / Math.PI + 0.5) * repeat / zoom + scrollV
            sx = mirror(Math.floor(u * w), w)
            sy = mirror(Math.floor(v * h), h)
            const diffuse = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2])
            light01 = 1 - shade + shade * (0.15 + 0.95 * diffuse)
            // Specular highlight, added below as white.
            const spec = shade * Math.pow(diffuse, 24) * 0.6
            const s = (sy * w + sx) * 4
            dst[o] = Math.min(255, src[s]! * light01 + spec * 255)
            dst[o + 1] = Math.min(255, src[s + 1]! * light01 + spec * 255)
            dst[o + 2] = Math.min(255, src[s + 2]! * light01 + spec * 255)
            // Soft rim so the ball's edge is not jagged.
            dst[o + 3] = Math.min(1, (radius - r) * unit) * src[s + 3]!
            continue
          } else {
            // Tunnel and flower: angle around the tube, depth from the distance to the centre.
            const a = Math.atan2(py, px) + rotation
            const wall = preset === 'flower' ? 1 + amount * 0.6 * Math.sin(petals * a + phase) : 1
            const depth = (0.3 * zoom) / Math.max(1e-3, r * wall)
            const u = (a / (Math.PI * 2)) * repeat + scrollU
            const v = depth + scrollV
            sx = mirror(Math.floor(u * w), w)
            sy = mirror(Math.floor(v * h), h)
            light01 = 1 - shade + shade * Math.min(1, r * wall * 2.4)
          }
          const s = (sy * w + sx) * 4
          dst[o] = src[s]! * light01
          dst[o + 1] = src[s + 1]! * light01
          dst[o + 2] = src[s + 2]! * light01
          dst[o + 3] = src[s + 3]!
        }
      }
    },
  }
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type FrameBuffer,
  type Generator,
  type NodeContext,
  type Signal,
} from '@overscan/types'
import { fillRgb, hexToRgb, readPalette, samplePalette, type Rgb } from '../../color.js'
import { DEFAULT_RANDOM_SEED, hash01 } from '../../random.js'
import { scaleThickness, viewportMinDim } from '../../viewport-scale.js'

export interface ParticlesConfig {
  /**
   * fountain: a jet from the emitter, falling under gravity. explosion: bursts at random spots.
   * vortex: particles spiral into the centre. attractor: a Clifford strange attractor cloud.
   */
  mode?: 'fountain' | 'explosion' | 'vortex' | 'attractor'
  count?: number
  /** Colours over a particle's life, birth to death (for the attractor: by density). */
  palette?: number[][]
  /** 'transparent' leaves the background clear for compositing. */
  backgroundColor?: string
  /** Emitter position, 0–1 of the frame (fountain, vortex centre). */
  emitX?: AnimatableFloat
  emitY?: AnimatableFloat
  /** Launch speed, in frame short-sides per second. */
  speed?: AnimatableFloat
  /** Fountain spread around straight up, in radians. */
  spread?: AnimatableFloat
  gravity?: AnimatableFloat
  /** Seconds a particle lives (fountain, vortex), or between bursts (explosion). */
  lifetime?: AnimatableFloat
  /** Particle radius in pixels (at 640×360). */
  size?: AnimatableFloat
  randomSeed?: number
}

const PALETTE: Rgb[] = [[255, 255, 230], [255, 200, 80], [255, 80, 40], [90, 20, 60]]

/**
 * Particle systems computed from time alone (so seeking and exports are exact): fountains,
 * explosions, a vortex and a strange-attractor cloud, drawn as glowing dots.
 */
export function ParticlesGenerator(config: Partial<ParticlesConfig> = {}): Generator {
  const mode = config.mode ?? 'fountain'
  const count = Math.max(1, Math.min(200_000, Math.round(config.count ?? (mode === 'attractor' ? 60_000 : 1500))))
  const palette = readPalette(config.palette, PALETTE)
  const background = config.backgroundColor === 'transparent' ? null : hexToRgb(config.backgroundColor ?? '#04030a', [4, 3, 10])
  const emitXRef = config.emitX ?? 0.5
  const emitYRef = config.emitY ?? (mode === 'fountain' ? 0.92 : 0.5)
  const speedRef = config.speed ?? (mode === 'explosion' ? 0.9 : 1.15)
  const spreadRef = config.spread ?? 0.35
  const gravityRef = config.gravity ?? (mode === 'explosion' ? 0.5 : 1.2)
  const lifetimeRef = config.lifetime ?? (mode === 'explosion' ? 1.6 : 2.2)
  const sizeRef = config.size ?? (mode === 'attractor' ? 0.6 : 2)
  const seed = config.randomSeed ?? DEFAULT_RANDOM_SEED
  let light = new Float32Array(0)
  let lut: Float32Array | null = null

  return {
    type: 'generator',
    id: 'particles',
    renderers: ['cpu'],
    config: config,
    init() {},
    destroy() {},
    render(_ctx: NodeContext, out: FrameBuffer, signal: Signal): void {
      const { width: w, height: h, data } = out
      if (background) fillRgb(data, background)
      else data.fill(0)
      const t = signal.t
      const unit = viewportMinDim(w, h)
      const ex = resolveAnimatableFloat(emitXRef, signal) * w
      const ey = resolveAnimatableFloat(emitYRef, signal) * h
      const speed = resolveAnimatableFloat(speedRef, signal) * unit
      const gravity = resolveAnimatableFloat(gravityRef, signal) * unit
      const life = Math.max(0.05, resolveAnimatableFloat(lifetimeRef, signal))
      const size = Math.max(0.3, scaleThickness(resolveAnimatableFloat(sizeRef, signal), w, h))
      const spread = resolveAnimatableFloat(spreadRef, signal)
      const c: Rgb = [0, 0, 0]
      const plot = (x: number, y: number, age01: number, alpha: number): void => {
        samplePalette(palette, age01, c)
        glow(data, w, h, x, y, size, c, alpha, background === null)
      }

      if (mode === 'attractor') {
        // Clifford attractor with fixed, chaotic parameters: changing them over time drops the cloud into
        // periodic windows where it collapses to a few points. It turns and breathes instead.
        const a = -1.4, b = 1.6, cc = 1.0, d = 0.7
        let x = 0.1, y = 0.1
        const scale = unit * 0.2 * (1 + 0.06 * Math.sin(t * 0.5))
        const turn = t * 0.12
        const cos = Math.cos(turn), sin = Math.sin(turn)
        // Small points (the usual case) splat into a light buffer, coloured from a palette table: much
        // cheaper than a soft dot each. Each splat carries the same total light as the dot it replaces.
        const splat = size <= 1
        if (splat) {
          if (light.length !== w * h * 3) light = new Float32Array(w * h * 3)
          else light.fill(0)
          lut ??= paletteTable(palette)
        }
        const energy = 0.35 * (Math.PI * (size + 0.75) ** 2) / 3
        for (let i = 0; i < count + 50; i++) {
          const nx = Math.sin(a * y) + cc * Math.cos(a * x)
          const ny = Math.sin(b * x) + d * Math.cos(b * y)
          x = nx; y = ny
          if (i < 50) continue
          const age01 = 1 - Math.min(1, Math.hypot(x, y) / 2.5)
          if (!splat) {
            plot(ex + (x * cos - y * sin) * scale, ey + (x * sin + y * cos) * scale, age01, 0.35)
            continue
          }
          addSplat(light, lut!, w, h, ex + (x * cos - y * sin) * scale - 0.5, ey + (x * sin + y * cos) * scale - 0.5, age01, energy)
        }
        if (splat) {
          for (let p = 0, o = 0; p < light.length; p += 3, o += 4) {
            const r = light[p]!, g = light[p + 1]!, bl = light[p + 2]!
            if (r + g + bl === 0) continue
            data[o] = data[o]! + r; data[o + 1] = data[o + 1]! + g; data[o + 2] = data[o + 2]! + bl
            if (!background) data[o + 3] = data[o + 3]! + Math.max(r, g, bl)
          }
        }
        return
      }

      for (let i = 0; i < count; i++) {
        if (mode === 'explosion') {
          const cycle = Math.floor(t / life)
          const age = t - cycle * life
          const cx = w * (0.2 + 0.6 * hash01(seed, cycle, 1))
          const cy = h * (0.2 + 0.5 * hash01(seed, cycle, 2))
          const angle = hash01(seed, cycle, i, 3) * Math.PI * 2
          const v = speed * (0.2 + 0.8 * Math.sqrt(hash01(seed, cycle, i, 4)))
          // Air drag: velocity decays, so particles slow down and then sink.
          const k = 2.2
          const travel = (1 - Math.exp(-k * age)) / k
          const x = cx + Math.cos(angle) * v * travel
          const y = cy + Math.sin(angle) * v * travel + 0.5 * gravity * age * age
          plot(x, y, age / life, 1 - age / life)
          continue
        }
        // Fountain and vortex: particle i is born every `life` seconds at its own offset.
        const offset = (i / count) * life
        if (t < offset) continue
        const cycle = Math.floor((t - offset) / life)
        const age = t - offset - cycle * life
        const age01 = age / life
        if (mode === 'fountain') {
          const angle = -Math.PI / 2 + (hash01(seed, i, cycle, 1) - 0.5) * 2 * spread
          const v = speed * (0.75 + 0.25 * hash01(seed, i, cycle, 2))
          const x = ex + Math.cos(angle) * v * age
          const y = ey + Math.sin(angle) * v * age + 0.5 * gravity * age * age
          plot(x, y, age01, 1 - age01 * age01)
        } else {
          // Vortex: start on a wide ring and spiral in, faster as the radius shrinks.
          const r0 = unit * (0.3 + 0.35 * hash01(seed, i, cycle, 1))
          const r = r0 * (1 - age01) ** 1.5 + 2
          const a0 = hash01(seed, i, cycle, 2) * Math.PI * 2
          const a = a0 + (speed / unit) * 2.5 * Math.log(1 + age * 4) * (r0 / Math.max(r, 4)) ** 0.5
          plot(ex + Math.cos(a) * r, ey + Math.sin(a) * r * 0.85, age01, Math.min(1, age01 * 4) * (1 - age01 * 0.5))
        }
      }
    },
  }
}

/** Additive soft dot. On a transparent background, alpha builds up with the light. */
function glow(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number, c: Rgb, alpha: number, transparent: boolean): void {
  if (alpha <= 0) return
  const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(w - 1, Math.ceil(cx + r + 1))
  const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(h - 1, Math.ceil(cy + r + 1))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const k = Math.max(0, 1 - d / (r + 0.75)) * alpha
      if (k <= 0) continue
      const o = (y * w + x) * 4
      data[o] = data[o]! + c[0] * k
      data[o + 1] = data[o + 1]! + c[1] * k
      data[o + 2] = data[o + 2]! + c[2] * k
      if (transparent) data[o + 3] = data[o + 3]! + 255 * k
    }
  }
}

const LUT_SIZE = 256

/** The palette sampled at LUT_SIZE steps, as r, g, b triples. */
function paletteTable(palette: readonly Rgb[]): Float32Array {
  const table = new Float32Array(LUT_SIZE * 3)
  const c: Rgb = [0, 0, 0]
  for (let i = 0; i < LUT_SIZE; i++) {
    samplePalette(palette, i / (LUT_SIZE - 1), c)
    table[i * 3] = c[0]; table[i * 3 + 1] = c[1]; table[i * 3 + 2] = c[2]
  }
  return table
}

/** Adds `energy` of the palette colour at `t` to the four pixels around (x, y), bilinearly. */
function addSplat(light: Float32Array, lut: Float32Array, w: number, h: number, x: number, y: number, t: number, energy: number): void {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  if (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h) return
  const fx = x - x0, fy = y - y0
  const li = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(t * (LUT_SIZE - 1)))) * 3
  const r = lut[li]! * energy, g = lut[li + 1]! * energy, b = lut[li + 2]! * energy
  const put = (px: number, py: number, k: number): void => {
    if (px < 0 || py < 0 || px >= w || py >= h || k <= 0) return
    const p = (py * w + px) * 3
    light[p] = light[p]! + r * k; light[p + 1] = light[p + 1]! + g * k; light[p + 2] = light[p + 2]! + b * k
  }
  put(x0, y0, (1 - fx) * (1 - fy)); put(x0 + 1, y0, fx * (1 - fy))
  put(x0, y0 + 1, (1 - fx) * fy); put(x0 + 1, y0 + 1, fx * fy)
}

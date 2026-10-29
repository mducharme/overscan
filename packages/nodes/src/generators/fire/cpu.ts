import { FixedStepClock, REFERENCE_FPS } from '../../frame-time.js'
import type { FrameBuffer, Signal } from '@overscan/types'
import { resolveAnimatableFloat } from '@overscan/types'
import { VIEWPORT_REF_HEIGHT, VIEWPORT_REF_WIDTH } from '../../viewport-scale.js'
import type { FireConfig } from './types.js'
import { defaultFirePalette } from './types.js'

const LUT = 256

function paletteTex(palette: number[][]): Uint8Array {
  const buf = new Uint8Array(LUT * 3)
  for (let i = 0; i < LUT; i++) {
    const t = i / (LUT - 1)
    const idx = t * (palette.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, palette.length - 1)
    const frac = idx - lo
    const a = palette[lo] ?? [0, 0, 0]
    const b = palette[hi] ?? a
    buf[i * 3 + 0] = Math.round((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * frac)
    buf[i * 3 + 1] = Math.round((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * frac)
    buf[i * 3 + 2] = Math.round((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * frac)
  }
  return buf
}

function hashNoise(x: number, t: number): number {
  const n = Math.sin(x * 127.1 + t * 311.7) * 43758.5453123
  return n - Math.floor(n)
}

/** Deterministic unsigned 32-bit hash per pixel and tick, cheap enough for every pixel. */
function coolHash(x: number, y: number, tick: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(tick, 2246822519)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}

/** Wraps a column index into [0, w) for offsets of at most one frame width. */
function wrap(x: number, w: number): number {
  return x < 0 ? x + w : x >= w ? x - w : x
}

export class FireCPU {
  private heat: Float32Array = new Float32Array(0)
  private pal: Uint8Array = new Uint8Array(0)
  private w = 0
  private h = 0
  private clock = new FixedStepClock()

  init(width: number, height: number, config: FireConfig): void {
    this.w = width
    this.h = height
    this.heat = new Float32Array(width * height)
    this.clock.reset()
    this.pal = paletteTex(config.palette ?? defaultFirePalette)
  }

  render(
    out: FrameBuffer,
    signal: Signal,
    config: FireConfig,
    cooling: number,
  ): void {
    const { width: w, height: h, data } = out
    if (w !== this.w || h !== this.h) {
      this.init(w, h, config)
    }
    const heat = this.heat
    const cool = Math.min(0.2, Math.max(0, cooling * 0.02)) * (VIEWPORT_REF_HEIGHT / Math.max(1, h))
    const seedIntensity = Math.max(0, Math.min(2, resolveAnimatableFloat(config.seedIntensity ?? 1, signal)))
    const seedWidth = Math.max(0, Math.min(1, resolveAnimatableFloat(config.seedWidth ?? 1, signal)))
    const spread = Math.max(
      1,
      Math.min(9, Math.round(((config.spread ?? 3) * w) / VIEWPORT_REF_WIDTH)),
    )
    const wind = Math.max(-3, Math.min(3, Math.round(resolveAnimatableFloat(config.wind ?? 0, signal))))

    const seedMode = config.seed ?? 'random'
    this.clock.advance(signal.t, () => heat.fill(0), tickT => {
      this.step(tickT, seedMode, seedWidth, seedIntensity, spread, wind, cool)
    })
    const pal = this.pal
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Use a fixed mapping instead of frame-normalizing the whole buffer.
        // Per-frame normalization makes the fire flicker and washes out the shape.
        const v = Math.max(0, Math.min(1, heat[y * w + x] ?? 0))
        const idx = Math.min(LUT - 1, Math.floor(v * (LUT - 1)))
        const pi = idx * 3
        const o = (y * w + x) * 4
        data[o + 0] = pal[pi + 0] ?? 0
        data[o + 1] = pal[pi + 1] ?? 0
        data[o + 2] = pal[pi + 2] ?? 0
        data[o + 3] = 255
      }
    }
  }

  /** One 30 Hz simulation tick: seed the bottom row, then let heat rise and cool. */
  private step(
    tickT: number,
    seedMode: FireConfig['seed'],
    seedWidth: number,
    seedIntensity: number,
    spread: number,
    wind: number,
    cool: number,
  ): void {
    const { heat, w, h } = this
    // seed bottom row
    const half = w * seedWidth * 0.5
    const center = w * 0.5
    for (let x = 0; x < w; x++) {
      const bottom = (h - 1) * w + x
      const dx = Math.abs(x - center)
      if (dx > half) {
        heat[bottom] = (heat[bottom] ?? 0) * 0.85
        continue
      }
      const r = seedMode === 'noise'
        ? (Math.sin(x * 0.3 + tickT * 10) * 0.5 + 0.5)
        : (
          hashNoise(x * 0.37, tickT * 2.5) * 0.55 +
          hashNoise(x * 0.11 + 19.7, tickT * 1.2) * 0.45
        )
      const target = Math.max(0, Math.min(1.5, r * seedIntensity))
      heat[bottom] = (heat[bottom] ?? 0) * 0.45 + target * 0.55
    }

    // Classic fire: average the row below (across `spread`) plus the pixel two rows below, read from a
    // randomly jittered column, then cool each pixel by a random amount (mean `cool`).
    const tick = Math.round(tickT * REFERENCE_FPS)
    const halfSpan = Math.floor((spread - 1) / 2)
    const taps = halfSpan * 2 + 2
    const coolScale = (cool * 2) / 256
    for (let y = h - 2; y >= 0; y--) {
      const below1 = (y + 1) * w
      const below2 = Math.min(h - 1, y + 2) * w
      for (let x = 0; x < w; x++) {
        // One integer hash per pixel and tick: low bits pick the column jitter, high bits the cooling.
        const r = coolHash(x, y, tick)
        // Random sideways jitter of the source column (−1, 0 or +1) makes the flames lick and sway.
        const src = wrap(x + wind + (r % 3) - 1, w)
        let sum = 0
        for (let k = -halfSpan; k <= halfSpan; k++) sum += heat[below1 + wrap(src + k, w)]!
        sum += heat[below2 + src]!
        heat[y * w + x] = Math.max(0, sum / taps - coolScale * (r >>> 24))
      }
    }
  }
}

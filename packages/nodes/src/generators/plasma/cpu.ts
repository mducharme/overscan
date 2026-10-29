import { aspectScale } from '../../viewport-scale.js'
import type { NodeContext, FrameBuffer, Signal } from '@overscan/types'
import type { PlasmaConfig } from './types.js'

const LUT_SIZE = 256

function buildPaletteBuffer(palette: number[][]): Uint8Array {
  const buf = new Uint8Array(LUT_SIZE * 3)
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / LUT_SIZE
    const idx = t * (palette.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.min(lo + 1, palette.length - 1)
    const frac = idx - lo
    const a = palette[lo] ?? [0, 0, 0]
    const b = palette[hi] ?? [0, 0, 0]
    buf[i * 3 + 0] = Math.round((a[0] ?? 0) + ((b[0] ?? 0) - (a[0] ?? 0)) * frac)
    buf[i * 3 + 1] = Math.round((a[1] ?? 0) + ((b[1] ?? 0) - (a[1] ?? 0)) * frac)
    buf[i * 3 + 2] = Math.round((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * frac)
  }
  return buf
}

/**
 * Same field as fragment shader (WebGL bottom-left v → we use v from bottom for parity with GPU export).
 * `sinX` / `sinY` are the first two terms, which only depend on one axis and are precomputed per column / row.
 */
function plasmaFieldSum(
  px: number,
  py: number,
  sinX: number,
  sinY: number,
  time: number,
  c: number,
): number {
  let v = 0
  v += sinX
  v += sinY
  if (c >= 3) v += Math.sin((px + py) * 4 + time * 1.1)
  if (c >= 4) v += Math.sin(Math.sqrt(px * px + py * py) * 6 - time * 1.9)
  if (c >= 5) v += Math.sin((px * 1.7 - py * 0.8) * 3 + time * 0.9)
  if (c >= 6) v += Math.sin((px * 0.5 + py * 2.2) * 2.7 - time * 1.5)
  if (c >= 7) {
    v += Math.sin(
      Math.hypot(px + Math.sin(time) * 0.3, py + Math.cos(time) * 0.3) * 8,
    )
  }
  if (c >= 8) v += Math.sin((px * px + py * py) * 12 - time * 0.7)
  return v
}

export class PlasmaCPU {
  private palette: Uint8Array = new Uint8Array(0)
  private colPx = new Float64Array(0)
  private colSin = new Float64Array(0)

  init(_ctx: NodeContext, config: PlasmaConfig): void {
    this.palette = buildPaletteBuffer(config.palette)
  }

  render(
    _ctx: NodeContext,
    out: FrameBuffer,
    signal: Signal,
    config: PlasmaConfig,
    speed: number,
    scale: number,
  ): void {
    const { width, height, data } = out
    const pal = this.palette
    const time = signal.t * speed
    const complexity = Math.max(2, Math.min(8, Math.round(config.complexity ?? 4)))
    const palOffset = Math.floor(time * 32) & 0xff
    const wm = Math.max(1, width - 1)
    const hm = Math.max(1, height - 1)

    const sc = Math.max(scale, 0.001)
    const aspect = aspectScale(width, height)
    if (this.colPx.length !== width) {
      this.colPx = new Float64Array(width)
      this.colSin = new Float64Array(width)
    }
    const colPx = this.colPx
    const colSin = this.colSin
    for (let x = 0; x < width; x++) {
      const px = ((x + 0.5) / wm - 0.5) * aspect.x * 3.5 * sc
      colPx[x] = px
      colSin[x] = Math.sin(px * 3 + time * 1.7)
    }

    for (let y = 0; y < height; y++) {
      const vBottom = 1 - (y + 0.5) / hm
      const py = (vBottom - 0.5) * aspect.y * 3.5 * sc
      const sinY = Math.sin(py * 4 - time * 1.3)
      for (let x = 0; x < width; x++) {
        const sum = plasmaFieldSum(colPx[x]!, py, colSin[x]!, sinY, time, complexity)
        const n = 0.5 + 0.5 * Math.sin((sum / complexity) * 1.2 + time * 0.2)
        const idx = Math.floor(Math.max(0, Math.min(1, n)) * (LUT_SIZE - 1))
        const idxRot = (idx + palOffset) & (LUT_SIZE - 1)
        const pi = idxRot * 3
        const off = (y * width + x) * 4
        data[off + 0] = pal[pi + 0] ?? 0
        data[off + 1] = pal[pi + 1] ?? 0
        data[off + 2] = pal[pi + 2] ?? 0
        data[off + 3] = 255
      }
    }
  }
}

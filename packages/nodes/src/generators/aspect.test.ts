import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import { aspectScale } from '../viewport-scale.js'
import { MoireGenerator } from './moire/index.js'

describe('aspect-correct coordinates', () => {
  it('keeps the short side at 1 and extends the long side', () => {
    expect(aspectScale(640, 360)).toEqual({ x: 640 / 360, y: 1 })
    expect(aspectScale(360, 640)).toEqual({ x: 1, y: 640 / 360 })
    expect(aspectScale(100, 100)).toEqual({ x: 1, y: 1 })
  })

  it('draws moire rings as circles on a 16:9 frame', () => {
    const w = 641
    const h = 361
    const pool = new BufferPoolImpl()
    const ctx = { canvas: null, ctx2d: null, gl: null, pool, width: w, height: h }
    const gen = MoireGenerator({ mode: 'rings', freq1: 30, freq2: 31 })
    gen.init(ctx)
    const out = pool.acquire(w, h)
    gen.render(ctx, out, buildSignal())
    const cx = (w - 1) / 2
    const cy = (h - 1) / 2
    const lum = (x: number, y: number): number => out.data[(y * w + x) * 4]!
    // Same distance right of and below the center must land on the same ring (horizontal used to be stretched 1.78x).
    let maxDiff = 0
    for (const d of [20, 45, 70, 95, 120, 150]) maxDiff = Math.max(maxDiff, Math.abs(lum(cx + d, cy) - lum(cx, cy + d)))
    expect(maxDiff).toBeLessThan(24)
  })
})

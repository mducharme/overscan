import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { NodeContext } from '@overscan/types'
import { ScreenBlendCompositor } from './screen-blend.js'
import { createInputSampler } from './blend-utils.js'

function makeCtx(pool: BufferPoolImpl, width: number, height: number): NodeContext {
  return { canvas: null, ctx2d: null, gl: null, pool, width, height }
}

function gradient(data: Uint8ClampedArray, width: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const p = i / 4
    data[i] = (p % width) * 17
    data[i + 1] = Math.floor(p / width) * 29
    data[i + 2] = (p * 7) & 0xff
    data[i + 3] = 255
  }
}

describe('compositor input sampling', () => {
  it('passes same-size inputs through 1:1 (no resampling shift)', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool, 8, 5)
    const base = pool.acquire(8, 5)
    const overlay = pool.acquire(8, 5)
    const out = pool.acquire(8, 5)
    gradient(base.data, 8)
    overlay.data.fill(0) // screen with black is the identity
    ScreenBlendCompositor({ opacity: 1 }).compose(ctx, { base, overlay }, out, buildSignal())
    expect([...out.data]).toEqual([...base.data])
  })

  it('samples smaller inputs at pixel centers, clamped to the edges', () => {
    const pool = new BufferPoolImpl()
    const base = pool.acquire(2, 1)
    base.data.set([0, 0, 0, 255, 100, 200, 40, 255])
    const sampler = createInputSampler(base, base, undefined, 4, 1)
    // Output centers 0.5, 1.5, 2.5, 3.5 map to source -0.25 (clamped 0), 0.25, 0.75, 1.25 (clamped 1).
    expect([0, 1, 2, 3].map(x => sampler.sample(x, 0).br)).toEqual([0, 25, 75, 100])
  })
})

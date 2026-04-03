import { describe, it, expect } from 'vitest'
import { PlasmaGenerator } from './index.js'
import { buildSignal, BufferPoolImpl } from '@overscan/core'
import type { NodeContext } from '@overscan/types'

function makeCtx(pool: BufferPoolImpl): NodeContext {
  return { canvas: null, ctx2d: null, gl: null, pool, width: 8, height: 8 }
}

describe('PlasmaGenerator', () => {
  it('fills the output buffer with non-zero RGBA data', () => {
    const pool = new BufferPoolImpl()
    const ctx  = makeCtx(pool)
    const gen  = PlasmaGenerator()
    const out  = pool.acquire(8, 8)
    const sig  = buildSignal({ t: 1 })

    gen.init(ctx)
    gen.render(ctx, out, sig)

    // alpha channel should be 255 everywhere
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(255)
    }
    // at least some pixels should be non-black
    const hasColor = [...out.data].some((v, i) => i % 4 !== 3 && v > 0)
    expect(hasColor).toBe(true)
  })

  it('produces different output at different times', () => {
    const pool = new BufferPoolImpl()
    const ctx  = makeCtx(pool)
    const gen  = PlasmaGenerator()
    gen.init(ctx)

    const out1 = pool.acquire(8, 8)
    gen.render(ctx, out1, buildSignal({ t: 0 }))
    const snap1 = Uint8ClampedArray.from(out1.data)

    const out2 = pool.acquire(8, 8)
    gen.render(ctx, out2, buildSignal({ t: 5 }))

    expect(snap1).not.toEqual(out2.data)
  })
})

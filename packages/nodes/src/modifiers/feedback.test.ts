import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { NodeContext } from '@overscan/types'
import { FeedbackModifier } from './feedback.js'

function makeCtx(pool: BufferPoolImpl): NodeContext {
  return { canvas: null, ctx2d: null, gl: null, pool, width: 2, height: 2 }
}

function fill(buffer: Uint8ClampedArray, rgba: [number, number, number, number]): void {
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = rgba[0]
    buffer[i + 1] = rgba[1]
    buffer[i + 2] = rgba[2]
    buffer[i + 3] = rgba[3]
  }
}

describe('FeedbackModifier', () => {
  it('feeds the previous frame back into the next frame', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool)
    const mod = FeedbackModifier({ decay: 0.5 })
    mod.init(ctx)

    const in1 = pool.acquire(2, 2)
    const out1 = pool.acquire(2, 2)
    fill(in1.data, [100, 0, 0, 255])
    mod.apply(ctx, in1, out1, buildSignal())
    expect(out1.data[0]).toBe(50)

    const in2 = pool.acquire(2, 2)
    const out2 = pool.acquire(2, 2)
    fill(in2.data, [0, 0, 0, 255])
    mod.apply(ctx, in2, out2, buildSignal({ t: 1 }))
    expect(out2.data[0]).toBe(25)
  })

  it('resets its stored frame when dimensions change', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool)
    const mod = FeedbackModifier({ decay: 0.75 })
    mod.init(ctx)

    const in1 = pool.acquire(2, 2)
    const out1 = pool.acquire(2, 2)
    fill(in1.data, [80, 0, 0, 255])
    mod.apply(ctx, in1, out1, buildSignal())

    const in2 = pool.acquire(3, 3)
    const out2 = pool.acquire(3, 3)
    fill(in2.data, [0, 0, 0, 255])
    mod.apply({ ...ctx, width: 3, height: 3 }, in2, out2, buildSignal({ t: 1 }))

    expect([...out2.data].every((value, index) => index % 4 === 3 ? value < 255 : value === 0)).toBe(true)
  })
})

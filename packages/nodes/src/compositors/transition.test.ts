import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { NodeContext } from '@overscan/types'
import { TransitionCompositor } from './transition.js'

function makeCtx(pool: BufferPoolImpl): NodeContext {
  return { canvas: null, ctx2d: null, gl: null, pool, width: 4, height: 2 }
}

function fill(buffer: Uint8ClampedArray, rgba: [number, number, number, number]): void {
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = rgba[0]
    buffer[i + 1] = rgba[1]
    buffer[i + 2] = rgba[2]
    buffer[i + 3] = rgba[3]
  }
}

describe('TransitionCompositor', () => {
  it('wipes left based on progress', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool)
    const comp = TransitionCompositor({ mode: 'wipe-left', progress: 0.5, easing: 'linear' })
    comp.init(ctx)

    const base = pool.acquire(4, 2)
    const overlay = pool.acquire(4, 2)
    const out = pool.acquire(4, 2)
    fill(base.data, [10, 0, 0, 255])
    fill(overlay.data, [200, 0, 0, 255])

    comp.compose(ctx, { base, overlay }, out, buildSignal())

    expect(out.data[0]).toBe(200)
    expect(out.data[4]).toBe(200)
    expect(out.data[8]).toBe(10)
    expect(out.data[12]).toBe(10)
  })

  it('applies flash colour near mid-transition', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool)
    const comp = TransitionCompositor({
      mode: 'flash',
      progress: 0.5,
      easing: 'linear',
      flashColor: '#ff0000',
    })
    comp.init(ctx)

    const base = pool.acquire(2, 2)
    const overlay = pool.acquire(2, 2)
    const out = pool.acquire(2, 2)
    fill(base.data, [0, 0, 0, 255])
    fill(overlay.data, [0, 0, 255, 255])

    comp.compose(ctx, { base, overlay }, out, buildSignal())

    expect(out.data[0]).toBeGreaterThan(100)
    expect(out.data[2]).toBeGreaterThan(0)
  })
})

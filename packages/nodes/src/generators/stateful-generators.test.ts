import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { NodeContext } from '@overscan/types'
import { GameOfLifeGenerator } from './game-of-life/index.js'
import { WaterRippleGenerator } from './water-ripple/index.js'

function makeCtx(pool: BufferPoolImpl, width = 16, height = 16): NodeContext {
  return { canvas: null, ctx2d: null, gl: null, pool, width, height }
}

describe('stateful generators', () => {
  it('game of life evolves after the initial seeded frame', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool, 320, 180)
    const gen = GameOfLifeGenerator({ seed: 'glider', scale: 2, speed: 1 })
    const out1 = pool.acquire(320, 180)
    const out2 = pool.acquire(320, 180)

    gen.init(ctx)
    gen.render(ctx, out1, buildSignal())
    const snap1 = Uint8ClampedArray.from(out1.data)
    gen.render(ctx, out2, buildSignal({ t: 1 / 30 }))

    expect(snap1).not.toEqual(out2.data)
  })

  it('water ripple produces a different frame after a beat-triggered impulse', () => {
    const pool = new BufferPoolImpl()
    const ctx = makeCtx(pool)
    const gen = WaterRippleGenerator({ tapMode: 'beat', damping: 0.99, tapStrength: 1.2 })
    const out1 = pool.acquire(16, 16)
    const out2 = pool.acquire(16, 16)

    gen.init(ctx)
    gen.render(ctx, out1, buildSignal({ beat: 0, dt: 0 }))
    const snap1 = Uint8ClampedArray.from(out1.data)
    // Beat 1 at 120 bpm is t = 0.5 s; the simulation derives taps from its own tick time.
    gen.render(ctx, out2, buildSignal({ t: 0.5, beat: 1, dt: 0.5, bpm: 120 }))

    expect(snap1).not.toEqual(out2.data)
  })
})

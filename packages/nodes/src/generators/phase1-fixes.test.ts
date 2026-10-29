import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { Generator, NodeContext } from '@overscan/types'
import { SinebobsGenerator } from './sinebobs/index.js'

const W = 160
const H = 90

function makeCtx(pool: BufferPoolImpl): NodeContext {
  return { canvas: null, ctx2d: null, gl: null, pool, width: W, height: H }
}

/** Renders like the executor: a fresh (cleared) pool buffer every frame. Returns the last frame. */
function renderFrames(gen: Generator, frames: number): Uint8ClampedArray {
  const pool = new BufferPoolImpl()
  const ctx = makeCtx(pool)
  gen.init(ctx)
  let last = new Uint8ClampedArray(0)
  for (let f = 0; f < frames; f++) {
    const out = pool.acquire(W, H)
    gen.render(ctx, out, buildSignal({ t: f / 30, frame: f, dt: 1 / 30 }))
    last = Uint8ClampedArray.from(out.data)
    pool.release(out)
  }
  return last
}

function litPixels(data: Uint8ClampedArray): number {
  let n = 0
  for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! > 30) n++
  return n
}

describe('phase 1 fixes', () => {
  it('sinebobs trail keeps earlier frames even though pool buffers are cleared', () => {
    const plain = litPixels(renderFrames(SinebobsGenerator({ trail: 0 }), 20))
    const trailed = litPixels(renderFrames(SinebobsGenerator({ trail: 0.95 }), 20))
    expect(trailed).toBeGreaterThan(plain * 1.5)
  })

})

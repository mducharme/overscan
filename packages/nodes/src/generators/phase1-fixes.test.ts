import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { Generator, NodeContext } from '@overscan/types'
import { SinebobsGenerator } from './sinebobs/index.js'
import { OscilloscopeGenerator } from './oscilloscope/index.js'
import { DotMatrixGenerator } from './dot-matrix/index.js'
import { projectObject } from './glenz/index.js'

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

  it('oscilloscope persistence keeps earlier traces even though pool buffers are cleared', () => {
    const plain = litPixels(renderFrames(OscilloscopeGenerator({ persistence: 0 }), 20))
    const persistent = litPixels(renderFrames(OscilloscopeGenerator({ persistence: 0.95 }), 20))
    expect(persistent).toBeGreaterThan(plain * 1.5)
  })

  it('glenz draws far faces first so near faces blend over them', () => {
    const tris = projectObject(W, H, 1, 0.4, 0.7, 0.2, 120, 4.4, [[255, 0, 0], [0, 0, 255]])
    for (let i = 1; i < tris.length; i++) {
      expect(tris[i]!.depth).toBeLessThanOrEqual(tris[i - 1]!.depth)
    }
  })

  it('dot-matrix text shape spells the given text', () => {
    const render = (text: string): Uint8ClampedArray =>
      renderFrames(DotMatrixGenerator({ shape: 'text', text, count: 400, rotationX: 0, rotationY: 0, rotationZ: 0 }), 1)
    expect(render('AAAA')).not.toEqual(render('BBBB'))
    expect(litPixels(render('I'))).toBeLessThan(litPixels(render('W')))
  })
})

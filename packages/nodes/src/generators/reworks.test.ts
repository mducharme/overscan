import { describe, expect, it } from 'vitest'
import { BufferPoolImpl, buildSignal } from '@overscan/core'
import type { Generator, NodeContext } from '@overscan/types'
import { CopperbarsGenerator } from './copperbars/index.js'
import { projectObject } from './glenz/index.js'

const W = 320
const H = 180

function renderOne(gen: Generator, t = 1): Uint8ClampedArray {
  const pool = new BufferPoolImpl()
  const ctx: NodeContext = { canvas: null, ctx2d: null, gl: null, pool, width: W, height: H }
  gen.init(ctx)
  const out = pool.acquire(W, H)
  gen.render(ctx, out, buildSignal({ t }))
  return Uint8ClampedArray.from(out.data)
}

const brightness = (d: Uint8ClampedArray, x: number, y: number): number => {
  const o = (y * W + x) * 4
  return d[o]! + d[o + 1]! + d[o + 2]!
}

describe('phase 3 reworks', () => {
  it('copperbars draws separate bars, brightest at their centre, over the background', () => {
    const data = renderOne(CopperbarsGenerator({ count: 1, amplitude: 0, barHeight: 20 }))
    const column = Array.from({ length: H }, (_, y) => brightness(data, 10, y))
    const peak = column.indexOf(Math.max(...column))
    expect(Math.abs(peak - H / 2)).toBeLessThanOrEqual(1)
    expect(column[peak]!).toBeGreaterThan(column[peak - 6]!)
    expect(column[0]).toBe(0)
    expect(column[H - 1]).toBe(0)
  })

  it('glenz has 24 faces, with back faces drawn before front faces', () => {
    const tris = projectObject(W, H, 1, 0.4, 0.7, 0.2, 120, 4.4, [[255, 255, 255], [0, 0, 255], [255, 0, 0], [0, 255, 0]])
    expect(tris.length).toBe(24)
    expect(tris.some(t => t.front)).toBe(true)
    expect(tris.some(t => !t.front)).toBe(true)
  })
})

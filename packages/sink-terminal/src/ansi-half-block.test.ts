import { describe, expect, it } from 'vitest'
import type { FrameBuffer } from '@overscan/types'
import { sampleAnsiHalfBlockPixels } from './ansi-half-block.js'

function makeFrame(w: number, h: number, fill: (i: number) => [number, number, number]): FrameBuffer {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = fill(i)
    const o = i * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = 255
  }
  return {
    id: 'test',
    width: w,
    height: h,
    data,
    clear(): void {
      data.fill(0)
    },
  }
}

describe('sampleAnsiHalfBlockPixels', () => {
  it('reads top and bottom RGB for a 1×2 strip', () => {
    const frame = makeFrame(1, 2, i => (i === 0 ? [10, 20, 30] : [40, 50, 60]))
    const s = sampleAnsiHalfBlockPixels(frame, 0, 0)
    expect(s).toEqual({ tr: 10, tg: 20, tb: 30, br: 40, bg: 50, bb: 60 })
  })

  it('zeros bottom when last row has no pair', () => {
    const frame = makeFrame(1, 1, () => [1, 2, 3])
    const s = sampleAnsiHalfBlockPixels(frame, 0, 0)
    expect(s.br).toBe(0)
    expect(s.bg).toBe(0)
    expect(s.bb).toBe(0)
  })
})

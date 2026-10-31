import { describe, expect, it } from 'vitest'
import type { Demo } from '@overscan/types'
import { buildDemoRuntimeSections, meltDelays, mixDemoBuffers } from './index.js'

describe('@overscan/sequencer', () => {
  it('builds overlapping sections from transition durations', async () => {
    const demo: Demo = {
      id: 'demo',
      title: 'Demo',
      sections: [
        { id: 'a', scene: 'a.json', transition: { type: 'dissolve', duration: 1 } },
        { id: 'b', scene: 'b.json' },
      ],
    }

    const { sections, fps, resolution } = await buildDemoRuntimeSections(demo, async scenePath => ({
      scene: {
        duration: 4,
        fps: 60,
        resolution: { width: 320, height: 180 },
      },
      runtime: { scenePath },
    }))

    expect(fps).toBe(60)
    expect(resolution).toEqual({ width: 320, height: 180 })
    expect(sections).toHaveLength(2)
    expect(sections[0]?.start).toBe(0)
    expect(sections[0]?.end).toBe(4)
    expect(sections[1]?.start).toBe(3)
  })

  it('mixes dissolve transitions between buffers', () => {
    const dst = new Uint8ClampedArray(4)
    const a = Uint8ClampedArray.from([0, 0, 0, 255])
    const b = Uint8ClampedArray.from([200, 100, 50, 255])

    mixDemoBuffers(dst, a, b, 1, 1, 0.5, 'dissolve', [255, 255, 255])

    expect([...dst]).toEqual([100, 50, 25, 255])
  })
})

describe('new transitions', () => {
  const w = 32
  const h = 18
  const solid = (v: number) => new Uint8ClampedArray(w * h * 4).fill(v)
  const mix = (mode: Parameters<typeof mixDemoBuffers>[6], p: number) => {
    const dst = new Uint8ClampedArray(w * h * 4)
    mixDemoBuffers(dst, solid(10), solid(200), w, h, p, mode, [255, 255, 255])
    return dst
  }
  const incomingShare = (dst: Uint8ClampedArray) => {
    let n = 0
    for (let i = 0; i < dst.length; i += 4) if (dst[i] === 200) n++
    return n / (w * h)
  }

  it('show only the old image at 0 and only the new one at 1', () => {
    for (const mode of ['blinds', 'checker', 'push', 'melt'] as const) {
      expect(incomingShare(mix(mode, 0))).toBe(0)
      expect(incomingShare(mix(mode, 1))).toBe(1)
    }
  })

  it('reveal part of the new image halfway', () => {
    for (const mode of ['blinds', 'checker', 'push'] as const) {
      const share = incomingShare(mix(mode, 0.5))
      expect(share).toBeGreaterThan(0.25)
      expect(share).toBeLessThan(0.75)
    }
    // Melt accelerates: halfway, the columns have dropped only part of the way.
    const melt = incomingShare(mix('melt', 0.5))
    expect(melt).toBeGreaterThan(0.02)
    expect(melt).toBeLessThan(0.5)
  })

  it('melt columns start at nearby times', () => {
    const delays = meltDelays()
    for (let i = 1; i < delays.length; i++) expect(Math.abs(delays[i]! - delays[i - 1]!)).toBeLessThanOrEqual(0.046)
  })
})

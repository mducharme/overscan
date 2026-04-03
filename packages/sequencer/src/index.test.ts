import { describe, expect, it } from 'vitest'
import type { Demo } from '@overscan/types'
import { buildDemoRuntimeSections, mixDemoBuffers } from './index.js'

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

import { describe, it, expect } from 'vitest'
import { RocketTimeline } from './rocket.js'

describe('RocketTimeline', () => {
  it('returns 0 for empty track', () => {
    const tl = new RocketTimeline()
    tl.load([{ name: 'x', keys: [] }])
    expect(tl.resolve(0)['x']).toBe(0)
  })

  it('step interpolation returns previous key value', () => {
    const tl = new RocketTimeline()
    tl.load([{
      name: 'x',
      keys: [
        { row: 0,  value: 0,   interpolation: 'step' },
        { row: 16, value: 1,   interpolation: 'step' },
      ],
    }])
    expect(tl.resolve(8)['x']).toBe(0)
    expect(tl.resolve(16)['x']).toBe(1)
  })

  it('linear interpolation', () => {
    const tl = new RocketTimeline()
    tl.load([{
      name: 'x',
      keys: [
        { row: 0,  value: 0, interpolation: 'linear' },
        { row: 10, value: 1, interpolation: 'linear' },
      ],
    }])
    expect(tl.resolve(5)['x']).toBeCloseTo(0.5)
  })

  it('smooth interpolation produces S-curve', () => {
    const tl = new RocketTimeline()
    tl.load([{
      name: 'x',
      keys: [
        { row: 0,  value: 0, interpolation: 'smooth' },
        { row: 10, value: 1, interpolation: 'smooth' },
      ],
    }])
    const mid = tl.resolve(5)['x'] ?? 0
    // smooth midpoint equals linear midpoint (0.5)
    expect(mid).toBeCloseTo(0.5)
    // quarter point should be less than linear (S-curve starts slow)
    const quarter = tl.resolve(2.5)['x'] ?? 0
    expect(quarter).toBeLessThan(0.25)
  })

  it('clamps below first key', () => {
    const tl = new RocketTimeline()
    tl.load([{
      name: 'x',
      keys: [{ row: 10, value: 5, interpolation: 'linear' }],
    }])
    expect(tl.resolve(0)['x']).toBe(5)
  })

  it('timeToRow converts correctly', () => {
    // 120bpm, 8 rows per beat: 1 second = 2 beats = 16 rows
    expect(RocketTimeline.timeToRow(1, 120, 8)).toBe(16)
  })
})

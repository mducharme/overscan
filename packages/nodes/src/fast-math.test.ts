import { describe, expect, it } from 'vitest'
import { fastSin } from './fast-math.js'

describe('fastSin', () => {
  it('matches Math.sin within 1e-6 across negative, small, and large arguments', () => {
    let maxErr = 0
    for (let x = -5000; x <= 5000; x += 0.0137) {
      maxErr = Math.max(maxErr, Math.abs(fastSin(x) - Math.sin(x)))
    }
    expect(maxErr).toBeLessThan(1e-6)
  })

  it('is exact at table points', () => {
    expect(fastSin(0)).toBe(0)
    expect(fastSin(Math.PI / 2)).toBeCloseTo(1, 12)
  })
})

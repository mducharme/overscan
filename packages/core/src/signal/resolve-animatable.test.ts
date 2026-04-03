import { describe, it, expect } from 'vitest'
import { resolveAnimatableFloat } from '@overscan/types'
import { buildSignal } from './builder.js'

describe('resolveAnimatableFloat', () => {
  it('returns literals', () => {
    const s = buildSignal()
    expect(resolveAnimatableFloat(3.5, s)).toBe(3.5)
  })

  it('reads Rocket tracks', () => {
    const s = buildSignal({ tracks: { speed: 2.25 } })
    expect(resolveAnimatableFloat({ track: 'speed' }, s)).toBe(2.25)
  })

  it('reads signal node outputs', () => {
    const s = buildSignal({ sources: { 'lfo.value': 0.75 } })
    expect(resolveAnimatableFloat({ node: 'lfo', output: 'value' }, s)).toBe(0.75)
  })
})

import { describe, expect, it } from 'vitest'
import { buildSignal } from '@overscan/core'
import { AudioAnalyserSource } from './audio-analyser.js'

describe('AudioAnalyserSource', () => {
  it('returns bounded fallback outputs when no source is available', () => {
    const src = AudioAnalyserSource({ src: 'does-not-exist.wav', bpmEstimate: 120 })
    src.init({ canvas: null, ctx2d: null, gl: null, pool: { acquire: () => { throw new Error('unused') }, release: () => {}, retain: () => {} }, width: 0, height: 0 })

    const out = src.tick(buildSignal({ t: 1, bpm: 120 }))

    expect(out['rms']).toBe(0)
    expect(out['spectral']).toBe(0)
    expect(out['beat']).toBeGreaterThanOrEqual(0)
    expect(out['beat']).toBeLessThanOrEqual(1)
    expect(out['zcr']).toBe(0)
    expect(Object.keys(out).filter((key) => key.startsWith('chroma-'))).toHaveLength(12)
    expect(Object.keys(out).filter((key) => key.startsWith('mfcc-'))).toHaveLength(13)
  })
})

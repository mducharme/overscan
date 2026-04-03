import type { Signal } from '@overscan/types'

const CHROMA_SIZE = 12
const MFCC_SIZE   = 13

export function buildSignal(partial: Partial<Signal> = {}): Signal {
  return {
    t:        0,
    frame:    0,
    dt:       0,
    beat:     0,
    bpm:      120,
    rms:      0,
    spectral: 0,
    chroma:   new Float32Array(CHROMA_SIZE),
    mfcc:     new Float32Array(MFCC_SIZE),
    tracks:   {},
    sources:  {},
    ...partial,
  }
}

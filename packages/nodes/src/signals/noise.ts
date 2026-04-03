import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type Signal,
  type SignalSource,
} from '@overscan/types'

export interface NoiseConfig {
  frequency?: AnimatableFloat
  smoothing?: number
  seed?: number
}

function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

export function NoiseSource(config: Partial<NoiseConfig> = {}): SignalSource {
  const freqRef = config.frequency ?? 3
  const smooth = Math.min(1, Math.max(0, config.smoothing ?? 0.85))
  const rand = makeRng(config.seed ?? 1)
  let target = 0.5
  let value = 0.5
  let lastStep = -1

  return {
    type:     'signal',
    id:       'noise',
    outputs:  ['value', 'bipolar'],
    config:   config as SignalSource['config'],
    init:     () => {},
    destroy:  () => {},
    tick(signal: Signal) {
      const freq = Math.max(1e-6, resolveAnimatableFloat(freqRef, signal))
      const step = Math.floor(signal.t * freq)
      if (step !== lastStep) {
        lastStep = step
        target = rand()
      }
      value = value * smooth + target * (1 - smooth)
      return { value, bipolar: value * 2 - 1 }
    },
  }
}

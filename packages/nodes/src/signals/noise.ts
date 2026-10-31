import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type Signal,
  type SignalSource,
} from '@overscan/types'
import { hash01 } from '../random.js'

export interface NoiseConfig {
  frequency?: AnimatableFloat
  smoothing?: number
  seed?: number
}

/**
 * Smooth random values that change `frequency` times a second. Computed from the time alone (a hashed
 * target per step, glided into from the previous one), so seeking and any frame rate give the same value.
 * `smoothing` is the share of each step spent gliding: 0 jumps, 1 glides the whole step.
 */
export function NoiseSource(config: Partial<NoiseConfig> = {}): SignalSource {
  const freqRef = config.frequency ?? 3
  const smooth = Math.min(1, Math.max(0, config.smoothing ?? 0.85))
  const seed = config.seed ?? 1

  return {
    type:     'signal',
    id:       'noise',
    outputs:  ['value', 'bipolar'],
    config:   config,
    init:     () => {},
    destroy:  () => {},
    tick(signal: Signal) {
      const freq = Math.max(1e-6, resolveAnimatableFloat(freqRef, signal))
      const pos = signal.t * freq
      const step = Math.floor(pos)
      const glide = smooth > 0 ? Math.min(1, (pos - step) / smooth) : 1
      const k = glide * glide * (3 - 2 * glide)
      const from = step > 0 ? hash01(seed, step - 1) : 0.5
      const value = from + (hash01(seed, step) - from) * k
      return { value, bipolar: value * 2 - 1 }
    },
  }
}

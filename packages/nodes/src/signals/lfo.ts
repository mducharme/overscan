import { DEFAULT_RANDOM_SEED, hash01 } from '../random.js'
import {
  resolveAnimatableFloat,
  type AnimatableFloat,
  type Signal,
  type SignalSource,
} from '@overscan/types'

export type LfoShape = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'ramp' | 'random'

export interface LFOConfig {
  /** Seed for this node's randomness (default 1); vary it to decorrelate identical nodes. */
  randomSeed?: number
  shape?: LfoShape
  /** Hz, track ref, or `{ bars: n }` for BPM-locked period (n bars per cycle). */
  rate?: AnimatableFloat | { bars: number }
  phase?: number
  bipolar?: boolean
  amplitude?: AnimatableFloat
  offset?: AnimatableFloat
  smooth?: number
}

function tri(t: number): number {
  const x = t % 1
  return x < 0.5 ? 4 * x - 1 : 3 - 4 * x
}

function resolveHz(rate: unknown, signal: Signal): number {
  if (rate && typeof rate === 'object' && 'bars' in rate) {
    const b = (rate as { bars: number }).bars
    if (typeof b === 'number' && b > 0) {
      const barSec = (60 / signal.bpm) * 4
      return 1 / (b * barSec)
    }
  }
  const v = resolveAnimatableFloat(rate, signal)
  return Math.max(1e-6, v)
}

function wave(shape: LfoShape, phase: number): number {
  const t = phase / (Math.PI * 2)
  switch (shape) {
    case 'triangle':
      return tri(t)
    case 'square':
      return Math.sin(phase) >= 0 ? 1 : -1
    case 'sawtooth':
      return 2 * (t % 1) - 1
    case 'ramp':
      return 1 - 2 * (t % 1)
    case 'random':
      return 0
    case 'sine':
    default:
      return Math.sin(phase)
  }
}

export function LFOSource(config: Partial<LFOConfig> = {}): SignalSource {
  const shape = (config.shape ?? 'sine')
  const phase0 = (config.phase ?? 0) * Math.PI * 2
  const bipolar = config.bipolar !== false
  const ampRef = config.amplitude ?? 1
  const offsetRef = config.offset ?? 0
  const smooth = Math.min(1, Math.max(0, config.smooth ?? 0))
  const randomSeed = config.randomSeed ?? DEFAULT_RANDOM_SEED
  let heldRandom = 0
  let lastRandomCycle = Number.NaN
  let lastValue = bipolar ? 0 : 0.5

  return {
    type:     'signal',
    id:       'lfo',
    outputs:  ['value', 'phase'],
    config:   config,
    init:     () => {},
    destroy:  () => {},
    tick(signal: Signal) {
      const hz = resolveHz(config.rate ?? 1, signal)
      const amp = resolveAnimatableFloat(ampRef, signal)
      const offset = resolveAnimatableFloat(offsetRef, signal)
      const phase = phase0 + signal.t * hz * Math.PI * 2
      const phaseNorm = ((phase / (Math.PI * 2)) % 1 + 1) % 1
      let v = wave(shape, phase)
      if (shape === 'random') {
        const cycle = Math.floor(phase / (Math.PI * 2))
        if (cycle !== lastRandomCycle) {
          lastRandomCycle = cycle
          heldRandom = hash01(randomSeed, cycle) * 2 - 1
        }
        v = heldRandom
      }
      if (!bipolar) v = v * 0.5 + 0.5
      const shaped = v * amp + offset
      const value = smooth > 0 ? lastValue * smooth + shaped * (1 - smooth) : shaped
      lastValue = value
      return { value, phase: phaseNorm }
    },
  }
}
